/**
 * 深度功能测试：覆盖 smoke.js 没测到的关键路径。
 * 用法：node tools/deep.test.js
 *
 * 覆盖审查指出的测试缺口：
 *   - 功德卡 Canvas 导出（toBlob / 尺寸 / 文案进图）
 *   - 卡片文字键盘编辑（Enter 进入 / Esc 取消 / 回车保存）
 *   - Escape 关闭设置面板
 *   - 每日目标编辑与持久化
 *   - 静音开关
 *   - prefers-reduced-motion（CDP 模拟媒体查询）
 *
 * 用预览页跑（不需要扩展环境）；storage 相关用 CDP 注入的 mock 验证逻辑。
 */
const PORT = process.env.CDP_PORT || 9333;
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:8899';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const evalInPage = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  let failed = 0;
  let total = 0;
  const check = (name, ok, detail) => {
    total++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failed++;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  // 关键：关闭 reduced-motion，保证物理/动画测试按正常路径跑
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  await send('Page.navigate', { url: `${BASE}/tools/preview.html?deep=${Date.now()}` });
  await sleep(2600);

  /* ---------- 1. 功德卡 Canvas 导出 ---------- */
  console.log('\n[功德卡 Canvas 导出]');
  const card = await evalInPage(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const hit = r.getElementById('hit');
    // 敲几下制造数据
    for (let i=0;i<12;i++) {
      hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
    }
    await new Promise(s=>setTimeout(s,200));
    r.getElementById('setBtn').click();
    await new Promise(s=>setTimeout(s,250));

    // 直接调 buildCard 不在全局作用域，改为点击保存按钮并拦截 download
    // 这里用 Monkey-patch HTMLAnchorElement.prototype.click 捕获生成的 blob URL
    let captured = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      captured = {href:this.href, download:this.download};
    };
    r.getElementById('saveCard').click();
    await new Promise(s=>setTimeout(s,700));
    HTMLAnchorElement.prototype.click = origClick;

    if (!captured) return {captured:false};
    // 把 blob 读成 image，验证确实是 1080×1440 PNG
    let dim = null;
    try {
      const resp = await fetch(captured.href);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      dim = {w:bmp.width, h:bmp.height, type:blob.type, size:blob.size};
      bmp.close();
    } catch(e) { dim = {error:e.message}; }
    return {captured:true, download:captured.download, dim,
            btnText:r.getElementById('saveCard').textContent};
  })()`);
  check('保存按钮触发了下载', card.captured === true);
  if (card.captured) {
    check('导出为 PNG', card.dim && card.dim.type === 'image/png', JSON.stringify(card.dim));
    check('尺寸为 1080×1440', card.dim && card.dim.w === 1080 && card.dim.h === 1440,
      card.dim ? `${card.dim.w}x${card.dim.h}` : '-');
    check('文件名含"功德卡"和日期', /功德卡-\d{4}-\d{2}-\d{2}\.png/.test(card.download || ''), card.download);
    check('按钮反馈"已保存"', /已保存/.test(card.btnText || ''), card.btnText);
  }

  /* ---------- 2. 卡片文字键盘编辑 ---------- */
  console.log('\n[功德卡文字键盘编辑]');
  const edit = await evalInPage(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const cell = r.querySelector('.my-cv-edit[data-k="total"]');
    // Enter 进入编辑
    cell.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(s=>setTimeout(s,100));
    const input = cell.querySelector('input');
    if (!input) return {entered:false};
    // 改值后 Esc 取消
    input.value = '临时文案';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await new Promise(s=>setTimeout(s,80));
    const afterEsc = cell.textContent;
    // 再进入，回车保存
    cell.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(s=>setTimeout(s,80));
    const input2 = cell.querySelector('input');
    input2.value = '累计敲击';
    input2.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(s=>setTimeout(s,100));
    return {entered:true, afterEsc, afterSave:cell.textContent};
  })()`);
  check('Enter 可进入编辑', edit.entered === true);
  check('Esc 取消不改文案', edit.afterEsc === '累计功德', `afterEsc=${edit.afterEsc}`);
  check('回车保存自定义文案', edit.afterSave === '累计敲击', `afterSave=${edit.afterSave}`);

  /* ---------- 3. Escape 关闭面板 ---------- */
  console.log('\n[面板键盘操作]');
  const esc = await evalInPage(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const st = r.getElementById('settings');
    // 确保面板开着（上一步可能还开着）
    if (st.hidden) r.getElementById('setBtn').click();
    await new Promise(s=>setTimeout(s,150));
    const opened = !st.hidden;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await new Promise(s=>setTimeout(s,150));
    return {opened, closed:st.hidden, focusOnSet: r.activeElement === r.getElementById('setBtn')};
  })()`);
  check('面板可打开', esc.opened === true);
  check('Escape 关闭面板', esc.closed === true);
  check('关闭后焦点回到设置按钮', esc.focusOnSet === true);

  /* ---------- 4. 每日目标编辑 ---------- */
  console.log('\n[每日目标]');
  const goal = await evalInPage(`(() => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const input = r.getElementById('goalInput');
    input.value = '250';
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const pct = r.getElementById('spPct').textContent;
    const goalLabel = r.getElementById('spGoal').textContent;
    return {pct, goalLabel, inputVal:input.value};
  })()`);
  check('目标改为 250', /\/\s*250/.test(goal.goalLabel || ''), goal.goalLabel);
  check('进度按新目标重算', goal.pct === '5%', `pct=${goal.pct}（12/250=4.8%→5%）`);

  /* ---------- 5. 声音开关（语义一致性） ---------- */
  console.log('\n[声音开关]');
  const mute = await evalInPage(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const sw = r.getElementById('soundSwitch');
    // 标签文字必须是「声音」，且亮起=有声音、关闭=静音，三者要一致
    const labelText = sw.previousElementSibling ? sw.previousElementSibling.textContent.trim() : null;
    const initial = {
      checked: sw.getAttribute('aria-checked'),
      isOn: sw.classList.contains('is-on'),
      ariaLabel: sw.getAttribute('aria-label')
    };
    // 关掉声音
    sw.click();
    await new Promise(s=>setTimeout(s,80));
    const afterOff = {
      checked: sw.getAttribute('aria-checked'),
      isOn: sw.classList.contains('is-on'),
      ariaLabel: sw.getAttribute('aria-label')
    };
    // 再打开
    sw.click();
    await new Promise(s=>setTimeout(s,80));
    const afterOn = {
      checked: sw.getAttribute('aria-checked'),
      isOn: sw.classList.contains('is-on')
    };
    return {labelText, initial, afterOff, afterOn};
  })()`);
  check('标签文字为「声音」', mute.labelText === '声音', `label=${mute.labelText}`);
  check('默认亮起且有声音',
    mute.initial.checked === 'true' && mute.initial.isOn === true,
    `checked=${mute.initial.checked} isOn=${mute.initial.isOn}`);
  check('点击后关闭并静音',
    mute.afterOff.checked === 'false' && mute.afterOff.isOn === false,
    `checked=${mute.afterOff.checked} isOn=${mute.afterOff.isOn}`);
  check('再点击恢复有声音',
    mute.afterOn.checked === 'true' && mute.afterOn.isOn === true,
    `checked=${mute.afterOn.checked} isOn=${mute.afterOn.isOn}`);
  check('亮起状态与 aria-checked 一致',
    mute.initial.isOn === (mute.initial.checked === 'true') &&
    mute.afterOff.isOn === (mute.afterOff.checked === 'true'),
    '开关视觉与无障碍状态同步');

  /* ---------- 6. prefers-reduced-motion 物理分支 ---------- */
  console.log('\n[减弱动态]');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: `${BASE}/tools/preview.html?rm=${Date.now()}` });
  await sleep(2200);
  const rm = await evalInPage(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const dock = r.getElementById('dock');
    const hit = r.getElementById('hit');
    // 触发一次快速甩动（pointer 事件）
    const opts = {bubbles:true, cancelable:true, pointerId:1, pointerType:'mouse', button:0, clientX:400, clientY:400};
    hit.dispatchEvent(new PointerEvent('pointerdown',opts));
    hit.dispatchEvent(new PointerEvent('pointermove',{...opts, clientX:700, clientY:200}));
    hit.dispatchEvent(new PointerEvent('pointerup',{...opts, clientX:720, clientY:180}));
    await new Promise(s=>setTimeout(s,250));
    const m1 = /translate3d\\(([-\\d.]+)px, ([-\\d.]+)px/.exec(dock.style.transform);
    const pos1 = m1 ? m1[1] + ',' + m1[2] : null;
    await new Promise(s=>setTimeout(s,400));
    const m2 = /translate3d\\(([-\\d.]+)px, ([-\\d.]+)px/.exec(dock.style.transform);
    const pos2 = m2 ? m2[1] + ',' + m2[2] : null;
    return {pos1, pos2};
  })()`);
  // 减弱动态下松手即停靠：250ms 与 650ms 两次采样位置应完全一致（没有重力抛物线）
  check('减弱动态下松手即停靠（位置不再变化）',
    rm.pos1 !== null && rm.pos1 === rm.pos2,
    `pos1=${rm.pos1} pos2=${rm.pos2}`);

  // 对照：正常模式下同样的快速甩动应该有物理运动（证明上面的停靠是分支生效，
  // 而不是抛掷功能整体坏了）
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.navigate', { url: `${BASE}/tools/preview.html?norm=${Date.now()}` });
  await sleep(2200);
  const normal = await evalInPage(`(async () => {
    const r = document.querySelector('muyu-widget').shadowRoot;
    const dock = r.getElementById('dock');
    const hit = r.getElementById('hit');
    const opts = {bubbles:true, cancelable:true, pointerId:1, pointerType:'mouse', button:0, clientX:400, clientY:400};
    hit.dispatchEvent(new PointerEvent('pointerdown',opts));
    // 多次快速移动，制造足够速度
    for (let i=1;i<=5;i++) {
      hit.dispatchEvent(new PointerEvent('pointermove',{...opts, clientX:400+i*60, clientY:400-i*30}));
      await new Promise(s=>setTimeout(s,16));
    }
    hit.dispatchEvent(new PointerEvent('pointerup',{...opts, clientX:700, clientY:250}));
    await new Promise(s=>setTimeout(s,120));
    const p1 = dock.style.transform;
    await new Promise(s=>setTimeout(s,350));
    const p2 = dock.style.transform;
    return {p1, p2, changed:p1!==p2};
  })()`);
  check('正常模式下抛掷有物理运动（对照）', normal.changed === true,
    `${normal.p1} → ${normal.p2}`);

  await send('Emulation.setEmulatedMedia', { features: [] });
  console.log(`\n${total - failed}/${total} 项通过`);
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('测试失败：' + e.message); process.exit(1); });
