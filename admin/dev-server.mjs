// Local dev harness for the site + admin (no dependencies, no real Redis).
//
//   ADMIN_PASSWORD=test node admin/dev-server.mjs [port]
//
// Serves the static site from the project root and routes /api/* to the same handlers Vercel runs.
// Redis is replaced by a JSON file (LOCAL_REDIS_FILE, default: <os tmp>/azuma-dev-redis.json),
// so the menu, its history and the statistics all live there. js/data.js is only read, never written.
// Optional: BUNDLED_DATA_FILE = another copy of data.js to use as the "bundled" file (tests).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.argv[2] || process.env.PORT || 8787);

for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
if (!process.env.LOCAL_REDIS_FILE) process.env.LOCAL_REDIS_FILE = path.join(os.tmpdir(), 'azuma-dev-redis.json');
if (!process.env.ADMIN_PASSWORD) { process.env.ADMIN_PASSWORD = 'test'; console.log('ADMIN_PASSWORD not set, using "test"'); }
const BUNDLED = process.env.BUNDLED_DATA_FILE || path.join(ROOT, 'js', 'data.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const API = new Set(['login', 'menu', 'track', 'stats', 'data', 'history', 'rollback']);

// apply the headers from vercel.json (CSP etc.) so they are exercised locally too
const RULES = (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers || []).map(r => ({
  re: new RegExp('^' + r.source.replace(/[.]/g, '\\.').replace(/\/:path\*$/, '(?:/.*)?') + '$'), headers: r.headers,
}));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  for (const r of RULES) if (r.re.test(p)) for (const h of r.headers) res.setHeader(h.key, h.value);
  const api = /^\/api\/([a-z]+)\/?$/.exec(p);
  if (api && API.has(api[1])) {
    try { await require(path.join(ROOT, 'api', api[1] + '.js'))(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end('error'); } }
    console.log(req.method, p, res.statusCode);
    return;
  }
  if (p === '/js/data.js') { res.setHeader('Content-Type', TYPES['.js']); res.setHeader('Cache-Control', 'no-store'); return fs.createReadStream(BUNDLED).pipe(res); }
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}/  admin: /admin/  (redis stand-in: ${process.env.LOCAL_REDIS_FILE})`));
