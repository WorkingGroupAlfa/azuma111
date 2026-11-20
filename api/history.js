'use strict';
// GET /api/history (auth) -> {ok, ver, source, storage, bundledChanged, items:[{i, v, t, s}]}
//   items: previous versions, newest first; t = when it was replaced, s = summary of that change
const { send, fail, requireAuth } = require('./_lib/common');
const { getMenu, history } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
  if (!requireAuth(req, res)) return;
  try {
    const cur = await getMenu();
    const items = await history();
    return send(res, 200, { ok: true, ver: cur.ver, source: cur.source, storage: cur.storage, bundledChanged: cur.bundledChanged, items });
  } catch (e) {
    return fail(res, 502, 'Не вдалося прочитати історію: ' + ((e && e.message) || e));
  }
};
