'use strict';

// Questions, title and code length come from the server (questions.json).
let QUESTIONS = [];
let CONFIG = { title: 'Christmas Questionnaire', kicker: '', pinLength: 4 };
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const countWord = n => NUMBER_WORDS[n] || String(n);
const ORNAMENTS = ['cranberry', 'pine', 'gold', 'frost', 'plum', 'silver'];

// ---------- state ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let people = [];
let me = store.get('wl-me');
const app = document.getElementById('app');

// ---------- utils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const answeredCount = p => QUESTIONS.filter(q => p.answers[q.id]).length;
const findPerson = id => people.find(p => p.id === id);
// A "list" question's answer becomes registry lines: one per line, bullets and numbering stripped, duplicates dropped.
// A line starting "Note:" is context, not a gift, so it shows as plain text with no checkbox.
const NOTE = /^note:\s*/i;
function listLines(text) {
  const seen = new Set();
  return String(text || '').split('\n')
    .map(s => s.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim())
    .filter(s => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}
// A request starting with ★ is one the person wants most. Starred requests list first.
const STAR = /^★\s*/;
const starred = s => STAR.test(s);
const listItems = text => {
  const items = listLines(text).filter(s => !NOTE.test(s));
  return [...items.filter(starred), ...items.filter(s => !starred(s))];
};
const stripBullet = l => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim();
// A request's text with its star drawn as a gold mark instead of the raw ★.
const richItem = s => starred(s) ? `<span class="star" role="img" aria-label="Most wanted" title="Most wanted">★</span> ${rich(s.replace(STAR, ''))}` : rich(s);
const listNotes = text => listLines(text).filter(s => NOTE.test(s)).map(s => s.replace(NOTE, '')).filter(Boolean);
// Links: any http(s) URL in a request shows as a short clickable link. Purchases match on the text
// without its links, so adding a link to a request later doesn't lose its checkmark.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const HAS_URL = /\bhttps?:\/\//i;
const itemKey = s => String(s ?? '').replace(STAR, '').replace(URL_RE, ' ').replace(/[\s—–:-]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
const sameItem = (a, b) => itemKey(a) === itemKey(b);
function linkTag(url) {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return `<a class="item-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a>`;
}
// Escape text and turn its URLs into links.
function rich(text) {
  text = String(text ?? '');
  let out = ''; let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    out += esc(text.slice(last, m.index)) + linkTag(url);
    last = m.index + url.length;
  }
  return out + esc(text.slice(last));
}
// Accepts "amazon.com/..." as well as a full URL. Returns '' for blank, null for something that isn't a link.
function normalizeLink(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { const u = new URL(v); return /\./.test(u.hostname) && !/\s/.test(v) ? u.href : null; } catch { return null; }
}
// The purchased section starts closed on every visit so nobody sees it by accident.
let revealedFor = null;
const myself = () => findPerson(me);
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
async function api(method, url, body) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`/api/${url}${me ? `${sep}viewer=${encodeURIComponent(me)}` : ''}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== 'unlock') { renderLock(); throw new Error('locked'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
async function loadPeople() {
  const data = await api('GET', 'people');
  people = data.people.sort((a, b) => a.name.localeCompare(b.name));
  if (me && !findPerson(me)) { me = null; store.set('wl-me', null); }
}
function upsert(p) {
  const i = people.findIndex(x => x.id === p.id);
  if (i >= 0) people[i] = p; else people.push(p);
  people.sort((a, b) => a.name.localeCompare(b.name));
}
const ornament = (p, size = '') => `<span class="orn orn-${ORNAMENTS[p.ornament] || 'cranberry'} ${size}" aria-hidden="true"><span class="orn-cap"></span><span class="orn-ball">${esc(p.name.slice(0, 1).toUpperCase())}</span></span>`;
function relTime(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`;
}
function daysToChristmas() {
  const n = new Date(); const xmas = new Date(n.getFullYear(), 11, 25);
  if (n > xmas && n.getDate() !== 25) xmas.setFullYear(n.getFullYear() + 1);
  return Math.ceil((xmas - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
}

// ---------- lock screen ----------
function renderLock() {
  document.body.dataset.view = 'lock';
  app.innerHTML = `
    <main class="lock">
      <div class="tag" id="tag">
        <div class="tag-hole"></div>
        <p class="tag-to">To: the family</p>
        <p class="tag-from">From: the North Pole</p>
        <h1 class="lock-title">Do not open<br>until you know<br>the code</h1>
        <div class="pin" id="pin" aria-hidden="true">${'<i></i>'.repeat(CONFIG.pinLength)}</div>
        <input id="pin-input" class="sr-only" inputmode="numeric" autocomplete="off" maxlength="${CONFIG.pinLength}" aria-label="Family code" autofocus>
        <div class="keypad" role="group" aria-label="Keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          <span></span><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Delete">⌫</button>
        </div>
        <p class="lock-msg" id="lock-msg" role="alert"></p>
      </div>
    </main>`;
  const input = document.getElementById('pin-input');
  const dots = [...document.querySelectorAll('#pin i')];
  const msg = document.getElementById('lock-msg');
  let busy = false;
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < input.value.length));
  async function tryPin() {
    if (busy || input.value.length < CONFIG.pinLength) return;
    busy = true;
    try {
      const r = await api('POST', 'unlock', { pin: input.value });
      QUESTIONS = r.questions;
      document.getElementById('tag').classList.add('open');
      setTimeout(start, 550);
    } catch (e) {
      msg.textContent = e.message;
      const tag = document.getElementById('tag');
      tag.classList.remove('shake'); void tag.offsetWidth; tag.classList.add('shake');
      setTimeout(() => { input.value = ''; paint(); busy = false; }, 450);
    }
  }
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, CONFIG.pinLength); paint(); tryPin(); });
  document.querySelector('.keypad').addEventListener('click', e => {
    const k = e.target.closest('button')?.dataset.k; if (!k || busy) return;
    input.value = k === 'del' ? input.value.slice(0, -1) : (input.value + k).slice(0, CONFIG.pinLength);
    paint(); tryPin();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (document.body.dataset.view !== 'lock') return document.removeEventListener('keydown', onKey);
    if (document.activeElement !== input && /^[0-9]$|^Backspace$/.test(e.key)) input.focus();
  });
}

