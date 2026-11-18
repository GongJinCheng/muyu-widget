/**
 * 木鱼挂件 · 功德数据层
 * ---------------------------------------------------------------------------
 * 从 content.js 抽离出来，因为这是最容易出 bug、也最需要独立测试的部分。
 * 同时支持浏览器全局（window.MuyuStats）和 Node（module.exports），
 * 于是 tools/stats.test.js 可以直接 require 它做单元测试。
 *
 * 数据模型（v2）
 * ---------------------------------------------------------------------------
 * {
 *   v: 2,
 *   total, today, todayDate, streak, lastDate,   // 展示用
 *   goal, goalTime,                               // 目标 + 独立的修改时间
 *   contribs: { [sessionId]: count | {n, t} },    // G-Counter 分量
 *   savedAt
 * }
 *
 * 为什么用 G-Counter（每个会话一个分量，合并取逐分量 max，total 取和）：
 *   - 多标签页：同设备两个标签页各自 +N，用 max 会丢增量；用不同 sessionId
 *     分量再取和就能保住两边。
 *   - 跨设备：A、B 各自离线 +1，合并后 total 应 +2，而不是取 max 的 +1。
 *
 * 为什么 goal 要有独立的 goalTime：
 *   旧实现用 savedAt 仲裁 goal，但 savedAt 每次敲击都刷新，于是「最近敲得
 *   多的设备」会覆盖「最近显式改过目标」的设备。goalTime 只在 setGoal 时更新。
 *
 * 旧存档兼容：
 *   v1 只有 total/today/... 没有 contribs。normalize 时把 total 归到 'legacy'
 *   分量。两台旧设备各自迁移后都得到 {legacy: N}，合并取 max 不会重复计数。
 *
 * 会话分量归档：
 *   每次页面加载生成新 sessionId，contribs 会缓慢增长。对超过 30 天未更新的
 *   分量归并到 'base'——旧会话不可能还开着，归并是安全的。
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MuyuStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ARCHIVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const date = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
  const time = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

  /** 把 contribs 的 value 统一成 {n, t}，兼容旧的纯数字格式 */
  function normContribs(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const key of Object.keys(raw)) {
      const v = raw[key];
      if (Number.isFinite(v)) {
        out[key] = { n: count(v), t: 0 };
      } else if (v && typeof v === 'object') {
        out[key] = { n: count(v.n), t: time(v.t) };
      }
    }
    return out;
  }

  function sumContribs(contribs) {
    let s = 0;
    for (const k of Object.keys(contribs)) s += contribs[k].n;
    return s;
  }

  /** 初始存档 */
  function makeInitial(goal, todayDate) {
    return {
      v: 2,
      total: 0,
      today: 0,
      todayDate: todayDate || '',
      streak: 0,
      lastDate: '',
      goal: goal,
      goalTime: 0,
      contribs: {},
      savedAt: 0
    };
  }

  /**
   * 容错 + 迁移。任何脏数据都退回安全值。
   * @param {object} raw 原始存档
   * @param {number} defaultGoal 默认目标
   */
  function normalize(raw, defaultGoal) {
    if (!raw || typeof raw !== 'object') return null;

    // 非正数视为无效，回退默认；正数 clamp 到 1–9999
    const goal =
      Number.isFinite(raw.goal) && raw.goal > 0
        ? Math.min(9999, Math.max(1, Math.floor(raw.goal)))
        : defaultGoal;

    let contribs = normContribs(raw.contribs);
    // v1 迁移：没有 contribs 就把 total 归到 legacy
    if (!Object.keys(contribs).length && count(raw.total)) {
      contribs = { legacy: { n: count(raw.total), t: 0 } };
    }

    return {
      v: 2,
      total: sumContribs(contribs),
      today: count(raw.today),
      todayDate: date(raw.todayDate),
      streak: count(raw.streak),
      lastDate: date(raw.lastDate),
      goal,
      goalTime: time(raw.goalTime),
      contribs,
      savedAt: time(raw.savedAt)
    };
  }

  /**
   * 合并两份存档。G-Counter 逐分量取 max；日期/连续天数取较新；
   * 目标用 goalTime 仲裁（与敲击时间解耦）。
   */
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;

    const todayDate = a.todayDate > b.todayDate ? a.todayDate : b.todayDate;
    const lastDate = a.lastDate > b.lastDate ? a.lastDate : b.lastDate;
    const streak =
      a.lastDate === b.lastDate
        ? Math.max(a.streak, b.streak)
        : a.lastDate > b.lastDate
        ? a.streak
        : b.streak;

    // 逐分量取 max
    const contribs = {};
    const keys = new Set([...Object.keys(a.contribs || {}), ...Object.keys(b.contribs || {})]);
    for (const k of keys) {
      const av = (a.contribs || {})[k] || { n: 0, t: 0 };
      const bv = (b.contribs || {})[k] || { n: 0, t: 0 };
      contribs[k] = {
        n: Math.max(av.n, bv.n),
        t: Math.max(av.t, bv.t)
      };
    }

    // goal 用独立时间戳仲裁；相等时取较大值，避免来回跳
    const goal =
      a.goalTime === b.goalTime
        ? Math.max(a.goal, b.goal)
        : a.goalTime > b.goalTime
        ? a.goal
        : b.goal;

    return {
      v: 2,
      total: sumContribs(contribs),
      today: Math.max(a.todayDate === todayDate ? a.today : 0, b.todayDate === todayDate ? b.today : 0),
      todayDate,
      lastDate,
      streak,
      goal,
      goalTime: Math.max(a.goalTime, b.goalTime),
      contribs,
      savedAt: Math.max(a.savedAt, b.savedAt)
    };
  }

  /** 两份存档在「可见状态」上是否一致（用于避免 onChanged 写回死循环） */
  function sameVisible(a, b) {
    if (!a || !b) return a === b;
    return (
      a.total === b.total &&
      a.today === b.today &&
      a.todayDate === b.todayDate &&
      a.streak === b.streak &&
      a.lastDate === b.lastDate &&
      a.goal === b.goal &&
      a.goalTime === b.goalTime
    );
  }

  /** 记一次敲击。返回是否真的变了（用于决定要不要写回） */
  function applyKnock(stats, sessionId, dayKey, yesterdayKey, now) {
    if (!stats) return false;
    if (stats.todayDate !== dayKey) {
      stats.todayDate = dayKey;
      stats.today = 0;
    }
    if (stats.lastDate !== dayKey) {
      stats.streak = stats.lastDate === yesterdayKey ? stats.streak + 1 : 1;
      stats.lastDate = dayKey;
    }
    const cur = stats.contribs[sessionId] || { n: 0, t: 0 };
    stats.contribs[sessionId] = { n: cur.n + 1, t: now };
    stats.total = sumContribs(stats.contribs);
    stats.today += 1;
    stats.savedAt = now;
    return true;
  }

  /** 改目标。goalTime 单独更新，不受敲击影响 */
  function applyGoal(stats, goal, now) {
    if (!stats) return false;
    const g = Math.min(9999, Math.max(1, Math.floor(Number(goal))));
    if (!Number.isFinite(g) || (stats.goal === g && stats.goalTime)) return false;
    stats.goal = g;
    stats.goalTime = now;
    stats.savedAt = now;
    return true;
  }

  /**
   * 归档 30 天前的会话分量到 base。
   * 返回值：是否发生了归档（调用方据此决定是否写回）。
   */
  function archiveOldSessions(stats, now) {
    if (!stats) return false;
    let changed = false;
    const cutoff = now - ARCHIVE_MAX_AGE_MS;
    const base = stats.contribs.base || { n: 0, t: 0 };

    for (const k of Object.keys(stats.contribs)) {
      if (k === 'base' || k === 'legacy') continue;
      const v = stats.contribs[k];
      if (v.t && v.t < cutoff) {
        base.n += v.n;
        base.t = Math.max(base.t, v.t);
        delete stats.contribs[k];
        changed = true;
      }
    }
    if (changed) {
      stats.contribs.base = base;
      stats.total = sumContribs(stats.contribs);
    }
    return changed;
  }

  return {
    makeInitial,
    normalize,
    merge,
    sameVisible,
    applyKnock,
    applyGoal,
    archiveOldSessions,
    sumContribs,
    // 供测试使用
    _internals: { normContribs, ARCHIVE_MAX_AGE_MS }
  };
});
