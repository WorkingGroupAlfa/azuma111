'use strict';
// GET /api/data (public) -> JavaScript: window.AZUMA_DATA = {...};
// Current menu from Redis; if Redis is not set up, empty, slow or down -> the bundled js/data.js as is.
// Edge-cached for 30 s, so a page view costs Redis nothing most of the time and edits show up within ~30 s.
const { redis, redisConfigured } = require('./_lib/common');
const { K, bundled } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
  let body = null, source = 'bundled';
  if (redisConfigured()) {
    try {
      const [m] = await redis([['GET', K.menu]], 2000);
      if (typeof m === 'string' && m.charAt(0) === '{') { body = 'window.AZUMA_DATA = ' + m + ';\n'; source = 'redis'; }
    } catch (e) { /* fall back to the bundled file */ }
  }
  if (!body) {
    try { body = bundled().text; } catch (e) { res.statusCode = 500; res.setHeader('Cache-Control', 'no-store'); return res.end('/* menu unavailable */'); }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // a fallback answer is cached briefly too, but not for long: Redis may be back in a moment
  res.setHeader('Cache-Control', source === 'redis'
    ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=300'
    : 'public, max-age=0, s-maxage=10, stale-while-revalidate=60');
  res.setHeader('X-Menu-Source', source);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(req.method === 'HEAD' ? undefined : body);
};