// ---------- shell ----------
function shell(inner, active = '') {
  const m = myself();
  document.body.dataset.view = 'app';
  app.innerHTML = `
    <header class="top">
      <a href="#/" class="brand">
        ${CONFIG.kicker ? `<span class="brand-kicker">${esc(CONFIG.kicker)}</span>` : ''}
        <span class="brand-title">${esc(CONFIG.title)}</span>
      </a>
      <nav class="nav">
        <a href="#/" class="${active === 'home' ? 'on' : ''}">Everyone</a>
        <a href="#/q/${QUESTIONS[0].id}" class="${active === 'q' ? 'on' : ''}">By question</a>
        ${m ? `<a href="#/p/${m.id}" class="me-chip ${active === 'me' ? 'on' : ''}">${ornament(m, 'xs')}<span>${esc(m.name)}</span></a>` : ''}
      </nav>
    </header>
    <main class="page">${inner}</main>
    <footer class="foot">${daysToChristmas() === 0 ? 'Merry Christmas!' : `${daysToChristmas()} sleeps until Christmas`}</footer>`;
}

// ---------- home ----------
function renderHome() {
  const m = myself();
  const done = people.filter(p => answeredCount(p) === QUESTIONS.length).length;
  shell(`
    <section class="hero">
      ${m
        ? `<p class="eyebrow">Welcome back, ${esc(m.name)}</p>
           <h2>${answeredCount(m) === QUESTIONS.length ? 'Your card is all filled out.' : `You’ve answered ${answeredCount(m)} of ${QUESTIONS.length}.`}</h2>
           <div class="hero-actions">
             <a class="btn" href="#/fill/${m.id}">${answeredCount(m) === QUESTIONS.length ? 'Tweak my answers' : answeredCount(m) ? 'Keep going' : 'Start my card'}</a>
             <button class="btn ghost" data-act="switch">I’m not ${esc(m.name)}</button>
           </div>`
        : `<p class="eyebrow">${countWord(QUESTIONS.length)} questions. No wrong answers.</p>
           <h2>Who’s filling this out?</h2>
           <p class="lede">Tap your name below, or add yourself. Then everyone can see what you like when they’re shopping.</p>`}
    </section>

    <section>
      <div class="row-head">
        <h3>The family</h3>
        <span class="muted">${people.length ? `${done} of ${people.length} finished` : 'Nobody yet'}</span>
      </div>
      <ul class="tags">
        ${people.map(p => {
          const n = answeredCount(p);
          return `<li><a class="person ${p.id === me ? 'is-me' : ''}" href="#/p/${p.id}">
            ${ornament(p)}
            <span class="person-name">${esc(p.name)}</span>
            <span class="lights" aria-label="${n} of ${QUESTIONS.length} answered">${QUESTIONS.map(q => `<i class="${p.answers[q.id] ? 'lit' : ''}"></i>`).join('')}</span>
            <span class="person-meta">${n === QUESTIONS.length ? 'All done' : `${n} of ${QUESTIONS.length}`}${p.id === me ? ' · you' : ''}</span>
          </a></li>`;
        }).join('')}
        ${m ? '' : `<li><button class="person add" data-act="add"><span class="plus" aria-hidden="true">+</span><span class="person-name">Add yourself</span><span class="person-meta">Takes about 5 minutes</span></button></li>`}
      </ul>
    </section>`, 'home');
  app.querySelector('[data-act="switch"]')?.addEventListener('click', () => { me = null; store.set('wl-me', null); renderHome(); });
  app.querySelector('[data-act="add"]')?.addEventListener('click', openAdd);
}

