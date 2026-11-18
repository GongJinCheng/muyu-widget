/**
 * 真实扩展环境验收：连到加载了未打包扩展的 Chrome，检查挂件是否正常注入、
 * 样式是否加载、点击是否工作。这一步能抓到 manifest 配置错误
 * （比如 web_accessible_resources 配错导致 CSS 404）。
 *
 * 用法：CDP_PORT=9444 node tools/verify-extension.js
 */
const PORT = process.env.CDP_PORT || 9444;
const TEST_URL = process.env.TEST_URL || 'https://example.com/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有 page target');

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
  await send('Network.enable');

  // 收集失败的网络请求，重点看扩展资源
  const failures = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Network.loadingFailed') failures.push(m.params);
  });

  await send('Page.navigate', { url: TEST_URL });
  await sleep(4000);

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const h = document.querySelector('muyu-widget');
      if (!h) return { injected: false };
      const root = h.shadowRoot;
      const hit = root && root.getElementById('hit');
      const link = root && root.querySelector('link');
      const sheet = link && link.sheet;
      const subject = root && root.querySelector('.my-subject');
      const rect = subject ? subject.getBoundingClientRect() : null;
      // 样式是否真的生效：读一个只有 styles.css 才会给的属性
      const dock = root && root.getElementById('dock');
      const dockW = dock ? getComputedStyle(dock).width : null;
      return {
        injected: true,
        hasShadow: !!root,
        hasLink: !!link,
        linkHref: link ? link.href : null,
        sheetLoaded: !!sheet,
        cssRules: sheet ? sheet.cssRules.length : 0,
        dockWidth: dockW,
        subjectW: rect ? Math.round(rect.width) : 0,
        subjectH: rect ? Math.round(rect.height) : 0,
        pathCount: root.querySelectorAll('.my-subject path').length
      };
    })()`,
    returnByValue: true
  });

  console.log(JSON.stringify(r.result.value, null, 2));
  if (failures.length) {
    console.log('\n失败请求：');
    failures.slice(0, 10).forEach((f) => console.log(' ', f.errorText, f.type));
  }

  const v = r.result.value;
  const ok = v.injected && v.hasShadow && v.sheetLoaded && v.cssRules > 0 && v.subjectW > 50;
  console.log(`\n${ok ? '✓ 扩展环境验收通过' : '✗ 扩展环境验收失败'}`);
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('验收失败：' + e.message);
  process.exit(1);
});
