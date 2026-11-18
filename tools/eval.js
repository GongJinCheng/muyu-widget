/**
 * 在页面里跑一段 JS 并把结果打回来，用于调试挂件状态。
 * 用法：node tools/eval.js "<js表达式>" [url]
 */
const PORT = process.env.CDP_PORT || 9333;
const expr = process.argv[2];
const url = process.argv[3] || 'http://127.0.0.1:8899/tools/preview.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
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
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(2000);
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.exceptionDetails) {
    console.error('异常：', r.exceptionDetails.text, r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    process.exit(1);
  }
  console.log(JSON.stringify(r.result.value, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