function openAdd() {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.innerHTML = `
    <form method="dialog" class="add-form">
      <h3>Pick your ornament</h3>
      <label class="field"><span>Your name</span><input name="name" maxlength="40" autocomplete="given-name" required placeholder="First name is fine"></label>
      <fieldset class="orn-pick">
        <legend>Color</legend>
        ${ORNAMENTS.map((o, i) => `<label><input type="radio" name="orn" value="${i}" ${i === people.length % 6 ? 'checked' : ''}>${ornament({ name: ' ', ornament: i })}<span class="sr-only">${o}</span></label>`).join('')}
      </fieldset>
      <p class="form-err" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" value="cancel">Cancel</button>
        <button class="btn" value="ok">Let’s go</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const form = dlg.querySelector('form');
  form.querySelector('[value="cancel"]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      const { person } = await api('POST', 'people', { name: fd.get('name'), ornament: Number(fd.get('orn')) });
      upsert(person); me = person.id; store.set('wl-me', me);
      dlg.close(); location.hash = `#/fill/${person.id}`;
    } catch (err) { form.querySelector('.form-err').textContent = err.message; }
  });
}

// ---------- person ----------
function renderPerson(id) {
  const p = findPerson(id);
  if (!p) return renderMissing();
  const mine = p.id === me;
  const n = answeredCount(p);
  shell(`
    <article class="card sheet">
      <header class="sheet-head">
        ${ornament(p, 'lg')}
        <div>
          <p class="eyebrow">${mine ? 'Your card' : esc(CONFIG.title)}</p>
          <h2>${esc(p.name)}</h2>
          <p class="muted">${n} of ${QUESTIONS.length} answered · updated ${relTime(p.updatedAt)}</p>
        </div>
        ${mine ? `<a class="btn sm" href="#/fill/${p.id}">Edit answers</a>` : ''}
      </header>
      ${!me ? `<div class="claim"><span>Is this you?</span><button class="btn sm" data-act="claim">Yes, I’m ${esc(p.name)}</button></div>` : ''}
      <ol class="answers">
        ${QUESTIONS.map(q => `<li class="${q.stamp ? 'confess' : ''}">
          <span class="q">${esc(q.text)}:</span>
          ${p.answers[q.id] ? (q.list
            ? `${listNotes(p.answers[q.id]).map(n => `<p class="a a-note">${rich(n)}</p>`).join('')}
               ${mine ? '<p class="star-tip">Tap the star on the things you want most.</p>' : ''}
               <ul class="a a-list ${mine ? 'own-list' : ''}">${listItems(p.answers[q.id]).map(it => mine
                 ? `<li><button type="button" class="star-btn ${starred(it) ? 'on' : ''}" data-star-item="${esc(it)}" aria-pressed="${starred(it)}" aria-label="Most wanted: ${esc(it.replace(STAR, ''))}">★</button>
                     <span>${rich(it.replace(STAR, ''))}${!HAS_URL.test(it) ? ` <button type="button" class="link-btn add-link" data-link-item="${esc(it)}">Add link</button>` : ''}</span></li>`
                 : `<li>${richItem(it)}</li>`).join('')}</ul>`
            : `<span class="a">${rich(p.answers[q.id])}</span>`) : (mine && q.list ? '' : `<span class="a empty">${mine ? `<a href="#/fill/${p.id}?q=${q.id}">Add an answer</a>` : 'Not answered yet'}</span>`)}
          ${mine && q.list ? `<form class="note-form request-form" data-q="${q.id}">
            <label class="sr-only" for="req-text">New gift request</label>
            <input id="req-text" name="text" maxlength="300" placeholder="Something you’d like" required>
            <label class="sr-only" for="req-link">Link (optional)</label>
            <input id="req-link" name="link" inputmode="url" autocomplete="off" placeholder="Link (optional)">
            <button class="btn sm">Add request</button>
          </form>` : ''}
        </li>`).join('')}
      </ol>
    </article>

    ${mine ? `
      <aside class="card notes-locked">
        <h3>Already purchased</h3>
        <p>Everyone else can check off what they’ve bought you and add gift ideas for you. You can’t see any of it. That’s the point.</p>
      </aside>
      <p class="danger-zone"><button class="link-btn" data-act="delete">Remove my card</button></p>`
    : purchasedSection(p)}
  `, mine ? 'me' : '');

  app.querySelector('[data-act="claim"]')?.addEventListener('click', () => { me = p.id; store.set('wl-me', me); refresh(); });
  app.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`Remove ${p.name}’s card and all its answers? This can’t be undone.`)) return;
    await api('DELETE', `people/${p.id}`);
    people = people.filter(x => x.id !== p.id); me = null; store.set('wl-me', null);
    location.hash = '#/';
  });
  app.querySelector('[data-act="reveal"]')?.addEventListener('click', () => {
    revealedFor = p.id; renderPerson(p.id);
    document.getElementById('bought')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  });
  app.querySelector('[data-act="conceal"]')?.addEventListener('click', () => { revealedFor = null; renderPerson(p.id); });

  // Every change re-renders from the server's copy, so two shoppers never both see an item as still open.
  async function change(method, url, body, msg) {
    try {
      const { person } = await api(method, url, body);
      upsert(person); renderPerson(p.id); if (msg) toast(msg);
    } catch (err) {
      toast(err.message);
      await refresh().catch(() => {});
    }
  }
  app.querySelectorAll('[data-item]').forEach(cb => cb.addEventListener('change', () => {
    cb.disabled = true;
    const item = cb.dataset.item;
    const g = (p.gifts || []).find(x => x.item && sameItem(x.item, item));
    if (cb.checked) change('POST', `people/${p.id}/gifts`, { item, by: myself()?.name || '' }, 'Marked purchased. Your secret is safe.');
    else if (g) change('DELETE', `people/${p.id}/gifts/${g.id}`);
  }));
  app.querySelector('.gift-form')?.addEventListener('submit', e => {
    e.preventDefault();
    change('POST', `people/${p.id}/gifts`, { text: e.target.text.value, by: myself()?.name || '' }, 'Added. Nobody will double up.');
  });
  app.querySelector('.idea-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const link = normalizeLink(e.target.link.value);
    if (link === null) return toast('That link doesn’t look right.');
    change('POST', `people/${p.id}/ideas`, { text: `${e.target.text.value.trim()}${link ? ' ' + link : ''}`, by: myself()?.name || '' }, `Added. ${p.name} won’t see it.`);
  });

  // Your own card: add a request or attach a link without going through the questionnaire.
  async function saveList(qid, value, msg) {
    try {
      const { person } = await api('PUT', `people/${p.id}`, { answers: { [qid]: value } });
      upsert(person); renderPerson(p.id); toast(msg);
    } catch (err) { toast(err.message); }
  }
  app.querySelector('.request-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const qid = e.target.dataset.q;
    const text = e.target.text.value.trim();
    const link = normalizeLink(e.target.link.value);
    if (link === null) return toast('That link doesn’t look right.');
    if (listItems(p.answers[qid]).some(it => sameItem(it, text))) return toast('That’s already on your list.');
    const current = String(p.answers[qid] || '').trimEnd();
    saveList(qid, `${current ? current + '\n' : ''}${text}${link ? ' ' + link : ''}`, 'Added to your list.');
  });
  app.querySelectorAll('[data-link-item]').forEach(b => b.addEventListener('click', () => {
    const qid = QUESTIONS.find(x => x.list).id;
    const form = document.createElement('form');
    form.className = 'note-form link-form';
    form.innerHTML = `<label class="sr-only" for="link-input">Link for ${esc(b.dataset.linkItem)}</label>
      <input id="link-input" name="link" inputmode="url" autocomplete="off" placeholder="Paste a link" required>
      <button class="btn sm">Save link</button>`;
    b.replaceWith(form);
    form.link.focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const link = normalizeLink(form.link.value);
      if (!link) return toast('That link doesn’t look right.');
      const lines = String(p.answers[qid] || '').split('\n');
      const i = lines.findIndex(l => stripBullet(l) === b.dataset.linkItem);
      if (i < 0) return toast('Couldn’t find that request. Try refreshing.');
      lines[i] = `${lines[i].trimEnd()} ${link}`;
      saveList(qid, lines.join('\n'), 'Link added.');
    });
  }));
  app.querySelectorAll('[data-star-item]').forEach(b => b.addEventListener('click', () => {
    b.disabled = true;
    const qid = QUESTIONS.find(x => x.list).id;
    const lines = String(p.answers[qid] || '').split('\n');
    const i = lines.findIndex(l => stripBullet(l) === b.dataset.starItem);
    if (i < 0) return toast('Couldn’t find that request. Try refreshing.');
    const line = stripBullet(lines[i]);
    const on = !starred(line);
    lines[i] = on ? `★ ${line}` : line.replace(STAR, '');
    saveList(qid, lines.join('\n'), on ? 'Starred. Everyone will see you want this most.' : 'Star removed.');
  }));
  app.querySelectorAll('[data-idea]').forEach(b => b.addEventListener('click', () => change('DELETE', `people/${p.id}/ideas/${b.dataset.idea}`)));
  app.querySelectorAll('[data-gift]').forEach(b => b.addEventListener('click', () => change('DELETE', `people/${p.id}/gifts/${b.dataset.gift}`)));
}

