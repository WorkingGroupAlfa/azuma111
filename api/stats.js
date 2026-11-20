'use strict';
// GET /api/stats?days=7|30|90 (auth) -> totals and daily series for visits/sections, top dishes.
const { send, fail, requireAuth, redis, redisConfigured, lastDays } = require('./_lib/common');

const SECTIONS = ['home', 'menu', 'bar', 'tea', 'wine'];
// Upstash returns HGETALL as a flat [field, value, ...] list
function toObj(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = +arr[i + 1] || 0;
  return o;
}
function dish(f, count) { const [s, c, ...n] = f.split('|'); return { s, c, n: n.join('|'), count }; }
const top = (map, k) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, k).map(([f, v]) => dish(f, v));

module.exports = async (req, res) => {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
  if (!requireAuth(req, res)) return;
  if (!redisConfigured()) return send(res, 200, { ok: true, configured: false });
  let n = parseInt(new URL(req.url, 'http://x').searchParams.get('days'), 10);
  if (![7, 30, 90].includes(n)) n = 30;
  const days = lastDays(n);
  try {
    const out = await redis(days.map(d => ['HGETALL', 'azuma:d:' + d]).concat([['HGETALL', 'azuma:dish']]), 8000);
    const series = [], sections = {}, dishes = {};
    let visits = 0;
    SECTIONS.forEach(s => { sections[s] = 0; });
    days.forEach((d, i) => {
      const h = toObj(out[i]);
      const row = { day: d, visits: h.visits || 0 };
      SECTIONS.forEach(s => { row[s] = h['s:' + s] || 0; sections[s] += row[s]; });
      visits += row.visits;
      for (const k in h) if (k.startsWith('x:')) dishes[k.slice(2)] = (dishes[k.slice(2)] || 0) + h[k];
      series.push(row);
    });
    return send(res, 200, {
      ok: true, configured: true, days: n, series,
      totals: { visits, dishOpens: Object.values(dishes).reduce((a, b) => a + b, 0), sections },
      topDishes: top(dishes, 30),
      topDishesAllTime: top(toObj(out[days.length]), 30),
    });
  } catch (e) {
    return fail(res, 502, 'Не вдалося прочитати статистику: ' + ((e && e.message) || e));
  }
};
