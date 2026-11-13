// Family gift questionnaire. Zero dependencies: Node's http module plus a JSON file.
// Configuration is by environment variable; see README.md.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const QUESTIONS_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, 'questions.default.json');
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'family.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const PIN = String(process.env.PIN || '').trim();
if (!/^\d{4,8}$/.test(PIN)) {
  console.error('Set PIN to a 4 to 8 digit family code, for example PIN=2468.');
  process.exit(1);
}

// Questions and title come from a JSON file so every family can write its own.
function loadConfig() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8')); } catch (e) {
    console.error(`Could not read questions from ${QUESTIONS_FILE}: ${e.message}`); process.exit(1);
  }
  const questions = Array.isArray(cfg.questions) ? cfg.questions : [];
  const seen = new Set();
  for (const q of questions) {
    if (!q || typeof q.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(q.id) || typeof q.text !== 'string' || !q.text.trim()) {
      console.error('Each question needs an "id" (letters, numbers, - or _) and a "text".', q); process.exit(1);
    }
    if (seen.has(q.id)) { console.error(`Duplicate question id "${q.id}".`); process.exit(1); }
    seen.add(q.id);
  }
  if (!questions.length) { console.error('The questions file has no questions.'); process.exit(1); }
  const year = String(new Date().getFullYear());
  const fill = v => String(v ?? '').replace(/\{year\}/g, year);
  return {
    title: fill(cfg.title || 'Christmas Questionnaire {year}'),
    kicker: fill(cfg.kicker ?? 'The family’s'),
    questions: questions.map(q => ({ id: q.id, text: q.text.trim(), hint: q.hint ? String(q.hint) : '', stamp: q.stamp ? String(q.stamp) : '' })),
  };
}
const CONFIG = loadConfig();
const QUESTION_IDS = CONFIG.questions.map(q => q.id);

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Cookie secret: from env, else generated once and kept beside the data so restarts don't log people out.
const SECRET = process.env.SECRET || (() => {
  const f = path.join(DATA_DIR, '.secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();
const TOKEN = crypto.createHmac('sha256', SECRET).update('unlocked:' + PIN).digest('hex');

// ---------- storage ----------
let db = { people: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {
  if (e.code !== 'ENOENT') { console.error('Could not read', DB_FILE, e); process.exit(1); }
}
let lastBackupDay = '';
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackupDay) {
    lastBackupDay = day;
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `family-${day}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().slice(0, -30);
    old.forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  }
}

const id = () => crypto.randomBytes(6).toString('base64url');
const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const now = () => new Date().toISOString();

function publicPerson(p, viewer) {
  return {
    id: p.id, name: p.name, ornament: p.ornament, answers: p.answers,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
    // Secret gift notes are kept from the person they're about (honor system: "viewer" is self-reported).
    notes: viewer && viewer === p.id ? null : p.notes,
  };
}

// ---------- tiny helpers ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function authed(req) {
  const t = parseCookies(req).wl || '';
  return t.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN));
}
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// Wrong-PIN throttle: 8 misses per IP per 10 minutes.
const misses = new Map();
function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return String(fwd);
  }
  return String(req.socket.remoteAddress || '');
}
// Mark the cookie Secure only when the visitor is on HTTPS, so plain http://LAN-IP:port setups still work.
function isHttps(req) {
  return Boolean(req.socket.encrypted) || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}
function throttled(ip) {
  const m = misses.get(ip);
  if (!m || Date.now() - m.start > 10 * 60 * 1000) return false;
  return m.count >= 8;
}
function miss(ip) {
  const m = misses.get(ip);
  if (!m || Date.now() - m.start > 10 * 60 * 1000) misses.set(ip, { start: Date.now(), count: 1 });
  else m.count++;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found');
  // The app shell (and any unknown path) gets version-stamped asset URLs so Cloudflare's cache never serves stale code.
  if (rel === '/index.html') return sendShell(res);
  fs.readFile(file, (err, buf) => {
    if (err) return sendShell(res);
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400' });
  });
}
const escHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sendShell(res) {
  try {
    const hash = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, f))).digest('hex').slice(0, 10);
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
      .replace('/styles.css"', `/styles.css?v=${hash('styles.css')}"`)
      .replace('/app.js"', `/app.js?v=${hash('app.js')}"`)
      .replace(/<title>.*<\/title>/, `<title>${escHtml(CONFIG.title)}</title>`);
    send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  } catch { send(res, 404, 'Not found'); }
}

// ---------- routes ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const m = req.method;

  if (parts[0] === 'session' && m === 'GET') {
    const unlocked = authed(req);
    // The title is public (it shows on the lock screen); the questions stay behind the family code.
    return send(res, 200, { unlocked, pinLength: PIN.length, title: CONFIG.title, kicker: CONFIG.kicker,
      questions: unlocked ? CONFIG.questions : undefined });
  }

  if (parts[0] === 'unlock' && m === 'POST') {
    const ip = clientIp(req);
    if (throttled(ip)) return send(res, 429, { error: 'Too many tries. The elves need a 10-minute break.' });
    const body = await readBody(req);
    if (String(body.pin || '') !== PIN) { miss(ip); return send(res, 401, { error: 'Nope, that’s not it.' }); }
    misses.delete(ip);
    return send(res, 200, { ok: true, questions: CONFIG.questions }, {
      'Set-Cookie': `wl=${TOKEN}; Path=/; HttpOnly;${isHttps(req) ? ' Secure;' : ''} SameSite=Lax; Max-Age=${60 * 60 * 24 * 120}`,
    });
  }

  if (!authed(req)) return send(res, 401, { error: 'locked' });

  if (parts[0] !== 'people') return send(res, 404, { error: 'not found' });
  const viewer = url.searchParams.get('viewer') || '';

  if (parts.length === 1 && m === 'GET') {
    return send(res, 200, { people: db.people.map(p => publicPerson(p, viewer)) });
  }
  if (parts.length === 1 && m === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 40);
    if (!name) return send(res, 400, { error: 'Name, please.' });
    if (db.people.length >= 100) return send(res, 400, { error: 'That’s a big family. Too many people.' });
    if (db.people.some(p => p.name.toLowerCase() === name.toLowerCase()))
      return send(res, 409, { error: `${name} is already on the list. Tap their name instead.` });
    const p = { id: id(), name, ornament: Number(body.ornament) % 6 || 0, answers: {}, notes: [], createdAt: now(), updatedAt: now() };
    db.people.push(p); save();
    return send(res, 201, { person: publicPerson(p, p.id) });
  }

  const person = db.people.find(p => p.id === parts[1]);
  if (!person) return send(res, 404, { error: 'Couldn’t find that person.' });

  if (parts.length === 2 && m === 'GET') return send(res, 200, { person: publicPerson(person, viewer) });

  if (parts.length === 2 && m === 'PUT') {
    const body = await readBody(req);
    if (body.name !== undefined) {
      const name = clean(body.name, 40);
      if (!name) return send(res, 400, { error: 'Name, please.' });
      if (db.people.some(p => p !== person && p.name.toLowerCase() === name.toLowerCase()))
        return send(res, 409, { error: `Someone named ${name} is already here.` });
      person.name = name;
    }
    if (body.ornament !== undefined) person.ornament = Math.abs(Number(body.ornament) || 0) % 6;
    if (body.answers && typeof body.answers === 'object') {
      for (const q of QUESTION_IDS) {
        if (body.answers[q] !== undefined) {
          const v = clean(body.answers[q], 600);
          if (v) person.answers[q] = v; else delete person.answers[q];
        }
      }
    }
    person.updatedAt = now(); save();
    return send(res, 200, { person: publicPerson(person, viewer) });
  }

  if (parts.length === 2 && m === 'DELETE') {
    db.people = db.people.filter(p => p !== person); save();
    return send(res, 200, { ok: true });
  }

  if (parts[2] === 'notes' && parts.length === 3 && m === 'POST') {
    const body = await readBody(req);
    if (viewer === person.id) return send(res, 403, { error: 'No peeking at your own surprises.' });
    const text = clean(body.text, 300);
    const by = clean(body.by, 40);
    if (!text) return send(res, 400, { error: 'Write something first.' });
    person.notes.push({ id: id(), text, by, at: now() }); save();
    return send(res, 201, { person: publicPerson(person, viewer) });
  }
  if (parts[2] === 'notes' && parts.length === 4 && m === 'DELETE') {
    person.notes = person.notes.filter(n => n.id !== parts[3]); save();
    return send(res, 200, { person: publicPerson(person, viewer) });
  }

  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  try {
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: 'Something went sideways. Try again?' });
  }
});
server.listen(PORT, () => console.log(`${CONFIG.title}: ${CONFIG.questions.length} questions, listening on :${PORT}, data in ${DATA_DIR}`));