function purchasedSection(p) {
  if (revealedFor !== p.id) return `
    <aside class="card bought-gate">
      <h3>Already purchased</h3>
      <p class="muted">Check off what you’ve bought for ${esc(p.name)}, suggest a gift idea, or log something they didn’t ask for.</p>
      <p class="spoiler">Spoilers for ${esc(p.name)}. If this is your card, stop here.</p>
      <button class="btn" data-act="reveal">Show gifts already purchased</button>
    </aside>`;
  const gifts = p.gifts || [];
  const q = QUESTIONS.find(x => x.list);
  const items = q ? listItems(p.answers[q.id]) : [];
  const ideas = p.ideas || [];
  const forItem = it => gifts.find(g => g.item && sameItem(g.item, it));
  // Gifts not tied to a current request or idea: extras, plus checks on lines that have since been removed.
  const extras = gifts.filter(g => !g.item || ![...items, ...ideas.map(i => i.text)].some(it => sameItem(it, g.item)));
  const who = g => `${g.by ? esc(g.by) + ' · ' : ''}${relTime(g.at)}`;
  return `
    <aside class="card bought" id="bought">
      <div class="bought-head">
        <div>
          <h3>Already purchased</h3>
          <p class="muted">Hidden from ${esc(p.name)}. Check off what you bought so nobody doubles up.</p>
        </div>
        <button class="link-btn" data-act="conceal">Hide</button>
      </div>
      ${q ? `<h4>${esc(p.name)}’s requests</h4>
      ${listNotes(p.answers[q.id]).map(n => `<p class="muted section-note">${rich(n)}</p>`).join('')}
      ${items.some(starred) ? `<p class="muted section-note"><span class="star" aria-hidden="true">★</span> ${esc(p.name)} wants these most.</p>` : ''}
      ${items.length ? `<ul class="registry">
        ${items.map(it => { const g = forItem(it); return `<li class="${g ? 'got' : ''}">
          <div class="reg-text"><span class="reg-item">${richItem(it)}</span>${g ? `<span class="muted">${who(g)}</span>` : ''}</div>
          <label class="reg-check"><input type="checkbox" data-item="${esc(it)}" ${g ? 'checked' : ''}><span>Purchased</span></label>
        </li>`; }).join('')}
      </ul>` : `<p class="muted empty-line">${esc(p.name)} hasn’t asked for anything specific yet.</p>`}` : ''}
      <h4>Ideas from the family</h4>
      <p class="muted section-note">Heard ${esc(p.name)} mention something? Add it here. ${esc(p.name)} won’t see it.</p>
      ${ideas.length ? `<ul class="registry">
        ${ideas.map(idea => { const g = forItem(idea.text); return `<li class="${g ? 'got' : ''}">
          <div class="reg-text">
            <span class="reg-item">${rich(idea.text)}</span>
            <span class="muted">Added by ${esc(idea.by || 'someone')} · ${relTime(idea.at)}${g ? ` · bought by ${esc(g.by || 'someone')}` : ''}</span>
            ${g ? '' : `<button class="link-btn reg-remove" data-idea="${idea.id}" aria-label="Remove idea ${esc(idea.text)}">Remove idea</button>`}
          </div>
          <label class="reg-check"><input type="checkbox" data-item="${esc(idea.text)}" ${g ? 'checked' : ''}><span>Purchased</span></label>
        </li>`; }).join('')}
      </ul>` : ''}
      <form class="note-form idea-form">
        <label for="idea-text" class="sr-only">Gift idea for ${esc(p.name)}</label>
        <input id="idea-text" name="text" maxlength="300" placeholder="Something ${esc(p.name)} mentioned wanting…" required>
        <label for="idea-link" class="sr-only">Link (optional)</label>
        <input id="idea-link" name="link" inputmode="url" autocomplete="off" placeholder="Link (optional)">
        <button class="btn sm">Add request</button>
      </form>
      <h4>Other gifts</h4>
      <ul class="note-list">
        ${extras.map(g => `<li><p>${rich(g.text)}</p><span class="muted">${who(g)}</span><button class="link-btn" data-gift="${g.id}" aria-label="Remove ${esc(g.text)}">Remove</button></li>`).join('') || '<li class="empty">Nothing else yet.</li>'}
      </ul>
      <form class="note-form gift-form">
        <label for="gift-text" class="sr-only">What did you get?</label>
        <input id="gift-text" name="text" maxlength="300" placeholder="What did you get? A cinnamon candle…" required>
        <button class="btn sm">Add gift</button>
      </form>
    </aside>`;
}

