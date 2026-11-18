/**
 * 商店截图内容校验：逐场景打开，断言画面里确实有该有的元素与数据。
 * 因为截图是给人看的，光看文件存在没用——得确认挂件、飘字、面板、
 * 卡片、锦鲤真的渲染出来了，而不是一片空白。
 *
 * 用法：node tools/verify-store-shots.js
 */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9333;
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:8899';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHECKS = [
  {
    name: '01-hero',
    script: `(async () => {
      const r=document.querySelector('muyu-widget').shadowRoot;
      const hit=r.getElementById('hit'); hit.focus();
      for(let i=0;i<3;i++){hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(s=>setTimeout(s,180));}
      await new Promise(s=>setTimeout(s,220));
      const m=[...r.querySelectorAll('.my-merit')];
      return {merits:m.length, text:m.map(x=>x.textContent), subject:r.querySelectorAll('.my-subject path').length,
              dock:r.getElementById('dock').getBoundingClientRect().toJSON()};
    })()`,
    assert: (v) => [
      ['挂件渲染 37 条 path', v.subject === 37],
      ['3 个飘字同屏', v.merits === 3],
      ['飘字文本为功德+1', v.text.every((t) => t === '功德+1')],
      ['挂件在视口内', v.dock.x >= 0 && v.dock.y >= 0 && v.dock.right <= 1280 && v.dock.bottom <= 800]
    ]
  },
  {
    name: '03-panel',
    script: `(async () => {
      const r=document.querySelector('muyu-widget').shadowRoot;
      const hit=r.getElementById('hit');
      for(let i=0;i<64;i++){hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));}
      await new Promise(s=>setTimeout(s,260));
      r.getElementById('setBtn').click(); await new Promise(s=>setTimeout(s,380));
      const st=r.getElementById('settings');
      const sv=r.getElementById('saveCard').getBoundingClientRect();
      return {open:!st.hidden, today:r.getElementById('spToday').textContent,
              total:r.getElementById('spTotal').textContent, pct:r.getElementById('spPct').textContent,
              groups:st.querySelectorAll('.my-set-group').length,
              saveVisible:sv.top>=0&&sv.bottom<=innerHeight, saveText:r.getElementById('saveCard').textContent,
              opts:r.querySelectorAll('.my-sk-opt').length};
    })()`,
    assert: (v) => [
      ['面板已打开', v.open],
      ['今日计数为 64', v.today === '64'],
      ['累计计数为 64', v.total === '64'],
      ['进度百分比 59%', v.pct === '59%'],
      ['4 个设置分组', v.groups === 4],
      ['保存按钮可见', v.saveVisible],
      ['4 个形象选项', v.opts === 4]
    ]
  },
  {
    name: '04-card',
    script: `(async () => {
      const r=document.querySelector('muyu-widget').shadowRoot;
      const hit=r.getElementById('hit');
      for(let i=0;i<87;i++){hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));}
      await new Promise(s=>setTimeout(s,220));
      r.getElementById('setBtn').click(); await new Promise(s=>setTimeout(s,320));
      const body=r.querySelector('.my-set-body'); const card=r.querySelector('.my-card-slot');
      body.scrollTop=card.offsetTop-30; await new Promise(s=>setTimeout(s,180));
      const cr=card.getBoundingClientRect(); const br=body.getBoundingClientRect();
      const paper=r.querySelector('.my-cv-paper');
      return {hasPaper:!!paper, title:paper&&r.querySelector('.my-cv-title').textContent,
              avatar:!!r.querySelector('.my-cv-av'), avLoaded:r.querySelector('.my-cv-av')&&r.querySelector('.my-cv-av').complete,
              cols:r.querySelectorAll('.my-cv-col').length,
              cardInView:cr.top<br.bottom&&cr.bottom>br.top,
              editable:r.querySelectorAll('.my-cv-edit').length};
    })()`,
    assert: (v) => [
      ['卡片纸面已渲染', v.hasPaper],
      ['卡面标题为功德', v.title === '功德'],
      ['形象图已加载', v.avatar && v.avLoaded],
      ['3 列数据', v.cols === 3],
      ['卡片滚动到可视区', v.cardInView],
      ['6 处可编辑文案', v.editable === 6]
    ]
  },
  {
    name: '05-fish',
    script: `(async () => {
      const r=document.querySelector('muyu-widget').shadowRoot;
      r.getElementById('setBtn').click(); await new Promise(s=>setTimeout(s,200));
      const fish=[...r.querySelectorAll('.my-sk-opt')].find(b=>b.dataset.id==='fish');
      const hand=[...r.querySelectorAll('.my-sk-opt')].find(b=>b.dataset.id==='hand');
      fish.click(); hand.click(); await new Promise(s=>setTimeout(s,180));
      r.getElementById('setBtn').click(); await new Promise(s=>setTimeout(s,200));
      const hit=r.getElementById('hit'); hit.focus();
      for(let i=0;i<3;i++){hit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      hit.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(s=>setTimeout(s,160));}
      await new Promise(s=>setTimeout(s,200));
      const m=[...r.querySelectorAll('.my-merit')];
      return {label:hit.getAttribute('aria-label'), fishOn:fish.classList.contains('is-on'),
              handOn:hand.classList.contains('is-on'), texts:m.map(x=>x.textContent),
              koiEllipse:r.querySelectorAll('.my-subject ellipse').length};
    })()`,
    assert: (v) => [
      ['切到锦鲤', v.fishOn],
      ['切到手', v.handOn],
      ['aria-label 更新为鱼', v.label.startsWith('鱼')],
      ['飘字变成摸鱼+1', v.texts.length === 3 && v.texts.every((t) => t === '摸鱼+1')],
      ['锦鲤 SVG 已渲染', v.koiEllipse >= 2]
    ]
  }
];

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  let failed = 0;
  let total = 0;
  for (const c of CHECKS) {
    // 用已经写好的 scene html（若不存在则跳过，提示先跑 store-shots）
    const scenePath = path.resolve(__dirname, `_scene-${c.name}.html`);
    if (!fs.existsSync(scenePath)) {
      console.log(`  · ${c.name}: 缺少场景页，先运行 node tools/store-shots.js 生成图片`);
      continue;
    }
    await send('Page.navigate', { url: `${BASE}/tools/_scene-${c.name}.html` });
    await sleep(2200);
    const r = await send('Runtime.evaluate', { expression: c.script, awaitPromise: true, returnByValue: true });
    const v = r.result.value;
    console.log(`\n[${c.name}]`);
    for (const [label, ok] of c.assert(v)) {
      total++;
      if (!ok) failed++;
      console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    }
  }
  console.log(`\n${total - failed}/${total} 项通过`);
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
