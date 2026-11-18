/**
 * 打成商店提交用的 zip。
 *
 * 关键点：
 *   1. 只打扩展运行必需的文件，tools/、.git、README、shots 一律不进包
 *   2. manifest.json 必须在 zip 根目录（不是套一层文件夹），否则商店拒收
 *   3. 打包前先校验 manifest 引用的文件都真实存在
 *
 * 用法：
 *   node tools/pack.js            # 输出到 dist/muyu-widget-<version>.zip
 *   node tools/pack.js --check    # 只校验不打��
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

/* ---------------- 极简 zip 实现（零依赖） ---------------- */
/* 商店包很小，用 store（不压缩）最省事且兼容性最好；
   这里用 deflate 压缩，格式仍是最普通的 zip32。 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // 压缩后反而更大就用 store
    const useStore = deflated.length >= data.length;
    const payload = useStore ? data : deflated;
    const method = useStore ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ---------------- 收集要打包的文件 ---------------- */

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// manifest 里显式引用的 + 运行必需的文件
const required = new Set(['manifest.json']);
manifest.content_scripts.forEach((cs) => cs.js.forEach((f) => required.add(f)));
(manifest.web_accessible_resources || []).forEach((w) => w.resources.forEach((f) => required.add(f)));
Object.values(manifest.icons || {}).forEach((f) => required.add(f));

// 图标之外，如果 manifest 引用了别的图片/字体也一并带上
const extraAllow = [];

let failed = 0;
console.log('检查 manifest 引用的文件：');
for (const f of required) {
  const abs = path.join(root, f);
  const exists = fs.existsSync(abs);
  if (!exists) failed++;
  console.log(`  ${exists ? '✓' : '✗'} ${f}${exists ? '' : '  ← 缺失！'}`);
}

// 顺手检查图标尺寸（商店要求 128 必须是 128x128）
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

console.log('\n检查图标尺寸：');
for (const [size, f] of Object.entries(manifest.icons || {})) {
  const abs = path.join(root, f);
  if (!fs.existsSync(abs)) continue;
  const dim = pngSize(fs.readFileSync(abs));
  if (!dim) {
    console.log(`  ✗ ${f} 不是有效 PNG`);
    failed++;
    continue;
  }
  const want = Number(size);
  const ok = dim.w === dim.h && dim.w === want;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${f}  ${dim.w}x${dim.h}（manifest 声明 ${want}）`);
}

// 商店硬性要求
console.log('\n商店元数据：');
const nameLen = [...manifest.name].length;
const descLen = [...(manifest.description || '')].length;
console.log(`  name        ${nameLen}/45  ${nameLen <= 45 ? '✓' : '✗'}`);
console.log(`  description ${descLen}/132 ${descLen <= 132 ? '✓' : '✗'}`);
console.log(`  version     ${manifest.version}  ${/^\d+(\.\d+){0,3}$/.test(manifest.version) ? '✓' : '✗'}`);
if (nameLen > 45 || descLen > 132) failed++;
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) failed++;

if (failed) {
  console.error(`\n有 ${failed} 项不通过，已中止打包。`);
  process.exit(1);
}
if (checkOnly) {
  console.log('\n检查通过（--check 模式，未打包）');
  process.exit(0);
}

/* ---------------- 打包 ---------------- */

const entries = [];
const addFile = (rel) => {
  const abs = path.join(root, rel);
  entries.push({ name: rel.split(path.sep).join('/'), data: fs.readFileSync(abs) });
};

for (const f of required) addFile(f);
for (const f of extraAllow) if (fs.existsSync(path.join(root, f))) addFile(f);

const zip = makeZip(entries);
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outName = `muyu-widget-${manifest.version}.zip`;
const outPath = path.join(outDir, outName);
fs.writeFileSync(outPath, zip);

console.log(`\n已打包 → ${path.relative(root, outPath)}`);
console.log(`  ${(zip.length / 1024).toFixed(1)} KB，${entries.length} 个文件：`);
entries.forEach((e) => console.log(`    ${e.name}  ${(e.data.length / 1024).toFixed(1)} KB`));
console.log('\n提醒：zip 里 manifest.json 位于根目录，可直接上传。');
