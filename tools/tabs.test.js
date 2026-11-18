/**
 * 多标签页数据一致性测试（自包含：自己启动带全新 profile 的 Chrome）
 * 用法：node tools/tabs.test.js
 *
 * 复现审查发现的 H1：两个标签页并发敲击，旧实现用 max 覆盖会丢计数。
 * 本测试每次都用一个全新的临时 profile + 全新 CDP 端口，保证 storage 从零开始，
 * 于是可以用绝对值断言，不受历史残留数据干扰。
 *
 * 需要：本机 Chrome/Edge（或 CHROME_PATH），以及已打包的 dist/*.zip 解包后的扩展。
 * 默认加载仓库根目录（未打包扩展即可，manifest 相同）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = process.env.TEST_URL || 'https://example.com/';
const PORT = 9600 + Math.floor(Math.random() * 300);
const ROOT = path.resolve(__dirname, '..');

/* ---------- 找 Chrome ---------- */
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1246/chrome-win64/chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome/Edge，请设置 CHROME_PATH');
  process.exit(1);
}

class Tab {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const t = new Tab(ws);
    await t.send('Page.enable');
    await t.send('Runtime.enable');
    return t;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() { this.ws.close(); }
}

const newTarget = async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  return r.json();
};
const closeTarget = async (id) => {
  try { await fetch(`http://127.0.0.1:${PORT}/json/close/${id}`); } catch (e) { /* noop */ }
};

const knockScript = (n) => `(async () => {
  const r = document.querySelector('muyu-widget').shadowRoot;
  const hit = r.getElementById('hit'); hit.focus();
  for (let i = 0; i < ${n}; i++) {
    hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
  }
  // 等 statsLoaded + UI 刷新：递增等待直到 total 稳定
  let last = '0';
  for (let i=0;i<12;i++) {
    await new Promise(s=>setTimeout(s,250));
    const cur = r.getElementById('spTotal').textContent;
    if (cur === last && Number(cur) > 0) break;
    last = cur;
  }
  return last;
})()`;
const readTotal = `(() => {
  const r=document.querySelector('muyu-widget').shadowRoot;
  return Number(r.getElementById('spTotal').textContent.replace(/,/g,''));
})()`;

async function main() {
  let failed = 0;
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failed++;
  };

  // 全新 profile —— 每次测试 storage 都从零开始
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'muyu-tabs-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-background-networking',
    `--load-extension=${ROOT}`,
    `--disable-extensions-except=${ROOT}`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  proc.unref();

  let A, B, tabA, tabB;
  try {
    // 等 CDP 就绪
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) { ready = true; break; }
      } catch (e) { /* noop */ }
    }
    if (!ready) throw new Error('Chrome CDP 启动超时');

    A = await newTarget();
    B = await newTarget();
    tabA = await Tab.connect(A.webSocketDebuggerUrl);
    tabB = await Tab.connect(B.webSocketDebuggerUrl);

    await tabA.send('Page.navigate', { url: BASE + '?t=a' });
    await tabB.send('Page.navigate', { url: BASE + '?t=b' });
    await sleep(9000); // 等 statsLoaded（headless 无账号时 sync.get 回调可能很慢）

    const baseA = await tabA.eval(readTotal);
    const baseB = await tabB.eval(readTotal);
    check('全新环境基线为 0', baseA === 0 && baseB === 0, `A=${baseA} B=${baseB}`);

    // 两个标签页各自敲击（sessionId 不同）
    const aToday = await tabA.eval(knockScript(5));
    const bToday = await tabB.eval(knockScript(3));

    console.log('\n[本机计数]');
    check('A 敲了 5 下', Number(aToday) === 5, `total=${aToday}`);
    // B 会实时合并 A 的 5 下，所以这里看到 8
    check('B 看到双方共 8 下', Number(bToday) === 8, `total=${bToday}`);

    // 后台标签页可能冻结错失事件：切回 A 触发主动同步
    await tabA.send('Page.bringToFront');
    await sleep(1500);

    const aAfter = await tabA.eval(readTotal);
    const bAfter = await tabB.eval(readTotal);
    console.log('\n[合并收敛]');
    check('A 累计 = 8（5+3 都保住）', aAfter === 8, `A=${aAfter}`);
    check('B 累计 = 8（收敛一致）', bAfter === 8, `B=${bAfter}`);

    // 刷新 A，确认落盘
    await tabA.send('Page.navigate', { url: `${BASE}?reload=${Date.now()}` });
    await sleep(3500);
    const aReload = await tabA.eval(readTotal);
    console.log('\n[持久化]');
    check('刷新后累计仍为 8', aReload === 8, `total=${aReload}`);
  } finally {
    if (tabA) tabA.close();
    if (tabB) tabB.close();
    if (A) await closeTarget(A.id);
    if (B) await closeTarget(B.id);
    try { process.kill(-proc.pid); } catch (e) { try { proc.kill(); } catch (e2) { /* noop */ } }
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (e) { console.warn('（临时 profile 未清理：' + profile + '）'); }
  }

  console.log(`\n${failed ? failed + ' 项失败' : '全部通过'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('测试失败：' + e.message); process.exit(1); });
