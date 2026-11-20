'use strict';
// POST /api/rollback (auth)
//   {index, ver}             -> restore history entry #index as a new version
//   {source:'bundled', ver}  -> restore the js/data.js shipped with the site (e.g. after a developer update)
// The version being replaced goes to the history as usual, so a rollback can itself be undone.
const { send, fail, readJson, requireAuth, HttpError } = require('./_lib/common');
const { getMenu, saveMenu, historyData, bundled, CONFLICT } = require('./_lib/store');

const fmt = t => new Date(t).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  if (!requireAuth(req, res)) return;
  try {
    let body;
    try { body = await readJson(req, 4096); } catch (e) { return fail(res, 400, 'Неправильний запит'); }
    if (!body || !Number.isInteger(body.ver)) return fail(res, 400, 'Не вказано версію меню (ver)');
    const cur = await getMenu();
    if (!cur.storage) return fail(res, 503, 'База даних (Upstash Redis) ще не підключена.', { code: 'storage' });
    if (cur.ver !== body.ver) throw new HttpError(409, CONFLICT, 'conflict');
    let data, summary, seedBase = false;
    if (body.source === 'bundled') {
      data = bundled().data; summary = 'відновлено меню з файлу сайту (js/data.js)'; seedBase = true;
    } else {
      if (!Number.isInteger(body.index) || body.index < 0 || body.index > 50) return fail(res, 400, 'Неправильний номер версії');
      const h = await historyData(body.index);
      data = h.data; summary = 'повернуто версію ' + h.v + ' (стан до ' + fmt(h.t) + ')';
    }
    if (!data || typeof data !== 'object') return fail(res, 422, 'Ця версія пошкоджена');
    const ver = await saveMenu(data, body.ver, summary, cur, { seedBase });
    return send(res, 200, { ok: true, ver });
  } catch (e) {
    if (e instanceof HttpError) return fail(res, e.status, e.message, { code: e.code });
    console.error(e);
    return fail(res, 502, 'Помилка сервера або бази даних: ' + ((e && e.message) || e));
  }
};
