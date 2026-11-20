'use strict';
// Shared helpers for the API (Vercel Node.js functions, no dependencies).
// Folder starts with "_" so Vercel does not turn it into an endpoint.
const crypto = require('crypto');
const fs = require('fs');

const env = (k, d) => (process.env[k] && String(process.env[k]).trim()) || d;

/* ---------------- http ---------------- */
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (obj === undefined) { res.end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
const fail = (res, status, error, extra) => send(res, status, Object.assign({ ok: false, error }, extra || {}));

// Works with Vercel's pre-parsed req.body and with a raw Node request (dev server).
async function readJson(req, limit = 1024 * 1024) {
  let b;
  try { b = req.body; } catch (e) { throw new Error('bad json'); }
  if (b !== undefined && b !== null && b !== '') {
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') { if (b.length > limit) throw new Error('too large'); return JSON.parse(b); }
    return b;
  }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }

/* ---------------- auth ---------------- */
const TOKEN_TTL = 12 * 3600 * 1000;
const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest();
function secret() {
  const s = env('SESSION_SECRET', '');
  if (s) return s;
  // derived from the password: changing ADMIN_PASSWORD logs everybody out
  return sha256('azuma-admin-session|' + env('ADMIN_PASSWORD', '')).toString('hex');
}
const b64u = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sign = payload => b64u(crypto.createHmac('sha256', secret()).update(payload).digest());

function passwordOk(given) {
  const real = env('ADMIN_PASSWORD', '');
  if (!real) return false;
  // hash both sides first so lengths are equal and the compare is constant-time
  return crypto.timingSafeEqual(sha256(given), sha256(real));
}
function makeToken() {
  const exp = Date.now() + TOKEN_TTL;
  const p = b64u(JSON.stringify({ v: 1, exp }));
  return { token: p + '.' + sign(p), exp };
}
function checkToken(req) {
  if (!env('ADMIN_PASSWORD', '')) return false;
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(h);
  if (!m) return false;
  const want = Buffer.from(sign(m[1])), got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  try {
    const p = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return p.v === 1 && typeof p.exp === 'number' && p.exp > Date.now();
  } catch (e) { return false; }
}
function requireAuth(req, res) {
  if (checkToken(req)) return true;
  fail(res, 401, 'Сесія завершилась. Увійдіть ще раз.', { code: 'auth' });
  return false;
}

/* ---------------- data.js format ---------------- */
const MARK = 'window.AZUMA_DATA = ';
function parseDataFile(text) {
  const i = text.indexOf(MARK);
  if (i < 0) throw new Error('data.js: "window.AZUMA_DATA = " not found');
  const prefix = text.slice(0, i);
  const json = text.slice(i + MARK.length).replace(/;\s*$/, '');
  return { prefix, data: JSON.parse(json) };
}

/* ---------------- Redis (Upstash REST) ---------------- */
// Production: Upstash via Vercel Marketplace (KV_REST_API_* or UPSTASH_REDIS_REST_*).
// Dev only: LOCAL_REDIS_FILE = path to a JSON file that emulates the few commands used here.
const localFile = () => env('LOCAL_REDIS_FILE') || env('LOCAL_STATS_FILE');
function redisConfigured() {
  return !!((env('KV_REST_API_URL') && env('KV_REST_API_TOKEN')) ||
    (env('UPSTASH_REDIS_REST_URL') && env('UPSTASH_REDIS_REST_TOKEN')) || localFile());
}
// Sends commands as one pipeline request; returns the results in order. Throws on any error.
async function redis(cmds, timeoutMs = 4000) {
  const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
  const tok = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  if (url && tok) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds.map(c => c.map(String))),
      });
      if (!r.ok) throw new Error('redis http ' + r.status);
      const out = await r.json();
      const bad = out.find(x => x && x.error);
      if (bad) throw new Error('redis: ' + bad.error);
      return out.map(x => x.result);
    } finally { clearTimeout(t); }
  }
  if (localFile()) return localRedis(localFile(), cmds);
  throw new Error('redis not configured');
}

// Tiny file-backed stand-in for local tests. EVAL is emulated per script (marker in its first line).
function localRedis(file, cmds) {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { db = {}; }
  const out = cmds.map(c => localCmd(db, c));
  fs.writeFileSync(file, JSON.stringify(db));
  return out;
}
function localCmd(db, [cmd, key, ...a]) {
  switch (cmd) {
    case 'GET': return typeof db[key] === 'string' ? db[key] : null;
    case 'SET': db[key] = String(a[0]); return 'OK';
    case 'DEL': { const had = key in db; delete db[key]; return had ? 1 : 0; }
    case 'INCR': db[key] = String((+db[key] || 0) + 1); return +db[key];
    case 'HINCRBY': { const h = db[key] = db[key] || {}; h[a[0]] = (+h[a[0]] || 0) + (+a[1]); return h[a[0]]; }
    case 'EXPIRE': return db[key] ? 1 : 0;
    case 'HGETALL': { const h = db[key] || {}; return Object.entries(h).flatMap(([k, v]) => [k, String(v)]); }
    case 'LPUSH': { const l = db[key] = db[key] || []; l.unshift(...a.map(String)); return l.length; }
    case 'LTRIM': { const l = db[key] || []; db[key] = l.slice(+a[0], +a[1] + 1); return 'OK'; }
    case 'LRANGE': { const l = db[key] || []; return l.slice(+a[0], +a[1] === -1 ? undefined : +a[1] + 1); }
    case 'LINDEX': { const l = db[key] || []; return l[+a[0]] ?? null; }
    case 'EVAL': {
      // key = script, a = [numkeys, ...keys, ...argv]
      const n = +a[0], K = a.slice(1, 1 + n), A = a.slice(1 + n);
      if (key.startsWith('-- azuma:save')) return localSave(db, K, A);
      throw new Error('unknown script');
    }
    default: throw new Error('unsupported command ' + cmd);
  }
}
// JS twin of SAVE_SCRIPT (store.js) for the local stand-in
function localSave(db, K, A) {
  const cur = +(db[K[1]] || 0);
  if (cur !== +A[0]) return [0, cur];
  let prev = typeof db[K[0]] === 'string' ? db[K[0]] : '';
  if (!prev) prev = A[4];
  if (prev) {
    const l = db[K[2]] = db[K[2]] || [];
    l.unshift('{"v":' + cur + ',"t":' + A[2] + ',"s":' + A[3] + ',"d":' + prev + '}');
    db[K[2]] = l.slice(0, 20);
  }
  db[K[0]] = A[1];
  if (A[5]) db[K[3]] = A[5];
  db[K[1]] = String(cur + 1);
  return [1, cur + 1];
}

// date (YYYY-MM-DD) in Kyiv time; older ICU only knows "Europe/Kiev"
let TZ = 'Europe/Kyiv';
try { new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); } catch (e) { TZ = 'Europe/Kiev'; }
const kyivDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function lastDays(n) {
  const [y, m, d] = kyivDay().split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

module.exports = {
  env, send, fail, readJson, sleep, HttpError, passwordOk, makeToken, checkToken, requireAuth,
  parseDataFile, redis, redisConfigured, kyivDay, lastDays,
};
