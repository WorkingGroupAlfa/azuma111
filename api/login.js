'use strict';
// POST /api/login {password} -> {ok, token, exp}
const { send, fail, readJson, sleep, passwordOk, makeToken, env } = require('./_lib/common');

// per-instance failure counter: each wrong attempt from an IP makes the next answer slower
const fails = new Map();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  if (!env('ADMIN_PASSWORD', '')) return fail(res, 500, 'На сервері не задано ADMIN_PASSWORD.', { code: 'config' });
  let body;
  try { body = await readJson(req, 4096); } catch (e) { return fail(res, 400, 'Неправильний запит'); }
  const pw = body && typeof body.password === 'string' ? body.password : '';
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (pw && pw.length <= 200 && passwordOk(pw)) {
    fails.delete(ip);
    return send(res, 200, Object.assign({ ok: true }, makeToken()));
  }
  const n = (fails.get(ip) || 0) + 1;
  fails.set(ip, n);
  if (fails.size > 5000) fails.clear();
  await sleep(Math.min(800 * n, 6000));
  return fail(res, 401, 'Неправильний пароль', { code: 'password' });
};
