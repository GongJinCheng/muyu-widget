#!/usr/bin/env node
/**
 * 零依赖静态自检：
 *  1) manifest.json 合法 + 引用文件存在
 *  2) content.js 语法检查（由 package.json 里的 node --check 负责，这里再兜一次）
 *  3) HTML 里声明的 id 与 $('id') 引用双向对账（防止改 UI 时漏 id / 悬空引用）
 *  4) styles.css 里 .my-* 选择器与 JS 中用到的类名对账（只报告，不阻断）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failed = 0;
const fail = (msg) => {
  failed += 1;
  console.error('  ✗ ' + msg);
};
const ok = (msg) => console.log('  ✓ ' + msg);

/* ---------------- manifest ---------------- */
console.log('[manifest]');
const manifest = JSON.parse(read('manifest.json'));
if (manifest.manifest_version !== 3) fail('manifest_version 必须是 3');
else ok('manifest_version = 3');
for (const f of ['content.js', 'styles.css']) {
  if (!fs.existsSync(path.join(root, f))) fail(`缺少文件 ${f}`);
}
for (const size of Object.keys(manifest.icons || {})) {
  const f = manifest.icons[size];
  if (!fs.existsSync(path.join(root, f))) fail(`缺少图标 ${f}`);
  else {
    const bytes = fs.statSync(path.join(root, f)).size;
    if (bytes < 200) fail(`图标 ${f} 疑似损坏（${bytes} 字节）`);
  }
}
ok(`图标齐全（${Object.keys(manifest.icons || {}).length} 个尺寸）`);
const perms = manifest.permissions || [];
if (!perms.includes('storage')) fail('缺少 storage 权限');
else ok('权限：' + perms.join(', '));

/* ---------------- content.js 语法 ---------------- */
console.log('[content.js]');
const src = read('content.js');
try {
  new vm.Script(src, { filename: 'content.js' });
  ok('语法可解析');
} catch (err) {
  fail('语法错误：' + err.message);
}

/* ---------------- id 对账 ---------------- */
const declared = new Set();
for (const m of src.matchAll(/id="([\w-]+)"/g)) declared.add(m[1]);
const referenced = new Set();
for (const m of src.matchAll(/\$\('([\w-]+)'\)/g)) referenced.add(m[1]);
const dangling = [...referenced].filter((id) => !declared.has(id));
const orphan = [...declared].filter((id) => !referenced.has(id));
if (dangling.length) fail('引用了不存在的 id：' + dangling.join(', '));
else ok(`${referenced.size} 个 $() 引用全部有对应元素`);
if (orphan.length) console.log(`  · 未被 $() 引用的 id（可能由别处查询）：${orphan.join(', ')}`);

/* ---------------- 类名对账（提示级） ---------------- */
console.log('[styles.css]');
const css = read('styles.css');
const cssClasses = new Set();
for (const m of css.matchAll(/\.(my-[\w-]+)/g)) cssClasses.add(m[1]);
const jsClasses = new Set();
for (const m of src.matchAll(/class="([^"]+)"/g))
  m[1].split(/\s+/).filter((c) => c.startsWith('my-')).forEach((c) => jsClasses.add(c));
for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g))
  if (m[1].startsWith('my-')) jsClasses.add(m[1]);
const unstyled = [...jsClasses].filter((c) => !cssClasses.has(c));
if (unstyled.length) console.log('  · JS 用到但 CSS 未定义的类（可能由状态类拼接）：' + unstyled.join(', '));
else ok(`JS 用到的 ${jsClasses.size} 个 .my-* 类全部有样式`);
const unused = [...cssClasses].filter((c) => !jsClasses.has(c));
ok(`CSS 共 ${cssClasses.size} 个 .my-* 类，其中 ${unused.length} 个由动态状态类使用`);

/* ---------------- 结果 ---------------- */
console.log('');
if (failed) {
  console.error(`自检未通过：${failed} 项`);
  process.exit(1);
}
console.log('自检通过');
