'use strict';
// POST /api/track (public) {t:'visit'|'section'|'dish', s?, c?, n?} -> 204 always.
// Anonymous counters in Upstash Redis, no cookies, no personal data:
//   one hash per Kyiv day "azuma:d:YYYY-MM-DD" (TTL 400 days) with fields
//     visits, s:<section>, x:<section>|<categoryId>|<dish name UA>
//   and the all-time dish hash "azuma:dish" (field <section>|<categoryId>|<name>).
// 1-2 Redis commands per event, sent as one pipeline request.
const { send, readJson, redis, redisConfigured, kyivDay } = require('./_lib/common');

const SECTIONS = ['menu', 'bar', 'tea', 'wine', 'home'];
const BOT = /bot|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp|telegram|curl|wget|python|java\/|go-http|httpclient|okhttp|axios|node-fetch|monitor|uptime|pingdom/i;
const TTL = 400 * 24 * 3600;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 204);
  try {
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || BOT.test(ua) || !redisConfigured()) return send(res, 204);
    // only count beacons sent by the site itself
    const origin = req.headers['origin'];
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* ignore */ }
      if (host !== req.headers['host']) return send(res, 204);
    }
    const b = await readJson(req, 1024);
    if (!b || typeof b !== 'object') return send(res, 204);
    const day = 'azuma:d:' + kyivDay();
    let cmds = null;
    if (b.t === 'visit') cmds = [['HINCRBY', day, 'visits', 1], ['EXPIRE', day, TTL]];
    else if (b.t === 'section' && SECTIONS.includes(b.s)) cmds = [['HINCRBY', day, 's:' + b.s, 1]];
    else if (b.t === 'dish' && SECTIONS.includes(b.s) && b.s !== 'home' &&
      typeof b.c === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(b.c) &&
      typeof b.n === 'string' && b.n.trim() && b.n.length <= 120 && !/[\u0000-\u001f\u007f<>]/.test(b.n)) {
      const f = b.s + '|' + b.c + '|' + b.n.trim().replace(/\|/g, '/');
      cmds = [['HINCRBY', day, 'x:' + f, 1], ['HINCRBY', 'azuma:dish', f, 1]];
    }
    if (cmds) await redis(cmds, 1500);
  } catch (e) { /* analytics must never break anything */ }
  return send(res, 204);
};
