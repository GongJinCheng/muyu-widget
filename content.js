/**
 * 木鱼挂件 · content script
 * 悬浮木鱼：点击敲击（Web Audio 合成音效）、拖动、抛掷（重力/回弹/阻尼/旋转）。
 * 运行于 Shadow DOM，样式与页面完全隔离。
 */
(() => {
  'use strict';

  if (window.__muyuWidgetLoaded) return;
  window.__muyuWidgetLoaded = true;

  /* ------------------------------------------------------------------ *
   * 基础参数
   * ------------------------------------------------------------------ */
  const BOX = 104; // 物理包围盒（正方形，px）
  const TAB = 46; // 收起后的圆形入口尺寸
  const FLOOR_GAP = 10; // 距视口底部的“地面”留白
  const GRAVITY = 2600; // px/s²
  const BOUNCE = 0.56; // 地面回弹系数
  const WALL_BOUNCE = 0.64; // 侧壁回弹系数
  const AIR_DRAG = 0.55; // 空气阻力（1/s）
  const SPIN_DRAG = 2.4; // 旋转阻尼（1/s）
  const MAX_SPEED = 5200; // 抛出速度上限 px/s
  const FLING_SPEED = 620; // 松手速度低于此值视为轻放：原地停靠
  const AUTO_INTERVAL = 900; // 自动敲击间隔（ms），约 67 次/分钟
  const STORAGE_KEY = 'muyu-state-v1';
  const STATS_KEY = 'muyu-stats-v1'; // 功德数据（本地 + 账号同步各存一份）
  const GOAL = 108; // 每日功德目标
  const SYNC_DELAY = 4000; // 同步写入的合并间隔（避开 storage.sync 的每分钟写入配额）

  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  // 减弱动态：CSS 动画在媒体查询里压掉了，但物理是 rAF 驱动的，
  // 需要 JS 自己判断。用函数而非常量，这样用户中途改系统设置也能生效。
  const reduceMotion = () => {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  };
  const vw = () => document.documentElement.clientWidth || window.innerWidth || 0;
  const vh = () => document.documentElement.clientHeight || window.innerHeight || 0;
  const maxX = () => Math.max(0, vw() - BOX);
  const maxY = () => Math.max(0, vh() - BOX - FLOOR_GAP);

  /* ------------------------------------------------------------------ *
   * 音效：模态合成的木鱼「笃」声
   * ------------------------------------------------------------------ *
   * 不采样、不加载文件，纯 Web Audio 实时合成。做法是模拟一块被敲击的
   * 空心木头的几个模态：
   *
   *   1. 敲击瞬态：极短的低通噪声，只负责「咔」的那一下接触感
   *   2. 腔体基频：正弦 + 略微下滑，木鱼空腔的主音高
   *   3. 木体共振：两个非整数倍泛音（2.76 / 5.4 倍），这是木头区别于
   *      金属、玻璃的关键——整数倍听起来像铃声，非整数倍才「闷」
   *   4. 余响：基频带一点点频率漂移，模拟敲完之后木头的轻微嗡鸣
   *
   * 每一下的基频、泛音强度、噪声量都有微小随机，避免连击像机关枪。
   * ------------------------------------------------------------------ */
  const sound = {
    ctx: null,
    master: null,
    muted: false,
    // 泛音比列为「非整数倍」：木头、陶、石都是这样，金属才是整数倍
    PARTIALS: [
      { ratio: 2.76, gain: 0.18, decay: 0.055 },
      { ratio: 5.4, gain: 0.075, decay: 0.032 },
      { ratio: 8.9, gain: 0.03, decay: 0.018 }
    ],

    ensure() {
      // 整个初始化都放进 try：构造成功但节点创建失败的环境里，
      // 之前会抛出未捕获异常（计数已加、却没声音没动画）。
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          this.ctx = new AC();

          // 一路轻压缩，防止连击时叠加爆音
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -18;
          comp.knee.value = 22;
          comp.ratio.value = 5;
          comp.attack.value = 0.001;
          comp.release.value = 0.16;

          this.master = this.ctx.createGain();
          this.master.gain.value = 0.7;
          this.master.connect(comp);
          comp.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return this.ctx;
      } catch (err) {
        // 静默降级：没有声音也比整个交互崩掉好
        this.ctx = null;
        this.master = null;
        return null;
      }
    },

    /**
     * @param {number} strength 0–1，敲击力度（自动敲击会略轻）
     * @param {object} tone 皮肤音色 { base, ring, thud }
     */
    play(strength = 1, tone = null) {
      if (this.muted) return;
      const ctx = this.ensure();
      if (!ctx) return;

      const t = ctx.currentTime + 0.001;
      const tk = tone || { base: 452, ring: 1.9, thud: 0.6 };

      // 每一下的基频抖动 ±5%，连击才不像机器
      const base = tk.base * (0.95 + Math.random() * 0.1);
      const vol = clamp(0.55 * strength, 0.05, 0.9);
      const thud = clamp(tk.thud, 0, 1); // 越大越闷

      // 总线：这一下的所有声音都挂在这个 gain 上，结束统一断开
      const out = ctx.createGain();
      out.gain.value = 1;
      out.connect(this.master);

      /* ---- 1) 腔体基频 ---- */
      const body = ctx.createOscillator();
      body.type = 'sine';
      // 起音略高然后落下来：木头被压下去的瞬间张力更大
      body.frequency.setValueAtTime(base * 1.09, t);
      body.frequency.exponentialRampToValueAtTime(base, t + 0.028);
      // 尾音轻微下滑，收得更自然
      body.frequency.exponentialRampToValueAtTime(base * 0.985, t + 0.2);

      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(vol * 0.34, t + 0.055);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26 + thud * 0.12);

      // 闷度：加个低通，砍掉高频让声音「厚」
      const bodyLP = ctx.createBiquadFilter();
      bodyLP.type = 'lowpass';
      bodyLP.frequency.value = 3200 - thud * 1500;
      bodyLP.Q.value = 0.6;

      body.connect(bodyGain).connect(bodyLP).connect(out);
      body.start(t);
      body.stop(t + 0.42);

      /* ---- 2) 木体泛音（非整数倍） ---- */
      this.PARTIALS.forEach((p, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(base * p.ratio * (0.98 + Math.random() * 0.04), t);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol * p.gain * (1 - thud * 0.55), t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay * 3.2);

        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + p.decay * 3.6);
      });

      /* ---- 3) 敲击瞬态 ---- */
      const len = Math.max(1, Math.floor(ctx.sampleRate * 0.03));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        // 指数衰减的白噪声，起手极陡
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700 + Math.random() * 700;
      bp.Q.value = 0.9;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(vol * 0.42 * (1 - thud * 0.35), t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);

      noise.connect(bp).connect(noiseGain).connect(out);
      noise.start(t);

      // 这一下播完就摘掉总线，避免 gain 节点越积越多
      window.setTimeout(() => {
        try {
          out.disconnect();
        } catch (err) {
          /* noop */
        }
      }, 620);
    }
  };

  /* ------------------------------------------------------------------ *
   * 美术资产：形象、工具、收起图标
   * ------------------------------------------------------------------ *
   * 图形本身搬到 art.js（纯数据的「图形 + 文案 + 敲击参数」注册表），
   * 由 manifest 排在 content.js 之前加载。这样改美术不用碰交互逻辑，
   * 也能单独用 tools/art.html 大图预览。
   * ------------------------------------------------------------------ */
  const ART = (() => {
    const art = window.MuyuArt;
    if (art && art.SUBJECTS && art.TOOLS) return art;
    // art.js 没加载成功时的兜底：至少让挂件能显示，不至于整页空白
    const fallback = '<svg class="my-subject" viewBox="0 0 120 120"><circle cx="60" cy="60" r="38" fill="#a55c26"/></svg>';
    return {
      SUBJECTS: {
        muyu: {
          label: '木鱼',
          verb: '功德',
          copy: { title: '功德', today: '今日功德', total: '累计功德', streak: '连续敲击', goal: '目标完成', footer: '木鱼挂件 · 敲一下，功德 +1' },
          svg: fallback,
          squash: [1.06, 0.91],
          origin: '50% 80%',
          impact: [50, 66],
          tone: { base: 452, ring: 1.94, thud: 0.62 }
        }
      },
      TOOLS: { mallet: { label: '木槌', svg: '', rest: -26, swing: [-26, 24, -34, -22] } },
      SKIN_DEFAULT: { subject: 'muyu', tool: 'mallet' },
      MINI_FISH: ''
    };
  })();

  const SUBJECTS = ART.SUBJECTS;
  const TOOLS = ART.TOOLS;
  const SKIN_DEFAULT = ART.SKIN_DEFAULT;
  const MINI_FISH = ART.MINI_FISH;


  /* ------------------------------------------------------------------ *
   * Shadow DOM 骨架
   * ------------------------------------------------------------------ */
  const host = document.createElement('muyu-widget');
  host.setAttribute('aria-label', '木鱼挂件');
  host.style.visibility = 'hidden';

  const root = host.attachShadow({ mode: 'open' });

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  try {
    link.href =
      window.chrome && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL('styles.css')
        : 'styles.css';
  } catch (err) {
    link.href = 'styles.css';
  }
  root.appendChild(link);

  const wrap = document.createElement('div');
  wrap.className = 'my-root';
  wrap.innerHTML = `
    <div class="my-dock" id="dock">
      <div class="my-stage" id="stage"></div>
      <div
        class="my-hit"
        id="hit"
        role="button"
        tabindex="0"
        aria-label="木鱼：单击敲击，拖动可移动或抛出；键盘可用回车或空格敲击，方向键移动"
        aria-keyshortcuts="Enter Space"
      ></div>
      <div class="my-tools" id="tools">
        <button class="my-btn" id="setBtn" type="button" title="设置" aria-label="设置" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3.2"/>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1Z"/>
          </svg>
        </button>
        <button class="my-btn" id="collapseBtn" type="button" title="收起" aria-label="收起木鱼">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      </div>
      <div class="my-settings" id="settings" hidden>
        <div class="my-set-head">
          <span class="my-set-name">设置</span>
          <span class="my-set-date" id="setDate"></span>
        </div>
        <div class="my-set-body">
          <div class="my-set-group">
            <div class="my-set-title">形象</div>
            <div class="my-sk-row">
              <span class="my-sk-label">对象</span>
              <div class="my-sk-opts" id="subjectOpts"></div>
            </div>
            <div class="my-sk-row">
              <span class="my-sk-label">工具</span>
              <div class="my-sk-opts" id="toolOpts"></div>
            </div>
          </div>

          <div class="my-set-group">
            <div class="my-set-title">敲击</div>
            <div class="my-set-line">
              <span>声音</span>
              <button class="my-switch" id="soundSwitch" type="button" role="switch" aria-checked="true" aria-label="声音"><i></i></button>
            </div>
            <div class="my-set-line">
              <span>自动敲击</span>
              <button class="my-switch" id="autoSwitch" type="button" role="switch" aria-checked="false" aria-label="自动敲击"><i></i></button>
            </div>
            <div class="my-set-line">
              <span>节奏</span>
              <select class="my-select" id="tempoSel" aria-label="自动敲击节奏">
                <option value="1400">慢 · 1.4s</option>
                <option value="900">标准 · 0.9s</option>
                <option value="600">快 · 0.6s</option>
                <option value="400">连击 · 0.4s</option>
              </select>
            </div>
            <div class="my-set-line">
              <span>每日目标</span>
              <span class="my-num-wrap">
                <input class="my-num" id="goalInput" type="number" inputmode="numeric" min="1" max="9999" step="1" aria-label="每日功德目标">
                <em>下</em>
              </span>
            </div>
          </div>

          <div class="my-set-group">
            <div class="my-set-title">功德数据</div>
            <div class="my-set-stats">
              <div class="my-sp-ring">
                <svg viewBox="0 0 64 64" aria-hidden="true">
                  <circle class="my-ring-bg" cx="32" cy="32" r="26"></circle>
                  <circle class="my-ring-fg" id="ringFg" cx="32" cy="32" r="26" transform="rotate(-90 32 32)"></circle>
                </svg>
                <div class="my-sp-center"><b id="spToday">0</b><i id="spGoal">/ 108</i></div>
              </div>
              <div class="my-sp-rows">
                <div class="my-sp-row"><span>累计功德</span><b id="spTotal">0</b></div>
                <div class="my-sp-row"><span>连续敲击</span><b id="spStreak">0 天</b></div>
                <div class="my-sp-row"><span>今日进度</span><b id="spPct">0%</b></div>
              </div>
            </div>
            <div class="my-sp-hint" id="spHint"></div>
          </div>

          <div class="my-set-group">
            <div class="my-set-title">功德卡</div>
            <div class="my-card-slot" id="cardSlot"></div>
            <div class="my-copy-bar">
              <span>点卡片上的文字即可修改</span>
              <button class="my-link" id="copyReset" type="button">恢复默认</button>
            </div>
          </div>
        </div>

        <!-- 底部固定操作条：面板内容会滚动，但保存按钮永远露在外面 -->
        <div class="my-set-foot">
          <button class="my-save" id="saveCard" type="button">保存功德卡</button>
        </div>
      </div>
    </div>
    <button class="my-tab" id="tab" type="button" title="展开木鱼" aria-label="展开木鱼">${MINI_FISH}</button>
  `;
  root.appendChild(wrap);
  (document.documentElement || document.body).appendChild(host);

  const $ = (id) => root.getElementById(id);
  const dock = $('dock');
  const stage = $('stage');
  const hit = $('hit');
  const setBtn = $('setBtn');
  const settingsEl = $('settings');
  const subjectOpts = $('subjectOpts');
  const toolOpts = $('toolOpts');
  const soundSwitch = $('soundSwitch');
  const autoSwitch = $('autoSwitch');
  const tempoSel = $('tempoSel');
  const goalInput = $('goalInput');
  const collapseBtn = $('collapseBtn');
  const tabEl = $('tab');
  const setDate = $('setDate');
  const ringFg = $('ringFg');
  const spToday = $('spToday');
  const spGoal = $('spGoal');
  const spTotal = $('spTotal');
  const spStreak = $('spStreak');
  const spPct = $('spPct');
  const spHint = $('spHint');
  const saveCardBtn = $('saveCard');
  const cardSlot = $('cardSlot');
  const copyResetBtn = $('copyReset');

  let subjectEl = null; // 当前被敲对象（换肤时重建）
  let toolEl = null; // 当前敲击工具

  /* ------------------------------------------------------------------ *
   * 物理状态
   * ------------------------------------------------------------------ */
  const st = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, omega: 0 };
  let dragging = false;
  let activePointer = null;
  let grabDX = 0;
  let grabDY = 0;
  let startCX = 0;
  let startCY = 0;
  let movedDist = 0;
  let downAt = 0;
  let samples = [];
  let collapsed = false;
  let parked = true; // true：停靠（无重力）；false：甩出后的物理飞行
  let posFromUser = false; // 用户是否亲手摆过位置（决定 resize 时是否回到默认角落）
  let rafId = 0;
  let lastTs = 0;
  let saveTimer = 0;
  let autoOn = false; // 自动敲击开关
  let autoTimer = 0; // 自动敲击的下一拍定时器
  let autoInterval = AUTO_INTERVAL; // 自动敲击节奏（ms），面板可调
  let skin = { ...SKIN_DEFAULT }; // 当前形象组合
  let copy = {}; // 功德卡文案覆盖（只存用户改过的字段，空值表示跟随形象默认）

  /* ------------------------------------------------------------------ *
   * 功德数据：累计 / 今日 / 连续天数 / 每日目标
   * 本地 storage.local 为主，storage.sync 做跨设备同步（合并写入）
   * ------------------------------------------------------------------ */
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayKey = () => dayKey(new Date());
  const shiftDayKey = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return dayKey(d);
  };
  const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN');

  /* ------------------------------------------------------------------ *
   * 功德数据层：G-Counter 合并，避免多标签页 / 跨设备丢计数
   * ------------------------------------------------------------------ *
   * 合并算法在 stats.js（纯函数、可被 Node 单测）。这里负责：
   *   · 生成会话分量 ID（每个标签页一个）
   *   · storage 读写 + onChanged 合并（local + sync 都监听）
   *   · 节流写回，避免 storage 配额被打爆
   * ------------------------------------------------------------------ */
  const Stats = window.MuyuStats;
  const sessionId = (() => {
    // 一个标签页一个 ID，存在 sessionStorage 里以防刷新后重复计数
    try {
      let id = sessionStorage.getItem('muyu-session');
      if (!id) {
        id = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem('muyu-session', id);
      }
      return id;
    } catch (err) {
      return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }
  })();

  let stats = Stats.makeInitial(GOAL, todayKey());
  let statsSaveTimer = 0;
  let syncTimer = 0;
  // 防止 onChanged 合并后再次写回造成死循环。
  // 注意：不能用 sync.set 的回调来复位——未登录账号时 sync 写入会失败，
  // 回调可能不触发，标志会永远卡在 true，导致后续所有远程更新被忽略。
  let applyingRemote = false;
  let applyingRemoteTimer = 0;

  const statsArea = (name) => {
    try {
      return window.chrome && chrome.storage && chrome.storage[name] ? chrome.storage[name] : null;
    } catch (err) {
      return null;
    }
  };

  function statsGet(name, cb) {
    const area = statsArea(name);
    if (!area) {
      cb(null);
      return;
    }
    try {
      area.get(STATS_KEY, (res) => {
        void (chrome.runtime && chrome.runtime.lastError);
        cb(res && res[STATS_KEY] ? res[STATS_KEY] : null);
      });
    } catch (err) {
      cb(null);
    }
  }

  function statsSet(name, value, cb) {
    const area = statsArea(name);
    if (!area) {
      if (cb) cb(false);
      return;
    }
    try {
      // 写回前打标，避免自己的写触发 onChanged 再合并一次
      area.set({ [STATS_KEY]: value }, () => {
        const failed = !!(chrome.runtime && chrome.runtime.lastError);
        if (cb) cb(!failed);
      });
    } catch (err) {
      if (cb) cb(false);
    }
  }

  /** 连续天数：最近一次敲击在今天或昨天才算仍然连续 */
  function effectiveStreak() {
    if (stats.lastDate === todayKey() || stats.lastDate === shiftDayKey(-1)) return stats.streak;
    return 0;
  }

  /** 跨天：今日归零（不改写 lastDate，连续天数在下次敲击时判断） */
  function rollStats() {
    const t = todayKey();
    if (stats.todayDate !== t) {
      stats.todayDate = t;
      stats.today = 0;
    }
  }

  function updateStatsUI() {
    const goal = stats.goal || GOAL;
    const pct = clamp(stats.today / goal, 0, 1);
    const done = stats.today >= goal;
    const streak = effectiveStreak();

    settingsEl.classList.toggle('is-done', done);

    const circ = 2 * Math.PI * 26;
    ringFg.style.strokeDasharray = circ.toFixed(2);
    ringFg.style.strokeDashoffset = (circ * (1 - pct)).toFixed(2);

    spToday.textContent = String(stats.today);
    spGoal.textContent = `/ ${goal}`;
    spTotal.textContent = fmtNum(stats.total);
    spStreak.textContent = `${streak} 天`;
    spPct.textContent = `${Math.round(pct * 100)}%`;
    spHint.textContent = done ? '今日目标已圆满' : `还差 ${goal - stats.today} 下`;

    // 输入框正在编辑时不要回写，避免光标跳走
    if (root.activeElement !== goalInput) goalInput.value = String(goal);

    const now = new Date();
    setDate.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;

    // 面板开着时卡片预览跟着数据实时更新（正在改文案时不打断输入）
    if (!settingsEl.hidden && !cardSlot.querySelector('.is-editing')) renderCardPreview();
  }

  let statsLoaded = false; // 存档加载完成前不接受敲击，避免默认态计数被随后到来的存档覆盖

  function recordKnock() {
    if (!statsLoaded) return false;
    Stats.applyKnock(stats, sessionId, todayKey(), shiftDayKey(-1), Date.now());
    updateStatsUI();
    saveStats();
    return true;
  }

  function saveStats() {
    if (statsSaveTimer) clearTimeout(statsSaveTimer);
    statsSaveTimer = window.setTimeout(() => {
      statsSaveTimer = 0;
      statsSet('local', stats);
    }, 350);

    // 账号同步：合并成低频写入，避免连续敲击打爆 sync 的每分钟写入配额
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      statsSet('sync', stats);
    }, SYNC_DELAY);
  }

  function flushStats() {
    if (statsSaveTimer) {
      clearTimeout(statsSaveTimer);
      statsSaveTimer = 0;
    }
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = 0;
    }
    statsSet('local', stats);
    statsSet('sync', stats);
  }

  function loadStats() {
    return new Promise((resolve) => {
      let pending = 2;
      let local = null;
      let cloud = null;
      const done = () => {
        pending -= 1;
        if (pending > 0) return;
        // 关键：把「当前内存态」也作为一路输入。
        // 否则页面隐藏期间敲的几下（350ms 节流还没写回 storage）会在
        // visibilitychange 主动 loadStats 时被 storage 的旧值覆盖掉。
        // G-Counter 的 max 合并保证三路增量都不会丢。
        const disk = Stats.merge(Stats.normalize(local, GOAL), Stats.normalize(cloud, GOAL));
        const merged = statsLoaded ? Stats.merge(stats, disk) : disk;
        if (merged) stats = merged;
        rollStats();
        resolve();
      };
      statsGet('local', (v) => {
        local = v;
        done();
      });
      statsGet('sync', (v) => {
        cloud = v;
        done();
      });
    });
  }

  /**
   * 监听 storage 变化做合并。
   * 关键：local 和 sync 都要监听——之前只听 sync，导致同一浏览器多标签页
   * 互相覆盖本地计数（每个标签页持有一份内存 stats，整对象覆盖写）。
   */
  function watchStatsSync() {
    try {
      if (!chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' && area !== 'sync') return;
        const change = changes[STATS_KEY];
        if (!change || applyingRemote) return;

        const incoming = Stats.normalize(change.newValue, GOAL);
        if (!incoming) return;
        const merged = Stats.merge(stats, incoming);
        if (Stats.sameVisible(merged, stats)) return;

        // 合并结果写回内存 + local，让其它标签页也收敛到同一状态。
        // 不在这里写 sync：sync 有自己的 4s 节流，而且未登录时写 sync 会失败。
        applyingRemote = true;
        if (applyingRemoteTimer) clearTimeout(applyingRemoteTimer);
        // 兜底复位：无论 local.set 的回调是否触发，都保证标志不会永久卡住
        applyingRemoteTimer = window.setTimeout(() => {
          applyingRemote = false;
          applyingRemoteTimer = 0;
        }, 200);

        stats = merged;
        if (statsSaveTimer) {
          clearTimeout(statsSaveTimer);
          statsSaveTimer = 0;
        }
        if (syncTimer) {
          clearTimeout(syncTimer);
          syncTimer = 0;
        }
        statsSet('local', stats, () => {
          applyingRemote = false;
          if (applyingRemoteTimer) {
            clearTimeout(applyingRemoteTimer);
            applyingRemoteTimer = 0;
          }
        });
        rollStats();
        updateStatsUI();
      });
    } catch (err) {
      /* noop */
    }
  }



  /* ------------------------------------------------------------------ *
   * 设置面板：页面上只保留“设置 / 收起”，其余操作全部收进来
   * ------------------------------------------------------------------ */
  function positionPanel(el) {
    const w = el.offsetWidth || 252;
    const h = el.offsetHeight || 340;
    const aboveSpace = st.y - 12; // 木鱼上方可用高度
    const belowSpace = vh() - (st.y + BOX) - 12; // 下方可用高度
    // 上下择向：哪边放得下就放哪边，都放不下就选空间大的一侧
    const above = aboveSpace >= h + 8 || aboveSpace >= belowSpace;
    const alignRight = st.x + w > vw() - 8;

    const place = (top, bottom) => {
      el.style.top = top;
      el.style.bottom = bottom;
      el.style.left = alignRight ? 'auto' : '0';
      el.style.right = alignRight ? '0' : 'auto';
      el.style.transform = '';
      return el.getBoundingClientRect();
    };

    // 超出视口就整体平移回来
    const clampY = () => {
      let dy = 0;
      const b = el.getBoundingClientRect();
      if (b.bottom > vh() - 8) dy = vh() - 8 - b.bottom;
      if (b.top + dy < 8) dy = 8 - b.top;
      el.style.transform = dy ? `translateY(${dy.toFixed(1)}px)` : '';
      return el.getBoundingClientRect();
    };

    if (above) place('auto', `${BOX + 4}px`);
    else place(`${BOX + 4}px`, 'auto');
    let r = clampY();

    // 视口特别矮、上下都塞不下，平移后仍压在木鱼上：改贴到木鱼左侧或右侧
    if (!(r.bottom <= st.y || r.top >= st.y + BOX)) {
      const leftRoom = st.x - 4 - w >= 8;
      const rightRoom = st.x + BOX + 4 + w <= vw() - 8;
      if (leftRoom || rightRoom) {
        el.style.top = '0';
        el.style.bottom = 'auto';
        el.style.left = leftRoom ? `${-(w + 4)}px` : `${BOX + 4}px`;
        el.style.right = 'auto';
        el.style.transform = '';
        r = clampY();
      }
    }
  }

  function openSettings() {
    renderCardPreview(); // 先渲染卡片预览，量到的面板高度才准
    settingsEl.hidden = false;
    positionPanel(settingsEl);
    dock.classList.add('is-open');
    setBtn.setAttribute('aria-expanded', 'true');
    // 把焦点移进面板首个控件，键盘用户可以立刻 Tab/操作
    const first = settingsEl.querySelector('button, select, input, [tabindex="0"]');
    if (first) first.focus();
  }

  function closeSettings(restoreFocus) {
    if (settingsEl.hidden) return;
    // 正在改文案时先把字落下来，避免收起丢输入
    const editing = cardSlot.querySelector('.my-cv-edit.is-editing .my-cv-input');
    if (editing) editing.blur();
    settingsEl.hidden = true;
    dock.classList.remove('is-open');
    setBtn.setAttribute('aria-expanded', 'false');
    // 只有键盘路径（Escape / 切换按钮）才把焦点还给设置按钮；
    // 鼠标点空白处收起时不要抢焦点，否则页面原本的焦点会跳走。
    if (restoreFocus) setBtn.focus();
  }

  setBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (settingsEl.hidden) openSettings();
    else closeSettings(true);
  });

  // Escape 关闭面板并把焦点还给设置按钮（WCAG 键盘可达）
  document.addEventListener(
    'keydown',
    (e) => {
      if (settingsEl.hidden || e.key !== 'Escape') return;
      // 正在编辑文案时，Escape 由输入框自己处理（取消编辑），不要连带关面板
      if (cardSlot.querySelector('.my-cv-edit.is-editing')) return;
      e.preventDefault();
      e.stopPropagation();
      closeSettings(true);
    },
    true
  );

  // 点到别处收起面板（页面其余部分的点击不受影响）
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (settingsEl.hidden) return;
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(settingsEl) || path.includes(setBtn)) return;
      closeSettings();
    },
    true
  );

  /* ------------------------------------------------------------------ *
   * 功德卡：Canvas 全本地绘制后导出 PNG
   * 图形来自当前皮肤的内联 SVG，字体只用系统字体，完全离线可用。
   * ------------------------------------------------------------------ */
  const CARD_W = 1080;
  const CARD_H = 1440;

  const seeded = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 当前形象合成成一张 SVG（被敲对象 + 工具），再转 data URL 交给 Image */
  function avatarDataUrl() {
    const subject = subjectEl ? subjectEl.innerHTML : '';
    const tool = toolEl ? toolEl.innerHTML : '';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="528" height="496" viewBox="0 0 132 124">' +
      `<g transform="translate(0,4)">${subject}</g>` +
      `<g transform="translate(74,6) scale(0.72)">${tool}</g>` +
      '</svg>';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawCard(ctx, avatar) {
    const goal = stats.goal || GOAL;
    const pct = clamp(stats.today / goal, 0, 1);
    const done = stats.today >= goal;
    const rand = seeded(20261113);
    const now = new Date();
    const cx = CARD_W / 2;

    // 纸底
    const bg = ctx.createLinearGradient(0, 0, CARD_W * 0.85, CARD_H);
    bg.addColorStop(0, '#fffdf7');
    bg.addColorStop(0.45, '#fdf4e4');
    bg.addColorStop(1, '#f5e4c9');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // 纸纹颗粒（固定种子，每次生成的纹理一致）
    for (let i = 0; i < 2400; i++) {
      const x = rand() * CARD_W;
      const y = rand() * CARD_H;
      ctx.fillStyle = `rgba(122, 82, 40, ${(0.014 + rand() * 0.028).toFixed(3)})`;
      ctx.fillRect(x, y, 1.6, 1.6);
    }

    // 左上暖光
    const glow = ctx.createRadialGradient(
      CARD_W * 0.26,
      CARD_H * 0.08,
      60,
      CARD_W * 0.26,
      CARD_H * 0.08,
      CARD_W * 0.95
    );
    glow.addColorStop(0, 'rgba(255, 208, 130, 0.42)');
    glow.addColorStop(0.5, 'rgba(255, 208, 130, 0.12)');
    glow.addColorStop(1, 'rgba(255, 208, 130, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // 双层边框
    ctx.strokeStyle = 'rgba(150, 100, 46, 0.3)';
    ctx.lineWidth = 3;
    roundRect(ctx, 40, 40, CARD_W - 80, CARD_H - 80, 26);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180, 132, 74, 0.18)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 56, 56, CARD_W - 112, CARD_H - 112, 20);
    ctx.stroke();

    // 标题（可自定义）：按字数拉开字距，过长时自动缩字号
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#6b3a12';
    const title = Array.from(copyOf('title')).join('   ');
    let titleSize = 84;
    ctx.font = `700 ${titleSize}px "Songti SC", "STSong", "SimSun", serif`;
    while (titleSize > 40 && ctx.measureText(title).width > CARD_W - 240) {
      titleSize -= 4;
      ctx.font = `700 ${titleSize}px "Songti SC", "STSong", "SimSun", serif`;
    }
    ctx.fillText(title, cx, 176);

    // 日期
    const week = '日一二三四五六'[now.getDay()];
    ctx.font = '400 30px "PingFang SC", "Helvetica Neue", sans-serif';
    ctx.fillStyle = '#a9825a';
    ctx.fillText(
      `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${week}`,
      cx,
      238
    );

    // 当前形象
    if (avatar) {
      const aw = 340;
      const ah = aw * (496 / 528);
      ctx.drawImage(avatar, (CARD_W - aw) / 2, 258, aw, ah);
    }

    // 进度环
    const cy = 856;
    const r = 186;
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(170, 118, 58, 0.14)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    if (pct > 0) {
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * pct;
      const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      ring.addColorStop(0, done ? '#ffd06a' : '#f2bd6d');
      ring.addColorStop(0.55, done ? '#eaa42c' : '#dd9337');
      ring.addColorStop(1, done ? '#d98f18' : '#c67c22');
      ctx.strokeStyle = ring;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end);
      ctx.stroke();
      // 进度端点
      ctx.fillStyle = done ? '#f5c451' : '#e8a94f';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(end) * r, cy + Math.sin(end) * r, 13, 0, Math.PI * 2);
      ctx.fill();
    }

    // 环内数字
    ctx.fillStyle = '#8c4f12';
    ctx.font = '700 132px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
    ctx.fillText(String(stats.today), cx, cy + 20);
    ctx.fillStyle = '#ad8b64';
    ctx.font = '500 34px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
    ctx.fillText(`/ ${goal}`, cx, cy + 78);
    ctx.font = '500 26px "Songti SC", "PingFang SC", serif';
    ctx.fillText(done ? '今日圆满' : copyOf('today'), cx, cy + 134);

    // 三项数据
    const cols = [
      { k: copyOf('total'), v: fmtNum(stats.total) },
      { k: copyOf('streak'), v: `${effectiveStreak()} 天` },
      { k: copyOf('goal'), v: `${Math.round(pct * 100)}%` }
    ];
    const xs = [270, CARD_W / 2, 810];
    cols.forEach((c, i) => {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#6b3a12';
      ctx.font = '700 54px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
      ctx.fillText(c.v, xs[i], 1150);
      ctx.fillStyle = '#a9825a';
      ctx.font = '400 25px "PingFang SC", sans-serif';
      ctx.fillText(c.k, xs[i], 1194);
    });
    ctx.strokeStyle = 'rgba(150, 100, 50, 0.16)';
    ctx.lineWidth = 1.5;
    [405, 675].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 1112);
      ctx.lineTo(x, 1186);
      ctx.stroke();
    });

    // 页脚
    ctx.strokeStyle = 'rgba(150, 100, 50, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(150, 1290);
    ctx.lineTo(CARD_W - 150, 1290);
    ctx.stroke();
    // 页脚（可自定义）
    const foot = copyOf('footer');
    ctx.fillStyle = '#a9825a';
    let footSize = 26;
    ctx.font = `400 ${footSize}px "PingFang SC", "Songti SC", serif`;
    while (footSize > 16 && ctx.measureText(foot).width > CARD_W - 300) {
      footSize -= 2;
      ctx.font = `400 ${footSize}px "PingFang SC", "Songti SC", serif`;
    }
    ctx.fillText(foot, cx, 1348);
  }

  async function buildCard() {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    const avatar = await loadImage(avatarDataUrl());
    // 少数浏览器（尤其 WebKit）在 data-URL SVG → canvas 路径上解码失败。
    // 不再静默导出一张「没有形象」的卡片——把标记传给调用方给出提示。
    if (!avatar) {
      drawCard(ctx, null); // 仍然画出卡片其余部分
      return { canvas, avatarFailed: true };
    }
    drawCard(ctx, avatar);
    return { canvas, avatarFailed: false };
  }

  saveCardBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (saveCardBtn.classList.contains('is-busy')) return;
    const label = saveCardBtn.textContent;
    saveCardBtn.classList.add('is-busy');
    saveCardBtn.textContent = '正在生成…';
    try {
      const built = await buildCard();
      const canvas = built.canvas;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('toBlob failed');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentSubject().verb}卡-${todayKey()}.png`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      // 形象解码失败时卡片仍导出，但明确告诉用户少了形象，避免静默降级
      saveCardBtn.textContent = built.avatarFailed ? '已保存（缺形象）' : '已保存';
    } catch (err) {
      saveCardBtn.textContent = '生成失败';
    }
    window.setTimeout(() => {
      saveCardBtn.textContent = label;
      saveCardBtn.classList.remove('is-busy');
    }, 1600);
  });

  /* ------------------------------------------------------------------ *
   * 功德卡预览：与导出图同一套文案与数据，卡片上的文字可就地点击修改
   * ------------------------------------------------------------------ */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function renderCardPreview() {
    const goal = stats.goal || GOAL;
    const pct = clamp(stats.today / goal, 0, 1);
    const now = new Date();
    const week = '日一二三四五六'[now.getDay()];
    const cell = (k) =>
      `<span class="my-cv-edit" role="button" tabindex="0" data-k="${k}">${esc(copyOf(k))}</span>`;

    cardSlot.innerHTML = `
      <div class="my-cv">
        <div class="my-cv-paper">
          <span class="my-cv-edit my-cv-title" role="button" tabindex="0" data-k="title">${esc(copyOf('title'))}</span>
          <div class="my-cv-date">${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${week}</div>
          <img class="my-cv-av" alt="" src="${avatarDataUrl()}">
          <div class="my-cv-ring" style="--pct:${(pct * 100).toFixed(1)}%">
            <b>${stats.today}</b><i>/ ${goal}</i>
            <span class="my-cv-edit my-cv-today" role="button" tabindex="0" data-k="today">${esc(copyOf('today'))}</span>
          </div>
          <div class="my-cv-cols">
            <div class="my-cv-col"><b>${fmtNum(stats.total)}</b>${cell('total')}</div>
            <div class="my-cv-col"><b>${effectiveStreak()} 天</b>${cell('streak')}</div>
            <div class="my-cv-col"><b>${Math.round(pct * 100)}%</b>${cell('goal')}</div>
          </div>
          <span class="my-cv-edit my-cv-foot" role="button" tabindex="0" data-k="footer">${esc(copyOf('footer'))}</span>
        </div>
      </div>`;
  }

  /** 点一下卡片上的文字 → 原位变成输入框，回车/失焦保存，Esc 取消 */
  function beginCopyEdit(btn) {
    if (!btn || btn.querySelector('input')) return;
    const key = btn.dataset.k;
    if (!COPY_KEYS.includes(key)) return;

    const input = document.createElement('input');
    input.className = 'my-cv-input';
    input.type = 'text';
    input.maxLength = COPY_MAX[key] || 12;
    input.value = copyOf(key);
    btn.classList.add('is-editing');
    btn.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = (commit) => {
      if (settled) return;
      settled = true;
      const value = input.value;
      input.remove();
      btn.classList.remove('is-editing');
      if (commit) setCopy(key, value);
      else btn.textContent = copyOf(key);
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  cardSlot.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.my-cv-edit') : null;
    if (!btn || btn.querySelector('input')) return;
    e.preventDefault();
    e.stopPropagation();
    beginCopyEdit(btn);
  });

  // 这些文字是 div[role=button][tabindex=0]，原生 div 上按 Enter/Space
  // 不会触发 click——键盘用户聚焦后按回车没反应。这里显式补上。
  cardSlot.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const btn = e.target && e.target.closest ? e.target.closest('.my-cv-edit') : null;
    if (!btn || btn.querySelector('input')) return;
    e.preventDefault();
    e.stopPropagation();
    beginCopyEdit(btn);
  });

  copyResetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetCopy();
  });

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */
  function render() {
    dock.style.transform = `translate3d(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px, 0)`;
    stage.style.transform = `rotate(${st.angle.toFixed(4)}rad)`;
  }

  function positionTab() {
    const tx = clamp(st.x + BOX - TAB, 0, Math.max(0, vw() - TAB));
    const ty = clamp(st.y + BOX - TAB, 0, Math.max(0, vh() - TAB - FLOOR_GAP));
    tabEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
  }

  /* ------------------------------------------------------------------ *
   * 皮肤：全部由注册表数据驱动，切换只重建 SVG 与参数
   * ------------------------------------------------------------------ */
  const currentSubject = () => SUBJECTS[skin.subject] || SUBJECTS[SKIN_DEFAULT.subject];
  const currentTool = () => TOOLS[skin.tool] || TOOLS[SKIN_DEFAULT.tool];

  /* 功德卡文案：用户改过的字段优先，没改的跟随当前形象 */
  const COPY_KEYS = ['title', 'today', 'total', 'streak', 'goal', 'footer'];
  const COPY_MAX = { title: 6, today: 8, total: 8, streak: 8, goal: 8, footer: 30 };

  function copyOf(key) {
    const own = copy[key];
    if (own && own.trim()) return own;
    return (currentSubject().copy && currentSubject().copy[key]) || '';
  }

  function setCopy(key, value) {
    if (!COPY_KEYS.includes(key)) return;
    const v = String(value || '').trim().slice(0, COPY_MAX[key]);
    if (v) copy[key] = v;
    else delete copy[key];
    save();
    // 就地更新该处文字，不重建整张预览（避免打断连续编辑）
    const btn = cardSlot.querySelector(`[data-k="${key}"]`);
    if (btn) btn.textContent = copyOf(key);
  }

  function resetCopy() {
    copy = {};
    save();
    renderCardPreview();
  }

  function buildSkinOptions() {
    const fill = (el, kind, data) => {
      el.innerHTML = Object.keys(data)
        .map(
          (id) =>
            `<button class="my-sk-opt" type="button" data-kind="${kind}" data-id="${id}" aria-pressed="false">${data[id].label}</button>`
        )
        .join('');
    };
    fill(subjectOpts, 'subject', SUBJECTS);
    fill(toolOpts, 'tool', TOOLS);
  }

  function applySkin() {
    const subject = currentSubject();
    const tool = currentTool();

    stage.innerHTML = subject.svg + tool.svg;
    subjectEl = stage.querySelector('.my-subject');
    toolEl = stage.querySelector('.my-tool');

    subjectEl.style.transformOrigin = subject.origin;
    subjectEl.style.setProperty('--hit-sx', String(subject.squash[0]));
    subjectEl.style.setProperty('--hit-sy', String(subject.squash[1]));

    const [a, b, c, d] = tool.swing;
    toolEl.style.setProperty('--tool-rest', `${tool.rest}deg`);
    toolEl.style.setProperty('--sw-1', `${a}deg`);
    toolEl.style.setProperty('--sw-2', `${b}deg`);
    toolEl.style.setProperty('--sw-3', `${c}deg`);
    toolEl.style.setProperty('--sw-4', `${d}deg`);

    // 保留完整的键盘操作说明——读屏用户靠它知道回车/空格和方向键怎么用。
    // 之前这里只写了鼠标操作，把初始 HTML 里的键盘说明覆盖掉了。
    hit.setAttribute(
      'aria-label',
      `${subject.label}：单击敲击，拖动可移动或抛出；键盘用回车或空格敲击（长按连击），方向键移动`
    );

    [subjectOpts, toolOpts].forEach((box) => {
      box.querySelectorAll('.my-sk-opt').forEach((btn) => {
        const on = btn.dataset.id === skin[btn.dataset.kind];
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    });

    // 文案随形象联动：面板开着时同步刷新卡片预览
    if (!settingsEl.hidden) renderCardPreview();
  }

  function setSkin(next, silent) {
    const subject = SUBJECTS[next.subject] ? next.subject : skin.subject;
    const tool = TOOLS[next.tool] ? next.tool : skin.tool;
    const changed = subject !== skin.subject || tool !== skin.tool;
    skin = { subject, tool };
    if (changed) applySkin();
    if (!silent) save();
  }

  // 形象切换：分组容器统一代理点击
  settingsEl.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.my-sk-opt') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    setSkin({ ...skin, [btn.dataset.kind]: btn.dataset.id });
  });

  /* ------------------------------------------------------------------ *
   * 物理积分
   * ------------------------------------------------------------------ */
  function step(dt) {
    // 停靠状态：不受重力，仅把甩动留下的倾角缓缓摆正
    if (parked) {
      if (st.angle === 0) return false;
      st.angle += (0 - st.angle) * Math.min(1, 12 * dt);
      if (Math.abs(st.angle) < 0.002) st.angle = 0;
      return true;
    }

    st.vy += GRAVITY * dt;

    const drag = Math.exp(-AIR_DRAG * dt);
    st.vx *= drag;
    st.vy *= drag;
    st.omega *= Math.exp(-SPIN_DRAG * dt);

    st.x += st.vx * dt;
    st.y += st.vy * dt;
    st.angle += st.omega * dt;

    const mX = maxX();
    const mY = maxY();

    // 侧壁
    if (st.x < 0) {
      st.x = 0;
      if (st.vx < 0) {
        st.vx = -st.vx * WALL_BOUNCE;
        st.omega += 0.8;
      }
    } else if (st.x > mX) {
      st.x = mX;
      if (st.vx > 0) {
        st.vx = -st.vx * WALL_BOUNCE;
        st.omega -= 0.8;
      }
    }

    // 顶部
    if (st.y < 0) {
      st.y = 0;
      if (st.vy < 0) st.vy = -st.vy * WALL_BOUNCE;
    }

    // 地面
    if (st.y >= mY) {
      st.y = mY;
      if (st.vy > 0) {
        if (st.vy > 260) {
          st.vy = -st.vy * BOUNCE;
          st.vx *= 0.92;
          st.omega += st.vx * 0.0012; // 落地滚动耦合
        } else {
          st.vy = 0;
        }
      }
      st.vx *= Math.exp(-3.2 * dt); // 地面摩擦
    }

    st.omega = clamp(st.omega, -14, 14);
    // 角度归一化，避免长时间旋转数值发散
    if (st.angle > Math.PI || st.angle < -Math.PI) {
      st.angle = ((st.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }

    // 静止判定：落到地面且速度很小时缓缓摆正、归零
    const onFloor = st.y >= mY - 0.5;
    if (onFloor && Math.abs(st.vy) < 30 && Math.abs(st.vx) < 14) {
      st.vy = 0;
      st.vx *= Math.exp(-6 * dt);
      st.omega *= Math.exp(-7 * dt);
      st.angle += (0 - st.angle) * Math.min(1, 7 * dt);
      if (Math.abs(st.angle) < 0.002) st.angle = 0;
      if (Math.abs(st.vx) < 0.6) st.vx = 0;
      if (Math.abs(st.omega) < 0.01) st.omega = 0;
      if (st.vx === 0 && st.omega === 0 && st.angle === 0 && st.vy === 0) {
        parked = true; // 落定后转为停靠，位置写入存储
        return false; // 完全静止，停止动画循环
      }
    }

    return true;
  }

  function frame(ts) {
    rafId = 0;
    if (!lastTs) lastTs = ts;
    const dt = clamp((ts - lastTs) / 1000, 0, 1 / 30);
    lastTs = ts;

    // 拖动中：位置完全跟随指针，只把倾角摆正
    if (dragging) {
      if (st.angle !== 0) {
        st.angle += (0 - st.angle) * Math.min(1, 16 * dt);
        if (Math.abs(st.angle) < 0.002) st.angle = 0;
        render();
        if (st.angle !== 0) rafId = requestAnimationFrame(frame);
      }
      return;
    }

    const alive = step(dt);
    render();
    if (alive) rafId = requestAnimationFrame(frame);
    else flushSave(); // 落定立即记录位置
  }

  function startLoop() {
    if (rafId || collapsed) return;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ------------------------------------------------------------------ *
   * 交互：拖动 / 抛掷 / 敲击
   * ------------------------------------------------------------------ */
  hit.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragging) return;

    closeSettings(); // 开始拖动 / 敲击时收起设置面板
    e.preventDefault();
    e.stopPropagation();

    dragging = true;
    activePointer = e.pointerId;
    grabDX = e.clientX - st.x;
    grabDY = e.clientY - st.y;
    startCX = e.clientX;
    startCY = e.clientY;
    movedDist = 0;
    downAt = performance.now();
    samples = [{ t: downAt, x: e.clientX, y: e.clientY }];

    // 抓住的瞬间停止一切运动，位置完全交给指针
    st.vx = 0;
    st.vy = 0;
    st.omega = 0;
    parked = true;

    dock.classList.add('is-dragging');
    try {
      hit.setPointerCapture(e.pointerId);
    } catch (err) {
      /* noop */
    }
    startLoop(); // 拖动过程中把倾角摆正
  });

  hit.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== activePointer) return;
    e.preventDefault();

    movedDist = Math.max(movedDist, Math.hypot(e.clientX - startCX, e.clientY - startCY));

    st.x = clamp(e.clientX - grabDX, 0, maxX());
    st.y = clamp(e.clientY - grabDY, 0, maxY());

    const now = performance.now();
    samples.push({ t: now, x: e.clientX, y: e.clientY });
    while (samples.length > 2 && now - samples[0].t > 130) samples.shift();

    render();
  });

  /** 停靠：直接停在松手位置，不受重力 */
  function park() {
    parked = true;
    posFromUser = true;
    st.vx = 0;
    st.vy = 0;
    st.omega = 0;
    st.x = clamp(st.x, 0, maxX());
    st.y = clamp(st.y, 0, maxY());
    render();
    startLoop(); // 只用于把倾角摆正，正立后循环自动停止
    save();
  }

  function endDrag(e) {
    if (!dragging || e.pointerId !== activePointer) return;
    dragging = false;
    activePointer = null;
    dock.classList.remove('is-dragging');
    try {
      hit.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* noop */
    }

    const cancelled = e.type === 'pointercancel';
    const held = performance.now() - downAt;
    const tapSlop = e.pointerType === 'touch' ? 12 : 6;

    // pointercancel（系统手势 / 滚动打断）的坐标不可靠，不能拿它算速度，
    // 否则木鱼会突然朝角落高速飞出。直接停靠到当前位置。
    if (cancelled) {
      park();
      return;
    }

    // 轻点（几乎没位移）→ 敲击；拖动 / 甩动一律不触发敲击
    if (movedDist < tapSlop && held < 450) {
      knock();
      return;
    }

    // 估算松手瞬间速度：取最近 ~100ms 的指针位移
    const now = performance.now();
    samples.push({ t: now, x: e.clientX, y: e.clientY });
    let ref = samples[samples.length - 1];
    for (let i = samples.length - 1; i >= 0; i--) {
      if (now - samples[i].t <= 100) ref = samples[i];
      else break;
    }

    const span = (now - ref.t) / 1000;
    let vx = 0;
    let vy = 0;
    if (span > 0.008) {
      vx = (e.clientX - ref.x) / span;
      vy = (e.clientY - ref.y) / span;
    }

    let speed = Math.hypot(vx, vy);
    if (!Number.isFinite(speed)) speed = 0;

    // 轻拖轻放：原地停住，不抛飞、不回落
    if (speed < FLING_SPEED) {
      park();
      return;
    }

    // 减弱动态：不做重力下落/回弹/旋转，直接停在松手位置。
    // 前庭功能障碍用户开启系统「减少动态效果」后不应看到完整弹跳。
    if (reduceMotion()) {
      park();
      return;
    }

    // 快速甩动：按松手速度抛出，进入物理模拟
    if (speed > MAX_SPEED) {
      vx = (vx / speed) * MAX_SPEED;
      vy = (vy / speed) * MAX_SPEED;
    }
    st.angle = 0;
    st.vx = vx;
    st.vy = vy;
    st.omega = clamp(vx * 0.011 + (Math.random() - 0.5) * 1.4, -13, 13);
    posFromUser = true;
    parked = false;
    startLoop();
  }

  hit.addEventListener('pointerup', endDrag);
  hit.addEventListener('pointercancel', endDrag);
  hit.addEventListener('dragstart', (e) => e.preventDefault());

  /* ------------------------------------------------------------------ *
   * 键盘操作
   * ------------------------------------------------------------------ *
   * 挂件本体是个 div[role=button]，默认拿不到键盘焦点。这里让它可聚焦，
   * 回车 / 空格敲一下，按住空格可以连续敲（和真的使劲敲一样），
   * 方向键微调位置（Shift 加速），这样不用鼠标也能玩。
   * ------------------------------------------------------------------ */
  const KEY_REPEAT_DELAY = 380; // 按住多久开始连发
  const KEY_REPEAT_RATE = 140; // 连发间隔
  let keyRepeatTimer = 0;
  let keyHoldTimer = 0;

  function stopKeyRepeat() {
    if (keyHoldTimer) {
      clearTimeout(keyHoldTimer);
      keyHoldTimer = 0;
    }
    if (keyRepeatTimer) {
      clearInterval(keyRepeatTimer);
      keyRepeatTimer = 0;
    }
  }

  /** 键盘敲击：和鼠标敲击走同一条路径，只是额外给个按压反馈类 */
  function knockByKeyboard() {
    if (collapsed) return;
    hit.classList.remove('is-keypress');
    void hit.getBoundingClientRect();
    hit.classList.add('is-keypress');
    window.setTimeout(() => hit.classList.remove('is-keypress'), 400);
    // 键盘敲击稍微轻一点，连按不会太吵
    knock(0.82);
  }

  hit.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    // 方向键微调位置：可访问性上很重要，纯键盘用户没法拖动
    const step = e.shiftKey ? 24 : 8;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge) {
      e.preventDefault();
      st.x = clamp(st.x + nudge[0], 0, maxX());
      st.y = clamp(st.y + nudge[1], 0, maxY());
      posFromUser = true;
      parked = true;
      render();
      save();
      return;
    }

    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    if (e.repeat) return; // 自己控制连发节奏，不用系统默认的

    knockByKeyboard();

    // 按住不放：先等一小会儿，再开始按节奏连敲
    stopKeyRepeat();
    keyHoldTimer = window.setTimeout(() => {
      keyHoldTimer = 0;
      keyRepeatTimer = window.setInterval(knockByKeyboard, KEY_REPEAT_RATE);
    }, KEY_REPEAT_DELAY);
  });

  hit.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') stopKeyRepeat();
  });
  hit.addEventListener('blur', stopKeyRepeat);

  let meritSeq = 0;

  /**
   * 「功德 +1」飘字
   * ---------------------------------------------------------------------
   * 三件事同时发生，才显得「有分量」：
   *   ① 数字上浮 + 轻微放大后回落（弹性，不是匀速直线）
   *   ② 起手有一道横向笔锋光扫过，像写上去的
   *   ③ 背后一圈暖光晕炸开再收掉，把字从页面背景里「抬」出来
   * 连击时按槽位横向错开，并且越连越快越轻，避免糊成一片。
   */
  function spawnMerit() {
    meritSeq += 1;

    const el = document.createElement('span');
    el.className = 'my-merit';
    el.setAttribute('aria-hidden', 'true');

    // 拆成「文字」+「+1」两段：数字更大更亮，形成主次
    const verb = currentSubject().verb;
    el.innerHTML = `<i class="my-merit-verb">${verb}</i><b class="my-merit-num">+1</b>`;

    // 槽位错开：-2..2，连击时相邻两下不会叠在同一个位置
    const slot = (meritSeq % 5) - 2;
    // 横向错开幅度要够大：连击时字有 60px 宽，±15px 还是会糊在一起
    const dx = slot * 26 + (Math.random() * 8 - 4);
    const rot = Math.random() * 8 - 4;
    const dur = 1000 + Math.random() * 200;

    el.style.setProperty('--dx', dx.toFixed(1) + 'px');
    el.style.setProperty('--rot', rot.toFixed(1) + 'deg');
    el.style.setProperty('--dur', dur.toFixed(0) + 'ms');
    // 纵向也给一点随机，避免五连击排成一条绝对水平线
    el.style.top = (-10 + (meritSeq % 3) * 7 + Math.random() * 5).toFixed(1) + 'px';
    el.style.fontSize = (15 + Math.random() * 2.4).toFixed(1) + 'px';

    dock.appendChild(el);

    // 同屏最多 12 个，超出就把最老的立刻收掉，防止连击时 DOM 堆积
    const alive = dock.querySelectorAll('.my-merit');
    if (alive.length > 12) alive[0].remove();

    // 任何 animationend 都移除：prefers-reduced-motion 下动画名会变成
    // my-merit-fade，按名字判断会漏掉（虽有超时兜底，但会多活几百毫秒）。
    el.addEventListener('animationend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), dur + 300);
  }

  /**
   * 敲击涟漪 + 冲击环
   * 落点按皮肤数据（占对象宽高的百分比）定位，木鱼在底部、锦鲤在中部。
   */
  function spawnRipple() {
    const [px, py] = currentSubject().impact || [50, 62];
    const left = (4 + (px / 100) * 96).toFixed(1);
    const top = (4 + (py / 100) * 96).toFixed(1);

    // 内圈：贴着落点的一小圈暖光
    const ring = document.createElement('span');
    ring.className = 'my-ripple';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    dock.appendChild(ring);

    // 外圈：更大更淡的一圈冲击波，把「受力」传出去
    const wave = document.createElement('span');
    wave.className = 'my-ripple my-ripple-wave';
    wave.setAttribute('aria-hidden', 'true');
    wave.style.left = `${left}px`;
    wave.style.top = `${top}px`;
    dock.appendChild(wave);

    const clean = (el, ms) => {
      el.addEventListener('animationend', () => el.remove(), { once: true });
      window.setTimeout(() => el.remove(), ms);
    };
    clean(ring, 700);
    clean(wave, 900);
  }

  function knock(strength = 1) {
    recordKnock();
    sound.play(strength, currentSubject().tone);
    spawnMerit();
    spawnRipple();

    if (!subjectEl || !toolEl) return;
    subjectEl.classList.remove('is-hit');
    toolEl.classList.remove('is-swing');
    // 强制回流，让动画可以连续重放
    void subjectEl.getBoundingClientRect();
    void toolEl.getBoundingClientRect();
    subjectEl.classList.add('is-hit');
    toolEl.classList.add('is-swing');
  }

  /* ------------------------------------------------------------------ *
   * 自动敲击
   * ------------------------------------------------------------------ */
  function stopAuto() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
  }

  /**
   * 排下一拍：执行完这一拍再排下一次（递归 setTimeout），
   * 因此即使某一拍被浏览器延迟，也不会积压出一串连击。
   */
  function scheduleAuto(delay) {
    stopAuto();
    if (!autoOn || collapsed) return;
    autoTimer = window.setTimeout(() => {
      autoTimer = 0;
      if (!autoOn || collapsed) return;
      knock();
      scheduleAuto(autoInterval);
    }, delay == null ? autoInterval : delay);
  }

  function updateAutoBtn() {
    autoSwitch.classList.toggle('is-on', autoOn);
    autoSwitch.setAttribute('aria-checked', String(autoOn));
    autoSwitch.setAttribute('aria-label', autoOn ? '停止自动敲击' : '自动敲击');
  }

  function setAuto(value, silent, knockNow = true) {
    autoOn = value;
    updateAutoBtn();
    if (autoOn && !collapsed) {
      if (knockNow) knock(); // 开启后立刻敲一下，给出即时反馈
      scheduleAuto(autoInterval);
    } else {
      stopAuto();
    }
    if (!silent) save();
  }

  autoSwitch.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAuto(!autoOn);
  });

  /** 节奏：改完立刻按新节奏重排下一拍（不改开关状态） */
  function setTempo(ms, silent) {
    const v = Number(ms);
    autoInterval = Number.isFinite(v) ? clamp(Math.round(v), 200, 5000) : AUTO_INTERVAL;
    if (!silent) save();
    if (autoOn && !collapsed) scheduleAuto(autoInterval);
  }

  tempoSel.addEventListener('change', (e) => {
    e.stopPropagation();
    setTempo(tempoSel.value);
  });

  /* ------------------------------------------------------------------ *
   * 收起 / 展开
   * ------------------------------------------------------------------ */
  function setCollapsed(value, silent) {
    collapsed = value;
    dock.style.display = value ? 'none' : '';
    tabEl.style.display = value ? 'flex' : 'none';
    if (value) {
      stopAuto(); // 收起时暂停自动敲击
      stopLoop();
      positionTab();
    } else {
      startLoop();
      if (autoOn) {
        knock();
        scheduleAuto(autoInterval); // 展开后按原状态继续
      }
    }
    if (!silent) save();
  }

  tabEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCollapsed(false);
  });

  collapseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCollapsed(true);
  });

  /* ------------------------------------------------------------------ *
   * 声音开关
   * ------------------------------------------------------------------ */
  /**
   * 声音开关。
   * 语义统一为「声音是否开启」：亮起 = 有声音，关闭 = 静音。
   * 与「自动敲击」开关保持一致（都是亮起=功能开启），避免两个开关
   * 一个正向一个反向造成误读。内部仍用 sound.muted 存储，
   * 因为静音是默认值更稳妥（未初始化时不会突然出声）。
   */
  function updateSoundBtn() {
    const on = !sound.muted;
    soundSwitch.classList.toggle('is-on', on);
    soundSwitch.setAttribute('aria-checked', String(on));
    soundSwitch.setAttribute('aria-label', on ? '声音（关闭后静音）' : '声音已关闭，开启后恢复音效');
  }

  soundSwitch.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sound.muted = !sound.muted;
    updateSoundBtn();
    if (!sound.muted) sound.play(0.75, currentSubject().tone);
    save();
  });

  /* ------------------------------------------------------------------ *
   * 每日目标：1–9999 的自定义数字，改完即时生效
   * ------------------------------------------------------------------ */
  function setGoal(value) {
    const n = Math.round(Number(value));
    const goal = Number.isFinite(n) ? clamp(n, 1, 9999) : GOAL;
    // goalTime 独立更新，不受敲击影响（见 stats.js 的说明）
    if (!Stats.applyGoal(stats, goal, Date.now())) {
      goalInput.value = String(stats.goal);
      return;
    }
    updateStatsUI();
    saveStats();
  }

  goalInput.addEventListener('change', () => setGoal(goalInput.value));
  goalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setGoal(goalInput.value);
      goalInput.blur();
    }
  });

  /* ------------------------------------------------------------------ *
   * 持久化（位置比例、收起状态、静音状态）
   * ------------------------------------------------------------------ */
  function writeState() {
    try {
      if (!(window.chrome && chrome.storage && chrome.storage.local)) return;
      chrome.storage.local.set(
        {
          [STORAGE_KEY]: {
            fx: st.x / Math.max(1, vw()),
            fy: st.y / Math.max(1, vh()),
            collapsed,
            muted: sound.muted,
            auto: autoOn,
            tempo: autoInterval,
            subject: skin.subject,
            tool: skin.tool,
            copy: { ...copy }
          }
        },
        () => {
          void (chrome.runtime && chrome.runtime.lastError);
        }
      );
    } catch (err) {
      /* noop */
    }
  }

  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      writeState();
    }, 250);
  }

  /** 页面隐藏 / 卸载前立即落盘，避免节流导致位置丢失 */
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    writeState();
  }

  window.addEventListener('pagehide', () => {
    flushSave();
    flushStats();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSave();
      flushStats();
      // 后台标签页的 setTimeout 会被浏览器节流，自动敲击会在无操作时继续计数。
      // 与「收起」保持一致：隐藏即暂停，回来再按原状态恢复。
      if (autoOn && autoTimer) stopAuto();
      return;
    }

    // 回到页面时主动拉取一次存档并合并。
    // 原因：后台标签页可能被冻结，期间错失 chrome.storage.onChanged 事件；
    // 只靠事件监听会导致回到前台后看到过期计数（多标签页并发时尤其明显）。
    const before = stats.todayDate;
    rollStats();
    if (before !== stats.todayDate) updateStatsUI();

    loadStats().then(() => {
      updateStatsUI();
      // 恢复自动敲击（setAuto 会重新排拍；不立刻敲，避免切回来就响一声）
      if (autoOn && !collapsed) scheduleAuto(autoInterval);
    });
  });

  function loadState() {
    return new Promise((resolve) => {
      try {
        if (!(window.chrome && chrome.storage && chrome.storage.local)) {
          resolve(null);
          return;
        }
        chrome.storage.local.get(STORAGE_KEY, (res) => {
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(res && res[STORAGE_KEY] ? res[STORAGE_KEY] : null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */
  function initPosition(saved) {
    if (saved && Number.isFinite(saved.fx) && Number.isFinite(saved.fy)) {
      posFromUser = true;
      st.x = clamp(saved.fx * vw(), 0, maxX());
      st.y = clamp(saved.fy * vh(), 0, maxY());
    } else {
      posFromUser = false;
      st.x = Math.max(0, vw() - BOX - 18);
      st.y = maxY();
    }
    parked = true; // 恢复的位置直接停靠，不下落
    render();
  }

  window.addEventListener(
    'resize',
    () => {
      if (!vw() || !vh()) return;
      if (posFromUser) {
        st.x = clamp(st.x, 0, maxX());
        st.y = clamp(st.y, 0, maxY());
      } else {
        // 用户没摆过位置：始终贴回右下角默认位置
        st.x = Math.max(0, vw() - BOX - 18);
        st.y = maxY();
      }
      render();
      if (collapsed) positionTab();
      else if (!parked) startLoop();
    },
    { passive: true }
  );

  (async () => {
    const statsReady = loadStats();
    const saved = await Promise.race([
      loadState(),
      new Promise((resolve) => window.setTimeout(() => resolve(null), 800))
    ]);
    statsReady.then(() => {
      statsLoaded = true; // 存档就绪，此后敲击才会被计入
      updateStatsUI();
    }); // 数据到达后刷新，不阻塞挂件出现
    // 等布局可用再定位（隐藏标签页 / 自动化环境下 clientWidth 可能短暂为 0）。
    // 注意：requestAnimationFrame 在隐藏标签页里根本不触发，不能无限等它——
    // 用 rAF 与 setTimeout 竞速，保证后台打开的页面也能完成初始化。
    for (let i = 0; i < 12; i++) {
      await Promise.race([
        new Promise((resolve) => requestAnimationFrame(resolve)),
        new Promise((resolve) => window.setTimeout(resolve, 60))
      ]);
      if (vw() > 160 && vh() > 160) break;
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    buildSkinOptions();
    applySkin(); // 先用默认形象渲染，随后按存档覆盖
    initPosition(saved);
    updateStatsUI();
    watchStatsSync();
    if (saved) {
      if (saved.copy && typeof saved.copy === 'object') {
        COPY_KEYS.forEach((k) => {
          const v = saved.copy[k];
          if (typeof v === 'string' && v.trim()) copy[k] = v.trim().slice(0, COPY_MAX[k]);
        });
      }
      if (typeof saved.muted === 'boolean') sound.muted = saved.muted;
      if (Number.isFinite(saved.tempo)) {
        setTempo(saved.tempo, true);
        tempoSel.value = String(autoInterval);
        if (tempoSel.selectedIndex < 0) tempoSel.value = String(AUTO_INTERVAL);
      }
      if (typeof saved.subject === 'string' || typeof saved.tool === 'string') {
        setSkin({ subject: saved.subject, tool: saved.tool }, true);
      }
      if (saved.collapsed) setCollapsed(true, true);
      if (saved.auto) setAuto(true, true, false); // 恢复自动模式：只排拍，不立刻敲
    }
    updateSoundBtn();
    updateAutoBtn();
    host.style.visibility = '';
    if (!collapsed) startLoop();
  })();
})();
