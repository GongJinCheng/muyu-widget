/**
 * 生成商店用 logo（Edge 推荐 300×300，最少 128×128）。
 * 直接从 icon-source.svg 渲染，避免把 128px 拉伸模糊。
 *
 * 用法：node tools/store-logo.js
 * 输出：tools/shots/store/logo-300.png
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'tools', 'icon-source.svg');
const OUT = path.join(ROOT, 'tools', 'shots', 'store', 'logo-300.png');
const SIZE = 300;
const PORT = 9700 + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1246/chrome-win64/chrome.exe')
].filter(Boolean).find((p) => fs.existsSync(p));

if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (!fs.existsSync(SRC)) { console.error('缺少 icon-source.svg'); process.exit(1); }

const svg = fs.readFileSync(SRC, 'utf8');
const html = `<!DOCTYPE html><html><body style="margin:0">
<div id="stage" style="width:${SIZE}px;height:${SIZE}px">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</div>
<script>
const svgEl = document.querySelector('svg');
svgEl.setAttribute('width', '${SIZE}');
svgEl.setAttribute('height', '${SIZE}');
const c = document.createElement('canvas');
c.width = ${SIZE}; c.height = ${SIZE};
const ctx = c.getContext('2d');
const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], {type:'image/svg+xml'});
const url = URL.createObjectURL(blob);
const img = new Image();
img.onload = () => { ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE}); window.__PNG__ = c.toDataURL('image/png'); document.title='DONE'; };
img.onerror = () => { window.__PNG__ = 'ERROR'; document.title='DONE'; };
img.src = url;
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muyu-logo-'));
const page = path.join(tmp, 'logo.html');
fs.writeFileSync(page, html);

(async () => {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'p')}`,
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  proc.unref();

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) {}
  }
  const t = targets.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let seq = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') });

  let data = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const r = await send('Runtime.evaluate', { expression: 'window.__PNG__ || null', returnByValue: true });
    if (r.result.value) { data = r.result.value; break; }
  }
  ws.close();
  try { process.kill(-proc.pid); } catch (e) { try { proc.kill(); } catch (e2) {} }

  if (!data || data === 'ERROR') {
    console.error('渲染失败');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`已生成 ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);

  await sleep(500);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
})();