// ---------- fill (one question at a time) ----------
function renderFill(id, startQ) {
  const p = findPerson(id);
  if (!p) return renderMissing();
  if (p.id !== me) {
    shell(`<section class="card center"><h2>This is ${esc(p.name)}’s card</h2>
      <p class="lede">Only ${esc(p.name)} should fill this out.</p>
      <div class="hero-actions"><button class="btn" data-act="claim">I’m ${esc(p.name)}</button><a class="btn ghost" href="#/p/${p.id}">Just looking</a></div></section>`);
    app.querySelector('[data-act="claim"]').onclick = () => { me = p.id; store.set('wl-me', me); renderFill(id, startQ); };
    return;
  }
  let idx = Math.max(0, QUESTIONS.findIndex(q => q.id === startQ));
  if (!startQ) { const firstEmpty = QUESTIONS.findIndex(q => !p.answers[q.id]); idx = firstEmpty < 0 ? 0 : firstEmpty; }

  shell(`
    <div class="fill">
      <div class="string" role="tablist" aria-label="Questions">
        ${QUESTIONS.map((q, i) => `<button class="bulb b${i % 5}" data-i="${i}" role="tab" aria-label="Question ${i + 1}"><span></span></button>`).join('')}
      </div>
      <section class="card q-card" id="q-card" aria-live="polite"></section>
      <div class="fill-nav">
        <button class="btn ghost" data-act="prev">Back</button>
        <span class="save-state muted" id="save-state"></span>
        <button class="btn" data-act="next">Next</button>
      </div>
    </div>`, 'me');

  const card = document.getElementById('q-card');
  const saveState = document.getElementById('save-state');
  let timer = null; let pending = null;

  // Saves run one after another so answers never land out of order.
  let chain = Promise.resolve();
  function flush() {
    clearTimeout(timer);
    if (!pending) return chain;
    const answers = pending; pending = null;
    saveState.textContent = 'Saving…';
    chain = chain.then(async () => {
      try {
        const { person } = await api('PUT', `people/${p.id}`, { answers });
        upsert(person);
        saveState.textContent = pending ? '' : 'Saved'; paintBulbs();
      } catch (e) { saveState.textContent = 'Not saved. Check your connection.'; pending = { ...answers, ...(pending || {}) }; }
    });
    return chain;
  }
  function paintBulbs() {
    app.querySelectorAll('.bulb').forEach((b, i) => {
      b.classList.toggle('lit', !!p.answers[QUESTIONS[i].id]);
      b.classList.toggle('cur', i === idx);
      b.setAttribute('aria-selected', i === idx);
    });
  }
  function show(i, dir = 0) {
    idx = i;
    const q = QUESTIONS[i];
    card.className = `card q-card ${q.stamp ? 'confess' : ''} ${dir > 0 ? 'in-right' : dir < 0 ? 'in-left' : ''}`;
    card.innerHTML = `
      <p class="q-num">${i + 1} <span>of ${QUESTIONS.length}</span></p>
      ${q.stamp ? `<span class="stamp" aria-hidden="true">${esc(q.stamp)}</span>` : ''}
      <label for="answer" class="q-text">${esc(q.text)}</label>
      <textarea id="answer" rows="${q.list ? 5 : 3}" placeholder="${esc(q.hint)}">${esc(p.answers[q.id] || '')}</textarea>
      <p class="q-tip muted ${q.list ? 'q-tip-list' : ''}">${q.list ? 'One gift per line. To add a link, paste it at the end of that gift’s line.' : 'Enter for next · Shift+Enter for a new line'}</p>`;
    const ta = card.querySelector('textarea');
    ta.addEventListener('input', () => {
      p.answers[q.id] = ta.value.trim();
      pending = { ...(pending || {}), [q.id]: ta.value };
      saveState.textContent = '';
      clearTimeout(timer); timer = setTimeout(flush, 700);
    });
    // On a list question Enter starts the next line, since each line is its own gift.
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !q.list) { e.preventDefault(); go(1); } });
    if (!matchMedia('(pointer: coarse)').matches) ta.focus();
    app.querySelector('[data-act="prev"]').disabled = i === 0;
    app.querySelector('[data-act="next"]').textContent = i === QUESTIONS.length - 1 ? 'Finish' : 'Next';
    history.replaceState(null, '', `#/fill/${p.id}?q=${q.id}`);
    paintBulbs();
  }
  async function go(d) {
    flush();
    if (idx + d >= QUESTIONS.length) { await chain; return renderDone(p); }
    if (idx + d >= 0) show(idx + d, d);
  }
  app.querySelector('[data-act="prev"]').onclick = () => go(-1);
  app.querySelector('[data-act="next"]').onclick = () => go(1);
  app.querySelectorAll('.bulb').forEach(b => b.onclick = () => { flush(); const i = +b.dataset.i; show(i, i > idx ? 1 : -1); });
  window.onbeforeunload = () => (pending ? true : undefined);
  window.__flush = flush;
  show(idx);
}

