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
          ${p.answers[q.id] ? `<span class="a">${esc(p.answers[q.id])}</span>` : `<span class="a empty">${mine ? `<a href="#/fill/${p.id}?q=${q.id}">Add an answer</a>` : 'Not answered yet'}</span>`}
        </li>`).join('')}
      </ol>
    </article>

    ${mine ? `
      <aside class="card notes-locked">
        <h3>Gift notes</h3>
        <p>Other people can leave notes on your card about what they’re getting you. You can’t see them. That’s the point.</p>
      </aside>
      <p class="danger-zone"><button class="link-btn" data-act="delete">Remove my card</button></p>`
    : `
      <aside class="card notes">
        <h3>Gift notes</h3>
        <p class="muted">Hidden from ${esc(p.name)}. Use it to call dibs so nobody doubles up.</p>
        <ul class="note-list">
          ${(p.notes || []).map(nt => `<li><p>${esc(nt.text)}</p><span class="muted">${nt.by ? esc(nt.by) + ' · ' : ''}${relTime(nt.at)}</span><button class="link-btn" data-note="${nt.id}" aria-label="Delete note">Remove</button></li>`).join('') || '<li class="empty">No notes yet.</li>'}
        </ul>
        <form class="note-form">
          <input name="text" maxlength="300" placeholder="I’m getting the cinnamon candle" required>
          <button class="btn sm">Add note</button>
        </form>
      </aside>`}
  `, mine ? 'me' : '');

  app.querySelector('[data-act="claim"]')?.addEventListener('click', () => { me = p.id; store.set('wl-me', me); refresh(); });
  app.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`Remove ${p.name}’s card and all its answers? This can’t be undone.`)) return;
    await api('DELETE', `people/${p.id}`);
    people = people.filter(x => x.id !== p.id); me = null; store.set('wl-me', null);
    location.hash = '#/';
  });
  app.querySelector('.note-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const text = e.target.text.value;
    try {
      const { person } = await api('POST', `people/${p.id}/notes`, { text, by: myself()?.name || '' });
      upsert(person); renderPerson(p.id); toast('Noted. Your secret is safe.');
    } catch (err) { toast(err.message); }
  });
  app.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', async () => {
    const { person } = await api('DELETE', `people/${p.id}/notes/${b.dataset.note}`);
    upsert(person); renderPerson(p.id);
  }));
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
      <textarea id="answer" rows="3" maxlength="600" placeholder="${esc(q.hint)}">${esc(p.answers[q.id] || '')}</textarea>
      <p class="q-tip muted">Enter for next · Shift+Enter for a new line</p>`;
    const ta = card.querySelector('textarea');
    ta.addEventListener('input', () => {
      p.answers[q.id] = ta.value.trim();
      pending = { ...(pending || {}), [q.id]: ta.value };
      saveState.textContent = '';
      clearTimeout(timer); timer = setTimeout(flush, 700);
    });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(1); } });
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
      ${withAnswer.map(p => `<li class="card"><a href="#/p/${p.id}" class="by-q-who">${ornament(p, 'sm')}<span>${esc(p.name)}</span></a><p class="a">${esc(p.answers[q.id])}</p></li>`).join('')}
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
