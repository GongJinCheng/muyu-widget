/**
 * 数据层单元测试（零依赖）
 * 用法：node tools/stats.test.js
 *
 * 重点覆盖审查发现的三类真实 bug：
 *   1. 多标签页 / 跨设备并发敲击被 max 吞掉（H1 / M2）
 *   2. goal 被 savedAt 仲裁而被敲击覆盖（M3）
 *   3. 脏数据 / v1 旧存档迁移（L9 / normalize）
 */
const assert = require('assert');
const S = require('../stats.js');

let pass = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    process.exitCode = 1;
  }
}

const mk = (over = {}) => Object.assign(S.makeInitial(108, '2026-11-17'), over);

console.log('\n[normalize / 迁移]');
test('v1 旧存档 total 归入 legacy，不丢失', () => {
  const s = S.normalize({ total: 42, today: 3, todayDate: '2026-11-17' }, 108);
  assert.strictEqual(s.total, 42);
  assert.strictEqual(s.contribs.legacy.n, 42);
});

test('两台设备各自从 v1 迁移，合并不重复计数', () => {
  const a = S.normalize({ total: 100, goal: 108 }, 108);
  const b = S.normalize({ total: 100, goal: 108 }, 108);
  assert.strictEqual(S.merge(a, b).total, 100);
});

test('goal 脏数据被 clamp 到 1–9999', () => {
  assert.strictEqual(S.normalize({ goal: 1e9 }, 108).goal, 9999);
  assert.strictEqual(S.normalize({ goal: -5 }, 108).goal, 108);
  assert.strictEqual(S.normalize({ goal: 'bad' }, 108).goal, 108);
  assert.strictEqual(S.normalize({ goal: 200 }, 108).goal, 200);
});

test('非对象 / null 返回 null', () => {
  assert.strictEqual(S.normalize(null, 108), null);
  assert.strictEqual(S.normalize('x', 108), null);
});

test('contribs 纯数字格式兼容（旧格式 {s1: 5}）', () => {
  const s = S.normalize({ contribs: { s1: 5, s2: 3 } }, 108);
  assert.strictEqual(s.total, 8);
  assert.deepStrictEqual(s.contribs.s1, { n: 5, t: 0 });
});

console.log('\n[G-Counter 并发合并]');
test('多标签页并发 +N，两边增量都保住（原 max 实现会丢）', () => {
  const base = mk({ contribs: { legacy: { n: 100, t: 0 } } });
  const tabA = JSON.parse(JSON.stringify(base));
  const tabB = JSON.parse(JSON.stringify(base));
  S.applyKnock(tabA, 'tab-a', '2026-11-17', '2026-11-16', 1000);
  S.applyKnock(tabA, 'tab-a', '2026-11-17', '2026-11-16', 1100);
  S.applyKnock(tabA, 'tab-a', '2026-11-17', '2026-11-16', 1200);
  S.applyKnock(tabB, 'tab-b', '2026-11-17', '2026-11-16', 1050);
  assert.strictEqual(tabA.total, 103);
  assert.strictEqual(tabB.total, 101);
  const merged = S.merge(tabA, tabB);
  assert.strictEqual(merged.total, 104, '应为 100+3+1');
});

test('跨设备各自离线 +1，合并得 +2（原 max 实现只得 +1）', () => {
  const base = mk({ contribs: { dev: { n: 100, t: 0 } } });
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  S.applyKnock(a, 'dev', '2026-11-17', '2026-11-16', 2000);
  S.applyKnock(b, 'dev', '2026-11-17', '2026-11-16', 2000);
  // 同一 sessionId（如 sync 场景）：取 max 是对的，不重复计
  assert.strictEqual(S.merge(a, b).total, 101);

  const a2 = JSON.parse(JSON.stringify(base));
  const b2 = JSON.parse(JSON.stringify(base));
  S.applyKnock(a2, 'dev-a', '2026-11-17', '2026-11-16', 2000);
  S.applyKnock(b2, 'dev-b', '2026-11-17', '2026-11-16', 2000);
  assert.strictEqual(S.merge(a2, b2).total, 102, '不同设备应 +2');
});