function renderDone(p) {
  const n = answeredCount(p);
  const missing = QUESTIONS.filter(q => !p.answers[q.id]);
  shell(`
    <section class="card center done">
      <div class="done-orn">${ornament(p, 'lg')}</div>
      <h2>${n === QUESTIONS.length ? 'All wrapped up' : 'Almost wrapped'}</h2>
      <p class="lede">${n === QUESTIONS.length
        ? 'Your card is saved. Come back anytime to change an answer.'
        : `You skipped ${missing.length}. That’s fine, but the shoppers would love a hint.`}</p>
      <div class="hero-actions">
        ${missing.length ? `<a class="btn" href="#/fill/${p.id}?q=${missing[0].id}">Fill in the gaps</a>` : ''}
        <a class="btn ${missing.length ? 'ghost' : ''}" href="#/p/${p.id}">See my card</a>
        <a class="btn ghost" href="#/">See everyone</a>
      </div>
    </section>`, 'me');
  // Leave the fill URL so "Fill in the gaps" always counts as a navigation.
  history.replaceState(null, '', '#/done');
  if (n === QUESTIONS.length) confetti();
}

// ---------- by question ----------
function renderQuestion(qid) {
  const qi = Math.max(0, QUESTIONS.findIndex(q => q.id === qid));
  const q = QUESTIONS[qi];
  const withAnswer = people.filter(p => p.answers[q.id]);
  const without = people.filter(p => !p.answers[q.id]);
  shell(`
    <div class="qpick">
      <label for="qsel" class="sr-only">Question</label>
      <select id="qsel">${QUESTIONS.map((x, i) => `<option value="${x.id}" ${i === qi ? 'selected' : ''}>${i + 1}. ${esc(x.text)}</option>`).join('')}</select>
      <div class="qpick-nav">
        <a class="btn ghost sm" href="#/q/${QUESTIONS[(qi + QUESTIONS.length - 1) % QUESTIONS.length].id}" aria-label="Previous question">←</a>
        <a class="btn ghost sm" href="#/q/${QUESTIONS[(qi + 1) % QUESTIONS.length].id}" aria-label="Next question">→</a>
      </div>
    </div>
    <h2 class="q-heading">${esc(q.text)}</h2>
    ${withAnswer.length ? `<ul class="by-q">
      ${withAnswer.map(p => `<li class="card"><a href="#/p/${p.id}" class="by-q-who">${ornament(p, 'sm')}<span>${esc(p.name)}</span></a><p class="a">${rich(p.answers[q.id])}</p></li>`).join('')}
    </ul>` : '<p class="lede">Nobody has answered this one yet.</p>'}
    ${without.length ? `<p class="muted waiting">Still thinking: ${without.map(p => esc(p.name)).join(', ')}</p>` : ''}
  `, 'q');
  document.getElementById('qsel').onchange = e => { location.hash = `#/q/${e.target.value}`; };
}

