'use strict';
// Menu storage in Upstash Redis, with the bundled js/data.js as the fallback / initial source.
//   azuma:menu       current menu JSON (same object as window.AZUMA_DATA)
//   azuma:menu:ver   integer version (optimistic concurrency; 0 = nothing saved yet)
//   azuma:menu:hist  list of previous versions, newest first, max 20:
//                    {"v":<version>,"t":<ms when it was replaced>,"s":<summary of that change>,"d":<menu JSON>}
//   azuma:menu:base  sha1 of the bundled js/data.js the Redis menu was seeded from
//                    (if the deployed file differs later, the admin shows "developer updated the file")
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { env, redis, redisConfigured, redisEnvNames, parseDataFile, HttpError } = require('./common');

const K = { menu: 'azuma:menu', ver: 'azuma:menu:ver', hist: 'azuma:menu:hist', base: 'azuma:menu:base' };
const HIST_MAX = 20;
const CONFLICT = 'Хтось інший щойно змінив меню. Перезавантажте сторінку і внесіть зміни ще раз.';

/* ---- bundled js/data.js ----
   vercel.json "functions" -> "includeFiles": "js/data.js" ships the file next to every function;
   the __dirname-relative path is also what Vercel's file tracer follows. No HTTP self-fetch:
   that would break behind Deployment Protection and add latency. */
let bundledCache = null;
function bundled() {
  if (bundledCache) return bundledCache;
  const candidates = [
    env('BUNDLED_DATA_FILE'),                                  // dev/tests only
    path.join(__dirname, '..', '..', 'js', 'data.js'),
    path.join(process.cwd(), 'js', 'data.js'),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      const { data } = parseDataFile(text);
      bundledCache = { text, data, json: JSON.stringify(data), sha: crypto.createHash('sha1').update(text).digest('hex') };
      return bundledCache;
    } catch (e) { /* next */ }
  }
  throw new HttpError(500, 'Не знайдено js/data.js на сервері', 'config');
}

// Atomic check-and-save. KEYS: menu, ver, hist, base. ARGV: expectedVer, newJson, nowMs, summaryJson, fallbackPrevJson, baseSha
const SAVE_SCRIPT = `-- azuma:save
local cur = tonumber(redis.call('GET', KEYS[2]) or '0')
if cur ~= tonumber(ARGV[1]) then return {0, cur} end
local prev = redis.call('GET', KEYS[1])
if not prev or prev == '' then prev = ARGV[5] end
if prev and prev ~= '' then
  redis.call('LPUSH', KEYS[3], '{"v":' .. cur .. ',"t":' .. ARGV[3] .. ',"s":' .. ARGV[4] .. ',"d":' .. prev .. '}')
  redis.call('LTRIM', KEYS[3], 0, ${HIST_MAX - 1})
end
redis.call('SET', KEYS[1], ARGV[2])
if ARGV[6] ~= '' then redis.call('SET', KEYS[4], ARGV[6]) end
local nv = redis.call('INCR', KEYS[2])
return {1, nv}`;

async function getMenu() {
  const b = bundled();
  if (!redisConfigured()) return { data: b.data, ver: 0, source: 'bundled', storage: false, bundledChanged: false, envNames: redisEnvNames() };
  const [m, v, base] = await redis([['GET', K.menu], ['GET', K.ver], ['GET', K.base]]);
  const ver = +v || 0;
  if (!m) return { data: b.data, ver, source: 'bundled', storage: true, bundledChanged: false };
  return { data: JSON.parse(m), ver, source: 'redis', storage: true, bundledChanged: !!base && base !== b.sha };
}

// cur = result of getMenu() the caller validated against; opts.seedBase = record the bundled file as base
async function saveMenu(data, expectVer, summary, cur, opts = {}) {
  if (!redisConfigured()) throw new HttpError(503, 'База даних (Upstash Redis) ще не підключена — зберігати зміни неможливо. Див. інструкцію.', 'storage');
  const b = bundled();
  const fromBundled = cur.source === 'bundled';
  const json = JSON.stringify(data);
  const [r] = await redis([['EVAL', SAVE_SCRIPT, 4, K.menu, K.ver, K.hist, K.base,
    expectVer, json, Date.now(), JSON.stringify(String(summary || '').slice(0, 400)),
    fromBundled ? b.json : '', (fromBundled || opts.seedBase) ? b.sha : '']], 8000);
  if (!r || +r[0] !== 1) throw new HttpError(409, CONFLICT, 'conflict');
  return +r[1];
}

async function history() {
  if (!redisConfigured()) return [];
  const [list] = await redis([['LRANGE', K.hist, 0, HIST_MAX - 1]], 8000);
  return (list || []).map((s, i) => {
    try { const e = JSON.parse(s); return { i, v: e.v, t: e.t, s: e.s }; } catch (err) { return null; }
  }).filter(Boolean);
}
async function historyData(i) {
  const [s] = await redis([['LINDEX', K.hist, i]], 8000);
  if (!s) throw new HttpError(404, 'Цієї версії вже немає в історії. Оновіть сторінку.', 'gone');
  const e = JSON.parse(s);
  return { v: e.v, t: e.t, data: e.d };
}

module.exports = { K, bundled, getMenu, saveMenu, history, historyData, CONFLICT, SAVE_SCRIPT };