test('合并幂等：merge(a,b) 再 merge 自身不变', () => {
  const a = mk({ contribs: { x: { n: 7, t: 10 } } });
  const b = mk({ contribs: { y: { n: 4, t: 20 } } });
  const m1 = S.merge(a, b);
  const m2 = S.merge(m1, m1);
  assert.strictEqual(m1.total, m2.total);
  assert.strictEqual(m1.total, 11);
});

test('today 只在较新日期一侧保留', () => {
  const a = mk({ today: 5, todayDate: '2026-11-16' });
  const b = mk({ today: 3, todayDate: '2026-11-17' });
  const m = S.merge(a, b);
  assert.strictEqual(m.todayDate, '2026-11-17');
  assert.strictEqual(m.today, 3);
});

console.log('\n[goal 仲裁]');
test('敲击不覆盖后来显式设置的目标（原 savedAt 实现会丢）', () => {
  const a = mk({ goal: 200, goalTime: 1000, savedAt: 1000 });
  const b = mk({ goal: 108, goalTime: 0, savedAt: 5000 }); // b 敲得多
  assert.strictEqual(S.merge(a, b).goal, 200, '应保留显式设置的 200');
});

test('目标修改时间较新者胜出', () => {
  const a = mk({ goal: 108, goalTime: 1000 });
  const b = mk({ goal: 300, goalTime: 2000 });
  assert.strictEqual(S.merge(a, b).goal, 300);
});

test('setGoal 后敲击不再改变 goalTime', () => {
  const s = mk();
  S.applyGoal(s, 250, 1000);
  assert.strictEqual(s.goalTime, 1000);
  S.applyKnock(s, 'tab', '2026-11-17', '2026-11-16', 9000);
  assert.strictEqual(s.goal, 250);
  assert.strictEqual(s.goalTime, 1000, 'goalTime 不应被敲击刷新');
});

console.log('\n[连续天数]');
test('昨天敲过 → 今天 +1', () => {
  const s = mk({ lastDate: '2026-11-16', streak: 4 });
  S.applyKnock(s, 't', '2026-11-17', '2026-11-16', 1);
  assert.strictEqual(s.streak, 5);
});

test('隔天没敲 → 归 1', () => {
  const s = mk({ lastDate: '2026-11-14', streak: 9 });
  S.applyKnock(s, 't', '2026-11-17', '2026-11-16', 1);
  assert.strictEqual(s.streak, 1);
});

test('同一天多敲不重复加连续天数', () => {
  const s = mk();
  S.applyKnock(s, 't', '2026-11-17', '2026-11-16', 1);
  S.applyKnock(s, 't', '2026-11-17', '2026-11-16', 2);
  assert.strictEqual(s.streak, 1);
});

console.log('\n[会话归档]');
test('30 天前的分量归并到 base，total 不变', () => {
  const now = Date.now();
  const s = mk({
    contribs: {
      old: { n: 12, t: now - 40 * 86400000 },
      fresh: { n: 3, t: now - 1000 }
    }
  });
  s.total = 15;
  assert.strictEqual(S.archiveOldSessions(s, now), true);
  assert.strictEqual(s.contribs.base.n, 12);
  assert.strictEqual(s.contribs.old, undefined);
  assert.strictEqual(s.total, 15);
  assert.strictEqual(S.archiveOldSessions(s, now), false, '二次归档应为 no-op');
});

test('legacy 分量不归档（旧存档基线）', () => {
  const s = mk({ contribs: { legacy: { n: 50, t: 1 } } });
  assert.strictEqual(S.archiveOldSessions(s, Date.now()), false);
});

console.log('\n' + pass + ' 项通过');