function renderMissing() {
  shell(`<section class="card center"><h2>Hmm, can’t find that one.</h2><p class="lede">Maybe it got re-wrapped.</p><a class="btn" href="#/">Back to everyone</a></section>`);
}

// ---------- router ----------
async function route() {
  window.onbeforeunload = null;
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const qs = new URLSearchParams(query || '');
  const parts = (path || '/').split('/').filter(Boolean);
  if (parts[0] === 'p') renderPerson(parts[1]);
  else if (parts[0] === 'fill') renderFill(parts[1], qs.get('q'));
  else if (parts[0] === 'q') renderQuestion(parts[1]);
  else renderHome();
  window.scrollTo(0, 0);
}
async function refresh() { await loadPeople(); route(); }
async function start() {
  try { await refresh(); } catch (e) { if (e.message !== 'locked') { app.innerHTML = `<main class="page"><section class="card center"><h2>The sleigh is stuck.</h2><p class="lede">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></section></main>`; } }
}
window.addEventListener('hashchange', async () => {
  if (document.body.dataset.view === 'lock') return;
  if (window.__flush) { const f = window.__flush; window.__flush = null; await f(); }
  revealedFor = null;
  try { await loadPeople(); } catch { return; }
  route();
});
// Pick up other people's edits when you come back to the tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.body.dataset.view === 'app' && !location.hash.startsWith('#/fill')) refresh().catch(() => {});
});

(async () => {
  try {
    const s = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
    CONFIG = { title: s.title, kicker: s.kicker, pinLength: s.pinLength || 4 };
    if (s.questions) QUESTIONS = s.questions;
    s.unlocked ? start() : renderLock();
  } catch { renderLock(); }
})();

// ---------- snow + confetti ----------
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
(function snow() {
  const c = document.getElementById('snow'); const ctx = c.getContext('2d');
  if (reduce) { c.remove(); return; }
  let w, h, flakes;
  const make = () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 2.2 + 0.6, s: Math.random() * 0.5 + 0.25, d: Math.random() * Math.PI * 2 });
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    flakes = Array.from({ length: Math.round(Math.min(90, w / 14)) }, make);
  }
  size(); addEventListener('resize', size);
  (function tick() {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (const f of flakes) {
      f.d += 0.01; f.y += f.s; f.x += Math.sin(f.d) * 0.3;
      if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(tick);
  })();
})();
function confetti() {
  if (reduce) return;
  const colors = ['#b8312a', '#d4a63a', '#2f6b47', '#f4ead6', '#8fb3c9'];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement('i');
    el.className = 'confetti';
    el.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.6}s;animation-duration:${2 + Math.random() * 1.6}s;transform:rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
}
