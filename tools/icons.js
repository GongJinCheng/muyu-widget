/**
 * 图标生成：把你提供的源图切成 16/32/48/128 四个尺寸。
 *
 * 用法：
 *   node tools/icons.js <源图路径>              # 从源图生成（建议 512×512 以上、居中方图）
 *   node tools/icons.js <源图路径> --pad        # 先补成正方形再缩放（防非方图变形）
 *   node tools/icons.js --verify                # 只校验现有图标
 *
 * 依赖：无。用 Node 内置能力处理 PNG 解码/缩放不现实，
 * 所以走两条路：优先调用本机 Chrome 做渲染缩放，无 Chrome 时退化为「尺寸校验 + 报错」。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const iconDir = path.join(root, 'icons');
const SIZES = [16, 32, 48, 128];

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify');
const pad = args.includes('--pad');
const src = args.find((a) => !a.startsWith('--'));

/* ---------------- PNG 尺寸读取 ---------------- */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ---------------- 校验 ---------------- */
function verify() {
  let bad = 0;
  console.log('图标校验：');
  for (const s of SIZES) {
    const f = path.join(iconDir, `icon${s}.png`);
    if (!fs.existsSync(f)) {
      console.log(`  ✗ icon${s}.png 缺失`);
      bad++;
      continue;
    }
    const buf = fs.readFileSync(f);
    const dim = pngSize(buf);
    if (!dim) {
      console.log(`  ✗ icon${s}.png 不是有效 PNG`);
      bad++;
      continue;
    }
    const ok = dim.w === s && dim.h === s;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} icon${s}.png  ${dim.w}x${dim.h}  应为 ${s}x${s}`);
  }
  if (bad) {
    console.log(`\n${bad} 项不通过。`);
    return false;
  }
  console.log('\n全部通过。');
  return true;
}

if (verifyOnly || !src) {
  if (!src && !verifyOnly) {
    console.log('未提供源图，仅做校验。用法：node tools/icons.js <源图>  [--pad]\n');
  }
  process.exit(verify() ? 0 : 1);
}

/* ---------------- 找 Chrome ---------------- */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1246/chrome-win64/chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chrome = CANDIDATES.find((p) => fs.existsSync(p));

if (!chrome) {
  console.error('找不到 Chrome/Edge，无法缩放图片。请设置 CHROME_PATH，或手动把源图切成四个尺寸放进 icons/。');
  console.error('需要的尺寸：' + SIZES.join(' / '));
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.error('源图不存在：' + src);
  process.exit(1);
}

/* ---------------- 用 Chrome 渲染缩放 ---------------- */
/*
 * 做法：生成一个 HTML，把源图按目标尺寸绘制并转成 PNG dataURL，
 * 用无头 Chrome 执行后把结果写到磁盘。
 * 这样不引入任何第三方图像库。
 */
const absSrc = path.resolve(src);
const b64 = fs.readFileSync(absSrc).toString('base64');
const ext = path.extname(absSrc).toLowerCase();
const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';

const html = `<!DOCTYPE html><html><body><script>
const src = 'data:${mime};base64,${b64}';
const SIZES = ${JSON.stringify(SIZES)};
const PAD = ${pad};
const img = new Image();
img.onload = async () => {
  const out = {};
  for (const s of SIZES) {
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (PAD) {
      // 补成正方形，居中
      const side = Math.max(img.width, img.height);
      const dx = (s - s * (img.width / side)) / 2;
      const dy = (s - s * (img.height / side)) / 2;
      const dw = s * (img.width / side);
      const dh = s * (img.height / side);
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      ctx.drawImage(img, 0, 0, s, s);
    }
    out[s] = c.toDataURL('image/png').split(',')[1];
  }
  window.__RESULT__ = out;
  document.title = 'DONE';
};
img.src = src;
</script></body></html>`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muyu-icon-'));
const tmpHtml = path.join(tmpDir, 'gen.html');
fs.writeFileSync(tmpHtml, html);

/* 用 CDP 驱动，因为 --screenshot 只能截页面，拿不到 canvas 数据 */
const CDP_PORT = 9555;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 用异步 spawn：spawnSync + detached 在 Windows 上会一直等子进程，直接卡死
  const { spawn } = require('child_process');
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-background-networking',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${path.join(tmpDir, 'profile')}`,
      'about:blank'
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  // 等待 CDP 就绪
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      if (targets.find((t) => t.type === 'page')) break;
    } catch (e) {
      /* 还没起 */
    }
  }
  if (!targets) {
    console.error('Chrome 启动失败');
    process.exit(1);
  }

  const page = targets.find((t) => t.type === 'page');
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
  await send('Page.navigate', { url: 'file:///' + tmpHtml.replace(/\\/g, '/') });

  // 轮询直到渲染完成
  let result = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const r = await send('Runtime.evaluate', { expression: 'window.__RESULT__ || null', returnByValue: true });
    if (r.result.value) {
      result = r.result.value;
      break;
    }
  }
  ws.close();

  if (!result) {
    console.error('渲染超时：Chrome 没能生成图标');
    process.exit(1);
  }

  fs.mkdirSync(iconDir, { recursive: true });
  for (const s of SIZES) {
    const buf = Buffer.from(result[s], 'base64');
    fs.writeFileSync(path.join(iconDir, `icon${s}.png`), buf);
    console.log(`  ✓ icons/icon${s}.png  ${(buf.length / 1024).toFixed(1)} KB`);
  }

  try {
    process.kill(-proc.pid);
  } catch (e) {
    try {
      proc.kill();
    } catch (e2) {
      /* noop */
    }
  }
  // Chrome 关掉后要一点时间释放文件句柄，否则 rmSync 会 EPERM
  await sleep(700);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (e) {
    console.warn('（临时目录未能清理，可忽略：' + tmpDir + '）');
  }

  console.log('\n生成完成，校验中：');
  process.exit(verify() ? 0 : 1);
})();
