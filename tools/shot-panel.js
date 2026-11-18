/**
 * 设置面板截图：打开面板后截取挂件周围区域，用于验收面板 UI。
 * 用法：node tools/shot-panel.js [输出png]
 */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9333;
const out = path.resolve(process.argv[2] || 'tools/shots/panel.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (m, p = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method: m, params: p }));
    });
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 820, deviceScaleFactor: 3, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8899/tools/preview.html' });
  await sleep(2800);

  const info = await send('Runtime.evaluate', {
    expression: `(async () => {
      const r = document.querySelector('muyu-widget').shadowRoot;
      // 制造一些数据，让面板里的数字不是全 0
      const hit = r.getElementById('hit');
      for (let i = 0; i < 37; i++) {
        hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        hit.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      await new Promise(s => setTimeout(s, 200));
      r.getElementById('setBtn').click();
      await new Promise(s => setTimeout(s, 400));
      const p = r.getElementById('settings').getBoundingClientRect();
      return { x: p.x, y: p.y, w: p.width, h: p.height };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const p = info.result.value;
  const clip = {
    x: Math.max(0, p.x - 12),
    y: Math.max(0, p.y - 12),
    width: Math.min(900 - Math.max(0, p.x - 12), p.w + 24),
    height: Math.min(820 - Math.max(0, p.y - 12), p.h + 24),
    scale: 3
  };
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`已截图 ${out}  面板 ${p.w.toFixed(0)}×${p.h.toFixed(0)}`);
  ws.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
