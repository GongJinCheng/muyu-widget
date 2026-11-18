/**
 * 敲击瞬间截图：在页面里触发若干次敲击，趁飘字/涟漪还在时截图。
 * 用法：node tools/shot-knock.js <输出png> [次数] [延迟ms]
 */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9333;
const out = path.resolve(process.argv[2] || 'tools/shots/knock.png');
const times = Number(process.argv[3] || 3);
const delay = Number(process.argv[4] || 150);
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8899/tools/preview.html';
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2600);

  // 触发 N 次敲击
  await send('Runtime.evaluate', {
    expression: `(async () => {
      const r = document.querySelector('muyu-widget').shadowRoot;
      const hit = r.getElementById('hit');
      hit.focus();
      for (let i = 0; i < ${times}; i++) {
        hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        hit.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
        await new Promise(res => setTimeout(res, ${delay}));
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`已截图 ${out}`);
  ws.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
