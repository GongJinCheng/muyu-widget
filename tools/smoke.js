/**
 * 交互冒烟测试：在预览页里模拟真实操作，检查行为与视觉状态。
 * 用法：node tools/smoke.js [url]
 */
const PORT = process.env.CDP_PORT || 9333;
const url = process.argv[2] || 'http://127.0.0.1:8899/tools/preview.html';
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
  await sleep(2600);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`);
  };

  // 1) 挂件注入
  const base = await evalJs(`(() => {
    const h = document.querySelector('muyu-widget');
    const r = h && h.shadowRoot;
    const hit = r && r.getElementById('hit');
    return {
      host: !!h, shadow: !!r, hit: !!hit,
      tabindex: hit && hit.getAttribute('tabindex'),
      role: hit && hit.getAttribute('role'),
      ariaLabel: hit && hit.getAttribute('aria-label'),
      subjectSvg: !!(r && r.querySelector('.my-subject')),
      toolSvg: !!(r && r.querySelector('.my-tool')),
      subjectPaths: r ? r.querySelectorAll('.my-subject path').length : 0,
      cssLoaded: r ? [...r.querySelectorAll('link')].length : 0
    };
  })()`);
  check('挂件注入 + Shadow DOM', base.host && base.shadow);
  check('本体可键盘聚焦 (tabindex=0)', base.tabindex === '0', `tabindex=${base.tabindex}`);
  check('本体 role=button 且有 aria-label', base.role === 'button' && !!base.ariaLabel);
  check('新木鱼 SVG 已渲染', base.subjectSvg, `${base.subjectPaths} 条 path`);
  check('敲击工具已渲染', base.toolSvg);

  // 2) 键盘敲击：聚焦 + 回车
  const kb = await evalJs(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    hit.focus();
    const before = r.querySelectorAll('.my-merit').length;
    hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(res => setTimeout(res, 120));
    const after = r.querySelectorAll('.my-merit').length;
    const meritText = r.querySelector('.my-merit') ? r.querySelector('.my-merit').textContent : null;
    const hasVerb = !!(r.querySelector('.my-merit-verb'));
    const hasNum = !!(r.querySelector('.my-merit-num'));
    const ripples = r.querySelectorAll('.my-ripple').length;
    const wave = r.querySelectorAll('.my-ripple-wave').length;
    const swung = r.querySelector('.my-tool').classList.contains('is-swing');
    const hitAnim = r.querySelector('.my-subject').classList.contains('is-hit');
    return { before, after, meritText, hasVerb, hasNum, ripples, wave, swung, hitAnim,
             focused: r.activeElement === hit };
  })()`);
  check('回车可敲击（飘字出现）', kb.after > kb.before, `飘字 ${kb.before} → ${kb.after}`);
  check('飘字结构：功德 + +1 两段', kb.hasVerb && kb.hasNum, `文本 "${kb.meritText}"`);
  check('涟漪 + 冲击波各一层', kb.ripples >= 2 && kb.wave >= 1, `ripple=${kb.ripples} wave=${kb.wave}`);
  check('工具挥动动画已触发', kb.swung);
  check('本体形变动画已触发', kb.hitAnim);
  check('键盘焦点停留在本体上', kb.focused);

  // 3) 方向键微调
  const nudge = await evalJs(`(() => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    const dock = r.getElementById('dock');
    hit.focus();
    const before = dock.style.transform;
    hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const after = dock.style.transform;
    return { before, after, changed: before !== after };
  })()`);
  check('方向键可微调位置', nudge.changed, `${nudge.before} → ${nudge.after}`);

  // 4) 面板打开 + 键盘可达
  const panel = await evalJs(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    r.getElementById('setBtn').click();
    await new Promise(res => setTimeout(res, 200));
    const st = r.getElementById('settings');
    const focusables = [...st.querySelectorAll('button,select,input,[tabindex="0"]')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    const card = r.querySelector('.my-cv');
    return { open: !st.hidden, focusCount: focusables.length, hasCard: !!card,
             subjectOpts: r.querySelectorAll('.my-sk-opt').length };
  })()`);
  check('设置面板可打开', panel.open);
  check('面板内可聚焦控件数量正常', panel.focusCount >= 8, `${panel.focusCount} 个`);
  check('功德卡预览已渲染', panel.hasCard);

  // 5) 换形象
  const skin = await evalJs(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const opt = [...r.querySelectorAll('.my-sk-opt')].find(b => b.dataset.id === 'fish');
    opt.click();
    await new Promise(res => setTimeout(res, 160));
    return { label: r.getElementById('hit').getAttribute('aria-label'),
             isFish: !!r.querySelector('.my-subject ellipse'),
             active: opt.classList.contains('is-on') };
  })()`);
  check('可切换到锦鲤形象', skin.active && skin.isFish, skin.label);

  // 6) 收起 / 展开
  const collapse = await evalJs(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    r.getElementById('collapseBtn').click();
    await new Promise(res => setTimeout(res, 160));
    const tab = r.getElementById('tab');
    const tabShown = tab.style.display === 'flex';
    const dockHidden = r.getElementById('dock').style.display === 'none';
    tab.click();
    await new Promise(res => setTimeout(res, 160));
    return { tabShown, dockHidden, restored: r.getElementById('dock').style.display !== 'none' };
  })()`);
  check('可收起成圆形入口', collapse.tabShown && collapse.dockHidden);
  check('点圆形入口可展开', collapse.restored);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  ws.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('冒烟测试失败：' + e.message);
  process.exit(1);
});
