/**
 * CDP 截图：连到已启动的 headless Chrome（--remote-debugging-port），
 * 打开预览台，等挂件初始化后截全页图。
 *
 * 用法：
 *   node tools/shot.js <输出png> [url] [--width=1280] [--height=820] [--wait=1800]
 * 环境变量：CDP_PORT（默认 9333）
 */
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'tools/shots/preview.png');
const url = process.argv[3] || 'http://127.0.0.1:8899/tools/preview.html';
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const W = arg('width', 1280);
const H = arg('height', 820);
const WAIT = arg('wait', 1800);
const PORT = process.env.CDP_PORT || 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 2,
    mobile: false
  });
  await send('Page.navigate', { url });
  await sleep(WAIT);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`已截图 ${out}（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
  ws.close();
}

main().catch((err) => {
  console.error('截图失败：' + err.message);
  process.exit(1);
});
