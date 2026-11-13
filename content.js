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
  const vw = () => document.documentElement.clientWidth || window.innerWidth || 0;
  const vh = () => document.documentElement.clientHeight || window.innerHeight || 0;
  const maxX = () => Math.max(0, vw() - BOX);
  const maxY = () => Math.max(0, vh() - BOX - FLOOR_GAP);

  /* ------------------------------------------------------------------ *
   * 音效：Web Audio 合成木鱼“叩”声，不依赖任何音频文件
   * ------------------------------------------------------------------ */
  const sound = {
    ctx: null,
    master: null,
    muted: false,

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          this.ctx = new AC();
        } catch (err) {
          return null;
        }
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 24;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.2;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.72;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },

    play(strength = 1) {
      if (this.muted) return;
      const ctx = this.ensure();
      if (!ctx) return;

      const t = ctx.currentTime + 0.001;
      const base = 470 * (0.94 + Math.random() * 0.13); // 每下略有差异，避免机械感
      const vol = 0.62 * strength;

      const out = ctx.createGain();
      out.gain.value = 1;
      out.connect(this.master);

      // 1) 木质腔体共鸣：三角波 + 快速下滑音高
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(base * 1.85, t);
      body.frequency.exponentialRampToValueAtTime(base, t + 0.045);
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      body.connect(bodyGain).connect(out);
      body.start(t);
      body.stop(t + 0.2);

      // 2) 木片高频“嗒”
      const clack = ctx.createOscillator();
      clack.type = 'sine';
      clack.frequency.setValueAtTime(base * 3.05, t);
      const clackGain = ctx.createGain();
      clackGain.gain.setValueAtTime(0.0001, t);
      clackGain.gain.exponentialRampToValueAtTime(vol * 0.34, t + 0.003);
      clackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      clack.connect(clackGain).connect(out);
      clack.start(t);
      clack.stop(t + 0.08);

      // 3) 敲击瞬态噪声
      const len = Math.max(1, Math.floor(ctx.sampleRate * 0.045));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2100;
      bp.Q.value = 1.1;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(vol * 0.75, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      noise.connect(bp).connect(noiseGain).connect(out);
      noise.start(t);

      window.setTimeout(() => {
        try {
          out.disconnect();
        } catch (err) {
          /* noop */
        }
      }, 420);
    }
  };

  /* ------------------------------------------------------------------ *
   * 图形
   * ------------------------------------------------------------------ */
  const FISH_SVG = `
    <svg class="my-subject" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="myWood" cx="34%" cy="20%" r="94%">
          <stop offset="0%" stop-color="#f8d4a0"/>
          <stop offset="26%" stop-color="#e2a55f"/>
          <stop offset="58%" stop-color="#af6729"/>
          <stop offset="86%" stop-color="#7f4114"/>
          <stop offset="100%" stop-color="#542609"/>
        </radialGradient>
        <linearGradient id="myRim" x1="0.12" y1="0" x2="0.62" y2="1">
          <stop offset="0%" stop-color="#ffe7c3"/>
          <stop offset="34%" stop-color="#cf8c47"/>
          <stop offset="74%" stop-color="#8a4a19"/>
          <stop offset="100%" stop-color="#401c05"/>
        </linearGradient>
        <linearGradient id="myEdge" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stop-color="#fff2da" stop-opacity="0.85"/>
          <stop offset="38%" stop-color="#ffd79f" stop-opacity="0.16"/>
          <stop offset="72%" stop-color="#6b3208" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#3d1903" stop-opacity="0.4"/>
        </linearGradient>
        <radialGradient id="myGloss" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fffaf0" stop-opacity="0.74"/>
          <stop offset="55%" stop-color="#fffaf0" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#fffaf0" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="myShade" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stop-color="#3a1602" stop-opacity="0"/>
          <stop offset="68%" stop-color="#3a1602" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="#3a1602" stop-opacity="0.34"/>
        </radialGradient>
        <filter id="myShadow" x="-40%" y="-30%" width="180%" height="190%">
          <feDropShadow dx="0" dy="4" stdDeviation="3.2" flood-color="#2a1204" flood-opacity="0.42"/>
        </filter>
        <clipPath id="myClip">
          <path d="M60 27c23 0 38 15 38 34s-16 34-38 34-38-15-38-34 15-34 38-34Z"/>
        </clipPath>
      </defs>
      <g filter="url(#myShadow)">
        <path d="M60 20c27 0 45 18 45 41 0 24-19 41-45 41S15 85 15 61C15 38 33 20 60 20Z" fill="url(#myRim)"/>
        <path d="M60 27c23 0 38 15 38 34s-16 34-38 34-38-15-38-34 15-34 38-34Z" fill="url(#myWood)"/>
        <g clip-path="url(#myClip)">
          <g opacity="0.17" fill="none" stroke="#3d1d05" stroke-linecap="round">
            <path d="M21 46c12-8 28-11 44-9 10 1 18 4 25 8" stroke-width="1.7"/>
            <path d="M19 59c16-7 35-9 53-6 8 1 16 3 22 6" stroke-width="1.3"/>
            <path d="M21 71c16-4 34-5 51-3 8 1 15 3 21 6" stroke-width="1.6"/>
            <path d="M27 83c14 3 30 3 46-1 8-2 14-5 18-8" stroke-width="1.2"/>
            <path d="M33 35c8-4 18-6 28-6 8 0 16 2 22 5" stroke-width="1.15"/>
          </g>
          <g opacity="0.14" fill="none" stroke="#ffe2b4" stroke-linecap="round">
            <path d="M23 51c12-7 27-10 42-9" stroke-width="1.2"/>
            <path d="M25 65c15-5 31-7 46-6" stroke-width="1"/>
          </g>
          <rect x="10" y="10" width="100" height="100" fill="url(#myShade)"/>
          <ellipse cx="44" cy="39" rx="21" ry="9" fill="url(#myGloss)" transform="rotate(-20 44 39)"/>
        </g>
        <path d="M60 27c23 0 38 15 38 34s-16 34-38 34-38-15-38-34 15-34 38-34Z" fill="none" stroke="url(#myEdge)" stroke-width="2.6"/>
        <g fill="none" stroke="#4a2408" stroke-width="2.6" opacity="0.85">
          <circle cx="42" cy="50" r="7.5"/>
          <circle cx="78" cy="50" r="7.5"/>
        </g>
        <g fill="#4a2408" opacity="0.85">
          <circle cx="42" cy="50" r="2.4"/>
          <circle cx="78" cy="50" r="2.4"/>
        </g>
        <path d="M36 76c14 8 36 9 52-2" fill="none" stroke="#3a1c06" stroke-width="6" stroke-linecap="round" opacity="0.72"/>
      </g>
    </svg>`;

  const MALLET_SVG = `
    <svg class="my-tool" viewBox="0 0 60 100" aria-hidden="true">
      <defs>
        <linearGradient id="myHead" x1="0.2" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stop-color="#f4cb94"/>
          <stop offset="45%" stop-color="#c4823c"/>
          <stop offset="100%" stop-color="#6d3510"/>
        </linearGradient>
      </defs>
      <rect x="26.5" y="22" width="8" height="72" rx="4" fill="#a8692c"/>
      <rect x="26.5" y="22" width="3" height="72" rx="1.5" fill="#cf9350" opacity="0.65"/>
      <circle cx="30.5" cy="18" r="15.5" fill="url(#myHead)"/>
      <ellipse cx="25" cy="12" rx="5.5" ry="3.6" fill="#fff3dd" opacity="0.45"/>
    </svg>`;

  /** 被敲对象之二：锦鲤 */
  const KOI_SVG = `
    <svg class="my-subject" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="koiBody" cx="34%" cy="26%" r="88%">
          <stop offset="0%" stop-color="#ffe2ba"/>
          <stop offset="30%" stop-color="#f4ae5b"/>
          <stop offset="68%" stop-color="#cf7a2c"/>
          <stop offset="100%" stop-color="#8f3f0d"/>
        </radialGradient>
        <linearGradient id="koiFin" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stop-color="#ffd9a8"/>
          <stop offset="55%" stop-color="#e79345"/>
          <stop offset="100%" stop-color="#b85618"/>
        </linearGradient>
        <radialGradient id="koiGloss" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fffaf0" stop-opacity="0.72"/>
          <stop offset="60%" stop-color="#fffaf0" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#fffaf0" stop-opacity="0"/>
        </radialGradient>
        <filter id="koiShadow" x="-40%" y="-30%" width="180%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.6" flood-color="#2a1204" flood-opacity="0.38"/>
        </filter>
      </defs>
      <g filter="url(#koiShadow)">
        <path d="M84 60c8-11 16-16 24-15 1.5 7-1.5 13-7 17 5.5 4 8.5 10 7 17-8 1-16-4-24-15Z" fill="url(#koiFin)"/>
        <path d="M58 37c7-8 17-11 26-8-6 5-10 11-12 18Z" fill="url(#koiFin)"/>
        <path d="M54 84c7 8 17 11 26 8-6-5-10-11-12-18Z" fill="url(#koiFin)"/>
        <ellipse cx="55" cy="61" rx="33" ry="25" transform="rotate(-6 55 61)" fill="url(#koiBody)"/>
        <path d="M52 72c7 5 15 6 22 3-6 8-17 10-24 6Z" fill="url(#koiFin)" opacity="0.9"/>
        <g fill="none" stroke="#8a3b0c" stroke-width="1.4" opacity="0.22" stroke-linecap="round">
          <path d="M40 50c7-3 15-3 22 0"/>
          <path d="M38 60c8-3 17-3 25 0"/>
          <path d="M40 70c7-3 15-3 22 0"/>
          <path d="M46 46c2 4 2 8 0 12"/>
          <path d="M58 46c2 4 2 8 0 12"/>
          <path d="M46 66c2 4 2 8 0 12"/>
          <path d="M58 66c2 4 2 8 0 12"/>
        </g>
        <circle cx="36" cy="54" r="6.2" fill="#fffaf0"/>
        <circle cx="36.4" cy="54.4" r="3" fill="#3a1a06"/>
        <circle cx="34.6" cy="52.6" r="1" fill="#fff"/>
        <path d="M24 63c3 2 6 2 9 0" fill="none" stroke="#7c3408" stroke-width="2.2" stroke-linecap="round" opacity="0.8"/>
        <ellipse cx="46" cy="45" rx="16" ry="8" fill="url(#koiGloss)" transform="rotate(-16 46 45)"/>
      </g>
    </svg>`;

  /** 敲击工具之二：手 */
  const HAND_SVG = `
    <svg class="my-tool" viewBox="0 0 60 100" aria-hidden="true">
      <defs>
        <linearGradient id="handSkin" x1="0.2" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stop-color="#ffe0c2"/>
          <stop offset="45%" stop-color="#f0b98d"/>
          <stop offset="100%" stop-color="#c5814f"/>
        </linearGradient>
      </defs>
      <rect x="25" y="56" width="14" height="44" rx="7" fill="url(#handSkin)"/>
      <path d="M21 64c-2-9-1-19 3-26 2-4 7-5 9-1 1 2 2 5 2 8 0-8 2-13 6-13 5 0 7 5 7 13 0 2 0 4-1 6 3-3 7-2 7 2 0 4-2 9-5 13-4 5-9 7-15 7s-11-3-13-9Z" fill="url(#handSkin)"/>
      <g stroke="#b06d3d" stroke-width="1.4" opacity="0.55" fill="none" stroke-linecap="round">
        <path d="M31 46c-1 6-1 12 0 17"/>
        <path d="M38 42c-1 7-1 13 0 19"/>
        <path d="M44 44c0 6 0 11-1 16"/>
      </g>
      <ellipse cx="30" cy="52" rx="6" ry="3.4" fill="#fff2e2" opacity="0.5"/>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 皮肤注册表
   * 每个形象都是一份纯数据：图形 + 文案 + 敲击形变/挥动轨迹。
   * 新增形象（铜钟、猫爪…）只需在这里追加一项，交互逻辑无需改动。
   * ------------------------------------------------------------------ */
  const SUBJECTS = {
    muyu: {
      label: '木鱼',
      verb: '功德',
      // 功德卡上的默认文案：换形象时自动跟着变
      copy: {
        title: '功德',
        today: '今日功德',
        total: '累计功德',
        streak: '连续敲击',
        goal: '目标完成',
        footer: '木鱼挂件 · 敲一下，功德 +1'
      },
      svg: FISH_SVG,
      squash: [1.07, 0.9], // 敲击瞬间的 x/y 缩放峰值
      origin: '50% 78%', // 形变原点（与木鱼重心一致）
      impact: [50, 64] // 敲击落点（占对象宽高的百分比），用于涟漪
    },
    fish: {
      label: '鱼',
      verb: '摸鱼',
      copy: {
        title: '摸鱼',
        today: '今日摸鱼',
        total: '累计摸鱼',
        streak: '连续摸鱼',
        goal: '目标完成',
        footer: '木鱼挂件 · 摸一下，摸鱼 +1'
      },
      svg: KOI_SVG,
      squash: [1.05, 0.93],
      origin: '50% 74%',
      impact: [48, 60]
    }
  };

  const TOOLS = {
    mallet: {
      label: '木槌',
      svg: MALLET_SVG,
      rest: -26, // 静止角度
      swing: [-26, 24, -34, -22] // 挥动关键帧角度
    },
    hand: {
      label: '手',
      svg: HAND_SVG,
      rest: -56,
      swing: [-56, -18, -72, -58]
    }
  };

  const SKIN_DEFAULT = { subject: 'muyu', tool: 'mallet' };

  const MINI_FISH = `
    <svg class="my-tab-fish" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 6c10 0 16 6 16 14s-7 15-16 15S4 28 4 20 10 6 20 6Z" fill="#8a4a19"/>
      <path d="M20 10c8 0 12 4 12 10s-5 11-12 11S8 27 8 20s4-10 12-10Z" fill="#d79a55"/>
      <path d="M12 24c4 3 13 3 18-1" fill="none" stroke="#4a2408" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
    </svg>`;

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
      <div class="my-hit" id="hit" role="button" aria-label="木鱼：单击敲击，拖动可移动或抛出"></div>
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
              <span>静音</span>
              <button class="my-switch" id="soundSwitch" type="button" role="switch" aria-checked="false" aria-label="静音"><i></i></button>
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
            <button class="my-save" id="saveCard" type="button">保存功德卡</button>
          </div>
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

  let stats = {
    total: 0,
    today: 0,
    todayDate: todayKey(),
    streak: 0,
    lastDate: '',
    goal: GOAL,
    savedAt: 0
  };
  let statsSaveTimer = 0;
  let syncTimer = 0;

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
      area.set({ [STATS_KEY]: value }, () => {
        const failed = !!(chrome.runtime && chrome.runtime.lastError);
        if (cb) cb(!failed);
      });
    } catch (err) {
      if (cb) cb(false);
    }
  }

  /** 存档容错：任何脏数据都退回安全值，避免一处坏数据让计数变 NaN */
  function normalizeStats(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    return {
      total: count(raw.total),
      today: count(raw.today),
      todayDate: date(raw.todayDate),
      streak: count(raw.streak),
      lastDate: date(raw.lastDate),
      goal: Number.isFinite(raw.goal) && raw.goal > 0 ? Math.floor(raw.goal) : GOAL,
      savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : 0
    };
  }

  /** 合并两份存档（本地 / 云端）：计数器取较大值，日期取较新值 */
  function mergeStats(a, b) {
    if (!a) return b;
    if (!b) return a;
    const todayDate = a.todayDate > b.todayDate ? a.todayDate : b.todayDate;
    const lastDate = a.lastDate > b.lastDate ? a.lastDate : b.lastDate;
    const streak =
      a.lastDate === b.lastDate ? Math.max(a.streak, b.streak) : a.lastDate > b.lastDate ? a.streak : b.streak;
    return {
      total: Math.max(a.total, b.total),
      today: Math.max(a.todayDate === todayDate ? a.today : 0, b.todayDate === todayDate ? b.today : 0),
      todayDate,
      lastDate,
      streak,
      goal: a.savedAt >= b.savedAt ? a.goal : b.goal,
      savedAt: Math.max(a.savedAt, b.savedAt)
    };
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

  function recordKnock() {
    const t = todayKey();
    const y = shiftDayKey(-1);
    if (stats.todayDate !== t) {
      stats.todayDate = t;
      stats.today = 0;
    }
    if (stats.lastDate !== t) {
      stats.streak = stats.lastDate === y ? stats.streak + 1 : 1;
      stats.lastDate = t;
    }
    stats.total += 1;
    stats.today += 1;
    stats.savedAt = Date.now();
    updateStatsUI();
    saveStats();
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
        const merged = mergeStats(normalizeStats(local), normalizeStats(cloud));
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

  /** 另一台设备改了数据：取合并结果刷新界面 */
  function watchStatsSync() {
    try {
      if (!statsArea('sync') || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes[STATS_KEY]) return;
        const incoming = normalizeStats(changes[STATS_KEY].newValue);
        if (!incoming) return;
        const merged = mergeStats(stats, incoming);
        if (
          merged.total === stats.total &&
          merged.today === stats.today &&
          merged.streak === stats.streak &&
          merged.goal === stats.goal
        )
          return;
        stats = merged;
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
  }

  function closeSettings() {
    if (settingsEl.hidden) return;
    // 正在改文案时先把字落下来，避免收起丢输入
    const editing = cardSlot.querySelector('.my-cv-edit.is-editing .my-cv-input');
    if (editing) editing.blur();
    settingsEl.hidden = true;
    dock.classList.remove('is-open');
    setBtn.setAttribute('aria-expanded', 'false');
  }

  setBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (settingsEl.hidden) openSettings();
    else closeSettings();
  });

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
    drawCard(ctx, avatar);
    return canvas;
  }

  saveCardBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (saveCardBtn.classList.contains('is-busy')) return;
    const label = saveCardBtn.textContent;
    saveCardBtn.classList.add('is-busy');
    saveCardBtn.textContent = '正在生成…';
    try {
      const canvas = await buildCard();
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
      saveCardBtn.textContent = '已保存';
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

    hit.setAttribute('aria-label', `${subject.label}：单击敲击，拖动可移动或抛出`);

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

    // 轻点（几乎没位移）→ 敲击；拖动 / 甩动一律不触发敲击
    if (!cancelled && movedDist < tapSlop && held < 450) {
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

  let meritSeq = 0;

  /** 木鱼上方飘出「功德+1」，连续敲击时按槽位错开，避免重叠 */
  function spawnMerit() {
    meritSeq += 1;
    const el = document.createElement('span');
    el.className = 'my-merit';
    el.textContent = `${currentSubject().verb}+1`;
    el.setAttribute('aria-hidden', 'true');

    // -2 ~ 2 的槽位 + 随机抖动，保证连击时位置错开
    const slot = (meritSeq % 5) - 2;
    const dx = slot * 13 + (Math.random() * 8 - 4);
    const rot = Math.random() * 10 - 5;
    el.style.setProperty('--dx', dx.toFixed(1) + 'px');
    el.style.setProperty('--rot', rot.toFixed(1) + 'deg');
    el.style.setProperty('--dur', (940 + Math.random() * 180).toFixed(0) + 'ms');
    el.style.top = (Math.random() * 12 - 2).toFixed(1) + 'px';
    el.style.fontSize = (14 + Math.random() * 3).toFixed(1) + 'px';

    dock.appendChild(el);
    const alive = dock.querySelectorAll('.my-merit');
    if (alive.length > 14) alive[0].remove();
    el.addEventListener('animationend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 2200);
  }

  /** 敲击落点的一圈涟漪：扩散淡出，强化“受力”的即时感 */
  function spawnRipple() {
    const [px, py] = currentSubject().impact || [50, 62];
    const el = document.createElement('span');
    el.className = 'my-ripple';
    el.setAttribute('aria-hidden', 'true');
    el.style.left = `${(4 + (px / 100) * 96).toFixed(1)}px`;
    el.style.top = `${(4 + (py / 100) * 96).toFixed(1)}px`;
    dock.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 900);
  }

  function knock() {
    recordKnock();
    sound.play(1);
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
  function updateSoundBtn() {
    soundSwitch.classList.toggle('is-on', !sound.muted);
    soundSwitch.setAttribute('aria-checked', String(!sound.muted));
    soundSwitch.setAttribute('aria-label', sound.muted ? '开启声音' : '静音');
  }

  soundSwitch.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sound.muted = !sound.muted;
    updateSoundBtn();
    if (!sound.muted) sound.play(0.75);
    save();
  });

  /* ------------------------------------------------------------------ *
   * 每日目标：1–9999 的自定义数字，改完即时生效
   * ------------------------------------------------------------------ */
  function setGoal(value) {
    const n = Math.round(Number(value));
    const goal = Number.isFinite(n) ? clamp(n, 1, 9999) : GOAL;
    if (goal === stats.goal) {
      goalInput.value = String(goal);
      return;
    }
    stats.goal = goal;
    stats.savedAt = Date.now();
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
      return;
    }
    // 回到页面时若已跨天，把今日计数归零
    const before = stats.todayDate;
    rollStats();
    if (before !== stats.todayDate) updateStatsUI();
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
    statsReady.then(updateStatsUI); // 数据到达后刷新，不阻塞挂件出现
    // 等布局可用再定位（隐藏标签页 / 自动化环境下 clientWidth 可能短暂为 0）
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
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
