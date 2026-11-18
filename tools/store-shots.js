/**
 * 批量生成 Chrome / Edge 商店截图。
 *
 * 商店要求：1280×800 或 640×400，1–5 张，必须展示真实功能，
 * 不得含虚假 UI 或与功能无关的装饰文字。这里用真实页面 + 真实挂件
 * 渲染，所有数据都是扩展自己产生的。
 *
 * 用法：node tools/store-shots.js
 * 输出：tools/shots/store/01-hero.png ... 05-fish.png
 */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9333;
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:8899';
const OUT = path.resolve(__dirname, 'shots', 'store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = [
  { name: '01-hero',    desc: '主视觉：木鱼 + 功德飘字' },
  { name: '02-knock',   desc: '敲击瞬间：涟漪 + 形变' },
  { name: '03-panel',   desc: '设置面板：四组功能' },
  { name: '04-card',    desc: '功德卡：导出预览' },
  { name: '05-fish',    desc: '锦鲤形象：摸鱼模式' }
];

/**
 * 每个场景用一个自包含的 HTML 页面，用 <base href="/"> 锚住 art.js/content.js 的加载。
 * body 样式做成"像一篇真实的网页"，这样截图才像用户实际看到的样子。
 */
function sceneHtml(which) {
  const common = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<base href="/">
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:64px 76px; min-height:100vh;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
    color:#24262b; background:#f7f6f3;
    background-image:radial-gradient(circle at 12% 8%, rgba(120,150,190,.09), transparent 42%),
                     radial-gradient(circle at 88% 92%, rgba(210,150,90,.08), transparent 46%); }
  .site { max-width:720px; }
  .brand { font-size:13px; letter-spacing:2px; color:#8a8d94; margin-bottom:38px; }
  h1 { font-size:38px; line-height:1.35; margin:0 0 18px; letter-spacing:-.6px; }
  .lede { font-size:16px; line-height:1.9; color:#5b6069; max-width:600px; margin:0 0 30px; }
  .card { background:#fff; border-radius:16px; padding:24px 28px; max-width:600px;
    box-shadow:0 1px 3px rgba(20,26,40,.06),0 10px 30px rgba(20,26,40,.05); }
  .card h2 { font-size:16px; margin:0 0 14px; }
  .line { height:11px; border-radius:6px; background:#eceef2; margin:11px 0; }
  .line.s { width:62%; }
  .line.m { width:81%; }
  .tag { display:inline-block; margin-top:16px; padding:6px 12px; font-size:12px;
    border-radius:999px; background:#f0efe9; color:#6b6d72; }
  /* 让挂件出现在画面中上部，避免总在右下角被忽略 */
  .hint { position:fixed; left:76px; bottom:56px; font-size:12px; color:#a0a2a8; }
</style></head><body>
<div class="site">
  <div class="brand">DAILY NOTES · 阅读模式</div>
  <h1>把一只木鱼，<br>挂在你正在看的页面上。</h1>
  <p class="lede">敲一下，功德 +1。可以拖着走，也可以甩出去。它会落地、回弹、转个圈，然后停在那里等你下次回来。设置面板里还能改形象、换节奏、自定义功德卡。</p>
  <div class="card"><h2>今天想记点什么</h2>
    <div class="line"></div><div class="line m"></div><div class="line s"></div>
    <span class="tag">自动保存 · 离线可用</span>
  </div>
</div>
<div class="hint">截图演示 · 挂件为真实扩展渲染</div>
<script src="art.js"></script><script src="stats.js"></script><script src="content.js"></script>
</body></html>`;
  return common;
}

/** 每个场景的交互脚本（在页面加载完成后执行） */
const SCENE_SCRIPTS = {
  '01-hero': `(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    hit.focus();
    // 敲 3 下，留下 3 个错开的飘字
    for (let i=0;i<3;i++) {
      hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
      await new Promise(s=>setTimeout(s,180));
    }
    await new Promise(s=>setTimeout(s,220));
  })()`,
  '02-knock': `(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    hit.focus();
    for (let i=0;i<5;i++) {
      hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
      await new Promise(s=>setTimeout(s,95));
    }
    await new Promise(s=>setTimeout(s,130));
  })()`,
  '03-panel': `(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    // 造一点数据
    for (let i=0;i<64;i++) {
      hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
    }
    await new Promise(s=>setTimeout(s,260));
    r.getElementById('setBtn').click();
    await new Promise(s=>setTimeout(s,380));
  })()`,
  '04-card': `(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    for (let i=0;i<87;i++) {
      hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
    }
    await new Promise(s=>setTimeout(s,220));
    // 打开面板后滚动到功德卡预览处
    r.getElementById('setBtn').click();
    await new Promise(s=>setTimeout(s,320));
    const body = r.querySelector('.my-set-body');
    const card = r.querySelector('.my-card-slot');
    if (body && card) body.scrollTop = card.offsetTop - 30;
    await new Promise(s=>setTimeout(s,180));
  })()`,
  '05-fish': `(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    // 切锦鲤 + 手
    const fish = [...r.querySelectorAll('.my-sk-opt')].find(b=>b.dataset.id==='fish');
    const hand = [...r.querySelectorAll('.my-sk-opt')].find(b=>b.dataset.id==='hand');
    r.getElementById('setBtn').click();
    await new Promise(s=>setTimeout(s,200));
    if (fish) fish.click();
    if (hand) hand.click();
    await new Promise(s=>setTimeout(s,180));
    r.getElementById('setBtn').click();
    await new Promise(s=>setTimeout(s,200));
    const hit = r.getElementById('hit');
    hit.focus();
    for (let i=0;i<3;i++) {
      hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
      await new Promise(s=>setTimeout(s,160));
    }
    await new Promise(s=>setTimeout(s,200));
  })()`
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // 每个场景一个 html 文件，由 preview server 提供
  const pages = SCENES.map((s) => {
    const f = `_scene-${s.name}.html`;
    fs.writeFileSync(path.join(__dirname, f), sceneHtml(s.name));
    return { ...s, url: `${BASE}/tools/${f}` };
  });

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  // 商店截图固定 1280×800，deviceScaleFactor=1（部分商店不接受 2x）
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  for (const scene of pages) {
    await send('Page.navigate', { url: scene.url });
    await sleep(2400);
    await send('Runtime.evaluate', { expression: SCENE_SCRIPTS[scene.name], awaitPromise: true, returnByValue: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const out = path.join(OUT, scene.name + '.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`  ✓ ${scene.name}.png  ${scene.desc}  ${(fs.statSync(out).size/1024).toFixed(0)} KB`);
  }

  ws.close();
  // 场景页保留，供 verify-store-shots.js 复现与校验画面内容
  console.log(`\n完成 → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
