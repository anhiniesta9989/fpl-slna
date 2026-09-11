import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8787);
const FPL_BASE = 'https://fantasy.premierleague.com/api';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 120000);
const USER_AGENT = process.env.USER_AGENT || 'FPL-Master-Dashboard/0.1';

const cache = new Map();

function json(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(data);
}

function safeInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function fetchJson(path) {
  const key = path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${FPL_BASE}${path}`, {
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`FPL API ${response.status}: ${text.slice(0, 160)}`);
    }
    const data = await response.json();
    cache.set(key, { at: Date.now(), data });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'fpl-master-dashboard', now: new Date().toISOString() });
    }

    if (url.pathname === '/api/fpl/bootstrap') {
      return json(res, 200, await fetchJson('/bootstrap-static/'));
    }
    if (url.pathname === '/api/fpl/fixtures') {
      return json(res, 200, await fetchJson('/fixtures/'));
    }

    let m = url.pathname.match(/^\/api\/fpl\/entry\/(\d+)$/);
    if (m) return json(res, 200, await fetchJson(`/entry/${m[1]}/`));

    m = url.pathname.match(/^\/api\/fpl\/history\/(\d+)$/);
    if (m) return json(res, 200, await fetchJson(`/entry/${m[1]}/history/`));

    m = url.pathname.match(/^\/api\/fpl\/picks\/(\d+)\/(\d+)$/);
    if (m) {
      const teamId = safeInt(m[1]);
      const gw = safeInt(m[2]);
      if (!teamId || !gw) return json(res, 400, { error: 'Invalid team ID or gameweek' });
      return json(res, 200, await fetchJson(`/entry/${teamId}/event/${gw}/picks/`));
    }

    m = url.pathname.match(/^\/api\/fpl\/live\/(\d+)$/);
    if (m) {
      const gw = safeInt(m[1]);
      if (!gw) return json(res, 400, { error: 'Invalid gameweek' });
      return json(res, 200, await fetchJson(`/event/${gw}/live/`));
    }

    // This dashboard intentionally exposes public FPL data only.
    // Authenticated /my-team is not proxied so no password/session cookie is stored here.
    return json(res, 404, { error: 'Unknown API route' });
  } catch (error) {
    return json(res, 502, {
      error: 'Unable to reach the official FPL API',
      detail: error?.message || String(error),
      hint: 'The UI can fall back to demo data. Try again when network access is available.',
    });
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const clean = normalize(requested).replace(/^([.][.][/\\])+/, '');
  const full = join(PUBLIC_DIR, clean);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error('not file');
    const data = await readFile(full);
    res.writeHead(200, {
      'content-type': mime[extname(full)] || 'application/octet-stream',
      'cache-control': extname(full) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch {
    // SPA fallback
    const data = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`FPL Master Dashboard: http://localhost:${PORT}`);
  console.log(`Default manager: 2320843`);
});
