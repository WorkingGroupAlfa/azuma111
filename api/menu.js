'use strict';
// GET  /api/menu  (auth) -> {ok, data, ver, source:'redis'|'bundled', storage, bundledChanged}
// POST /api/menu  (auth) {data, ver, message?} -> {ok, ver}
const { send, fail, readJson, requireAuth, HttpError } = require('./_lib/common');
const { getMenu, saveMenu, CONFLICT } = require('./_lib/store');
const { validate } = require('./_lib/validate');

const cleanMessage = m => (typeof m === 'string' ? m.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '').slice(0, 400) || 'оновлення меню';

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'GET') return send(res, 200, Object.assign({ ok: true }, await getMenu()));
    let body;
    try { body = await readJson(req, 2 * 1024 * 1024); } catch (e) { return fail(res, 400, 'Неправильний запит'); }
    if (!body || !Number.isInteger(body.ver) || body.ver < 0) return fail(res, 400, 'Не вказано версію меню (ver)');
    const cur = await getMenu();
    if (cur.ver !== body.ver) throw new HttpError(409, CONFLICT, 'conflict');
    try { validate(body.data, cur.data); } catch (e) { return fail(res, 422, e.message, { code: 'invalid' }); }
    if (JSON.stringify(body.data) === JSON.stringify(cur.data)) return send(res, 200, { ok: true, ver: cur.ver, unchanged: true });
    const ver = await saveMenu(body.data, body.ver, cleanMessage(body.message), cur);
    return send(res, 200, { ok: true, ver });
  } catch (e) {
    if (e instanceof HttpError) return fail(res, e.status, e.message, { code: e.code });
    console.error(e);
    return fail(res, 502, 'Помилка сервера або бази даних: ' + ((e && e.message) || e));
  }
};
