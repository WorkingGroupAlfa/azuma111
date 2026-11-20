/* Azuma menu admin. Vanilla JS, no build step.
   State: the menu is loaded from /api/menu, every item gets a stable uid; edits are staged in memory
   and sent as one commit by "Зберегти зміни". */
(function () {
'use strict';

const SECTIONS = [
  { key: 'menu', ua: 'Кухня' }, { key: 'bar', ua: 'Бар' }, { key: 'tea', ua: 'Чай' }, { key: 'wine', ua: 'Вина' },
];
const SEC_UA = { home: 'Головна', menu: 'Кухня', bar: 'Бар', tea: 'Чай', wine: 'Вина' };
const SPICE = ['Не гостра', 'Пікантна', 'Гостра'];
const TOKEN_KEY = 'azuma-admin-token';
const $ = (s, el) => (el || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const narrow = () => matchMedia('(max-width: 859px)').matches;

/* ---------------- api ---------------- */
let token = null;
try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); if (t && t.exp > Date.now()) token = t.token; } catch (e) { /* ignore */ }

async function api(path, opts) {
  opts = opts || {};
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
  } catch (e) { throw Object.assign(new Error('Немає з’єднання з сервером. Перевірте інтернет і спробуйте ще раз.'), { code: 'network' }); }
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  if (r.status === 401 && path !== '/api/login') { setToken(null); showLogin('Сесія завершилась. Увійдіть ще раз — незбережені зміни залишаться.'); }
  if (!r.ok || !j || j.ok === false) throw Object.assign(new Error((j && j.error) || ('Помилка сервера (' + r.status + ')')), { code: j && j.code, status: r.status });
  return j;
}
function setToken(t, exp) {
  token = t;
  try { if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: t, exp })); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

/* ---------------- login ---------------- */
function showLogin(msg) {
  $('#login').hidden = false;
  const e = $('#loginErr'); e.hidden = !msg; e.textContent = msg || '';
  setTimeout(() => $('#pw').focus(), 30);
}
$('#loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('#loginBtn'), err = $('#loginErr');
  btn.disabled = true; btn.textContent = 'Перевірка…'; err.hidden = true;
  try {
    const j = await api('/api/login', { method: 'POST', body: { password: $('#pw').value } });
    setToken(j.token, j.exp);
    $('#pw').value = '';
    $('#login').hidden = true;
    $('#app').hidden = false;
    if (!S) loadMenu();
    if (view === 'stats') loadStats();
    if (view === 'history') loadHistory();
  } catch (e) {
    err.hidden = false; err.textContent = e.message;
    $('#pw').select();
  } finally { btn.disabled = false; btn.textContent = 'Увійти'; }
});
$('#logout').addEventListener('click', () => {
  if (changeCount() && !armed('logout')) { toast('Є незбережені зміни. Натисніть «Вийти» ще раз, щоб вийти без збереження.'); return; }
  setToken(null); dirtyOk = true; location.reload();
});
// two-step actions without confirm(): first tap arms, second tap within 4 s does it
let armedKey = null, armedAt = 0;
function armed(k) { const ok = armedKey === k && Date.now() - armedAt < 4000; armedKey = ok ? null : k; armedAt = Date.now(); return ok; }

/* ---------------- model ---------------- */
let S = null;            // { ver, secs: {key: [cat]}, byUid: Map, data, meta }
let uidSeq = 0;
let section = 'menu', query = '', view = 'menu';
const open = new Set();      // uids with editor open
const collapsed = new Set(); // category keys collapsed
let editingPrice = null;     // uid with inline price editor
let confirmDel = null;       // uid with delete confirm shown
let dirtyOk = false;

// item array <-> editable fields
function fromArr(a) {
  const o = a[9];
  return {
    nu: a[0], ne: a[1], p: a[2], du: a[3], de: a[4], sp: a[5],
    lu: a[6] || '', le: a[7] || '', ph: a[8] || '',
    ou: o ? o[0].join(', ') : '', oe: o ? o[1].join(', ') : '',
  };
}
const splitOpts = s => String(s).split(',').map(x => x.trim()).filter(Boolean);
// only trims and removes line breaks, so untouched items serialise byte-for-byte as they were
const clean = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim();
const cleanLong = clean;
function toArr(f, origLen) {
  const ou = splitOpts(f.ou), oe = splitOpts(f.oe);
  const hasOpts = ou.length > 0 || oe.length > 0;
  let L = origLen || 6;
  if (hasOpts) L = 10; else if (L === 10) L = 9;
  const lu = cleanLong(f.lu), le = cleanLong(f.le);
  if ((lu || le) && L < 8) L = 8;
  const nu = clean(f.nu), ne = clean(f.ne) || nu;
  // options: missing EN values fall back to UA so both lists stay the same length
  const optsEn = ou.map((x, i) => oe[i] || x);
  const full = [nu, ne, normPrice(f.p), clean(f.du), clean(f.de), f.sp | 0, lu, le, f.ph || '', [ou, optsEn]];
  return full.slice(0, L);
}
function normPrice(p) {
  return String(p == null ? '' : p).split('/').map(x => x.replace(/\D/g, '')).filter(Boolean).join(' / ');
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function buildState(data, ver, meta) {
  const secs = {}, byUid = new Map();
  for (const s of SECTIONS) {
    secs[s.key] = (data[s.key] || []).map(c => {
      const ents = c.items.map(it => {
        const e = Array.isArray(it)
          ? { k: 'i', uid: ++uidSeq, orig: it, f: fromArr(it), del: false, sec: s.key, cat: c.id }
          : { k: 'h', uid: ++uidSeq, obj: it, sec: s.key, cat: c.id };
        byUid.set(e.uid, e);
        return e;
      });
      return { id: c.id, ua: c.ua, en: c.en, raw: c, ents, origOrder: ents.map(e => e.uid), sec: s.key };
    });
  }
  return { ver, secs, byUid, data, meta: meta || {} };
}
const catOf = e => S.secs[e.sec].find(c => c.id === e.cat);
const isNew = e => e.k === 'i' && !e.orig;
const isChanged = e => e.k === 'i' && !!e.orig && !e.del && !same(toArr(e.f, e.orig.length), e.orig);
function orderChanged(cat) {
  const keep = cat.ents.filter(e => e.k === 'h' || (e.orig && !e.del)).map(e => e.uid);
  const was = cat.origOrder.filter(u => keep.includes(u));
  return !same(keep, was);
}
function changeCount(secKey) {
  if (!S) return 0;
  let n = 0;
  for (const s of SECTIONS) {
    if (secKey && s.key !== secKey) continue;
    for (const c of S.secs[s.key]) {
      for (const e of c.ents) if (e.k === 'i' && ((isNew(e) && !e.del) || (e.orig && e.del) || isChanged(e))) n++;
      if (orderChanged(c)) n++;
    }
  }
  return n;
}
const catChanged = c => orderChanged(c) || c.ents.some(e => e.k === 'i' && ((isNew(e)) || (e.orig && e.del) || isChanged(e)));

function problems(e) {
  const p = [];
  if (!clean(e.f.nu)) p.push('немає назви');
  if (!priceParts(e.f.p).every(Boolean)) p.push('немає ціни');
  for (const k of ['nu', 'ne', 'du', 'de', 'lu', 'le', 'ou', 'oe']) if (/[<>]/.test(e.f[k] || '')) { p.push('символи < > не дозволені'); break; }
  return p;
}

function buildData() {
  const out = {};
  for (const key of Object.keys(S.data)) {
    if (!S.secs[key]) { out[key] = S.data[key]; continue; }
    out[key] = S.secs[key].map(c => {
      const cat = Object.assign({}, c.raw);
      cat.items = c.ents.filter(e => !e.del).map(e => e.k === 'h' ? e.obj : (e.orig && !isChanged(e) ? e.orig : toArr(e.f, e.orig ? e.orig.length : 0)));
      return cat;
    });
  }
  return out;
}
function summary() {
  const parts = [];
  for (const s of SECTIONS) for (const c of S.secs[s.key]) {
    for (const e of c.ents) {
      if (e.k !== 'i') continue;
      const name = clean(e.f.nu) || '?';
      if (isNew(e) && !e.del) parts.push('додано «' + name + '»');
      else if (e.orig && e.del) parts.push('видалено «' + e.orig[0] + '»');
      else if (isChanged(e)) {
        const a = toArr(e.f, e.orig.length);
        if (a[2] !== e.orig[2] && same(a.slice(0, 2).concat(a.slice(3)), e.orig.slice(0, 2).concat(e.orig.slice(3)))) parts.push('ціна «' + name + '» ' + e.orig[2] + '→' + a[2]);
        else parts.push('змінено «' + name + '»');
      }
    }
    if (orderChanged(c)) parts.push('порядок у «' + c.ua + '»');
  }
  return parts.join('; ');
}

/* ---------------- loading ---------------- */
async function loadMenu() {
  const st = $('#loadState');
  st.hidden = false; st.className = 'state'; st.textContent = 'Завантаження меню…';
  try {
    const j = await api('/api/menu');
    S = buildState(j.data, j.ver, { source: j.source, storage: j.storage, bundledChanged: j.bundledChanged, envNames: j.envNames || [] });
    if (narrow()) for (const s of SECTIONS) for (const c of S.secs[s.key]) collapsed.add(s.key + ':' + c.id);
    st.hidden = true;
    render();
  } catch (e) {
    if (e.status === 401) return;
    st.className = 'state error';
    st.innerHTML = esc(e.message) + ' <button class="btn" type="button" id="retry">Спробувати ще раз</button>';
    $('#retry').onclick = loadMenu;
  }
}

/* ---------------- rendering ---------------- */
const ICON = {
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
};
const spiceIcon = sp => sp ? `<img class="spice" src="/img/${sp === 2 ? 'Extra' : 'Spicy'}.svg" width="14" height="14" alt="${SPICE[sp]}" title="${SPICE[sp]}">` : '';
const priceParts = p => String(p == null ? '' : p).split('/').map(x => x.replace(/\D/g, ''));

function renderTabs() {
  $('#tabs').innerHTML = SECTIONS.map(s => {
    const n = changeCount(s.key);
    return `<button type="button" role="tab" data-sec="${s.key}" aria-selected="${s.key === section && !query}">${s.ua}${n ? `<span class="dot" title="Змін: ${n}">${n}</span>` : ''}</button>`;
  }).join('');
}

function rowHtml(e) {
  const f = e.f, cls = ['row'];
  if (e.del) cls.push('deleted'); else if (isNew(e)) cls.push('new'); else if (isChanged(e)) cls.push('changed');
  if (open.has(e.uid)) cls.push('open');
  const probs = e.del ? [] : problems(e);
  if (probs.length) cls.push('bad');
  const showEn = clean(f.ne) && clean(f.ne) !== clean(f.nu);
  let price;
  if (editingPrice === e.uid && !e.del) {
    price = `<div class="pedit" data-uid="${e.uid}">` + priceParts(f.p).map((x, i) =>
      (i ? '<span class="slash">/</span>' : '') + `<input class="pin" data-pi="${i}" value="${esc(x)}" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" aria-label="Ціна${i ? ' ' + (i + 1) : ''}" size="5" maxlength="7">`
    ).join('') + '<span class="cur">₴</span></div>';
  } else {
    price = `<button type="button" class="pbtn" data-act="price" ${e.del ? 'disabled' : ''} aria-label="Змінити ціну: ${esc(normPrice(f.p) || 'немає')} гривень">${esc(normPrice(f.p) || '—')}<span class="cur">₴</span></button>`;
  }
  const badge = e.del ? '<span class="badge del">видалено</span>' : isNew(e) ? '<span class="badge new">нова</span>' : isChanged(e) ? '<span class="badge chg">змінено</span>' : '';
  const side = e.del
    ? `<button type="button" class="btn small" data-act="restore">Повернути</button>`
    : `<button type="button" class="icon-btn edit" data-act="toggle" aria-expanded="${open.has(e.uid)}" aria-label="Редагувати «${esc(f.nu)}»" title="Редагувати">${ICON.edit}</button>`;
  return `<div class="${cls.join(' ')}" data-uid="${e.uid}">
    <div class="row-main">
      ${f.ph ? `<img class="th" src="/${esc(f.ph)}" alt="" loading="lazy" decoding="async">` : '<span class="th none" aria-hidden="true"></span>'}
      <div class="names" data-act="toggle">
        <div class="nm">${esc(f.nu || 'Без назви')}${spiceIcon(f.sp)} ${badge}</div>
        ${showEn ? `<div class="en">${esc(f.ne)}</div>` : ''}
        ${f.du ? `<div class="ds">${esc(f.du)}</div>` : ''}
        ${probs.length ? `<div class="prob">⚠ ${esc(probs.join(', '))}</div>` : ''}
      </div>
      <div class="price">${price}</div>
      ${side}
    </div>
    ${open.has(e.uid) && !e.del ? editorHtml(e) : ''}
  </div>`;
}

function field(e, k, label, opts) {
  opts = opts || {};
  const v = esc(e.f[k] || '');
  const ph = opts.ph ? ` placeholder="${esc(opts.ph)}"` : '';
  const inp = opts.area
    ? `<textarea data-f="${k}" rows="${opts.rows || 2}"${ph} maxlength="${opts.max || 600}">${v}</textarea>`
    : `<input data-f="${k}" value="${v}"${ph} maxlength="${opts.max || 200}" autocomplete="off">`;
  return `<label class="fld${opts.cls ? ' ' + opts.cls : ''}"><span class="lbl">${label}</span>${inp}</label>`;
}

function editorHtml(e) {
  const f = e.f, uid = e.uid;
  const long = e.sec === 'tea' || f.lu || f.le;
  const parts = priceParts(f.p);
  const cat = catOf(e), idx = cat.ents.indexOf(e);
  return `<div class="editor" data-uid="${uid}">
    <div class="grid2">
      ${field(e, 'nu', 'Назва (UA)', { ph: 'Обов’язково' })}
      ${field(e, 'ne', 'Назва (EN)', { ph: 'Якщо порожньо — як UA' })}
      ${field(e, 'du', 'Опис (UA)', { area: true })}
      ${field(e, 'de', 'Опис (EN)', { area: true })}
      ${long ? field(e, 'lu', 'Детальний опис (UA)', { area: true, rows: 3, max: 2000 }) + field(e, 'le', 'Детальний опис (EN)', { area: true, rows: 3, max: 2000 }) : ''}
      ${field(e, 'ou', 'Варіанти на вибір (UA), через кому', { ph: 'напр.: Гострі, Солоні', max: 400 })}
      ${field(e, 'oe', 'Варіанти (EN), через кому', { ph: 'e.g.: Spicy, Salted', max: 400 })}
    </div>
    <div class="ed-row">
      <div class="fld">
        <span class="lbl">Ціна, ₴</span>
        <div class="prices">
          ${parts.map((x, i) => `${i ? '<span class="slash">/</span>' : ''}<input class="pin big" data-pp="${i}" value="${esc(x)}" inputmode="numeric" pattern="[0-9]*" aria-label="Ціна ${i + 1}" maxlength="7">`).join('')}
          ${parts.length < 4 ? `<button type="button" class="btn small ghost" data-act="addprice" title="Друга ціна, напр. 150 мл / 500 мл">+ ще ціна</button>` : ''}
          ${parts.length > 1 ? `<button type="button" class="btn small ghost" data-act="rmprice">− прибрати</button>` : ''}
        </div>
      </div>
      <div class="fld">
        <span class="lbl">Гострота</span>
        <div class="seg" role="group" aria-label="Гострота">
          ${SPICE.map((t, i) => `<button type="button" data-act="spice" data-v="${i}" aria-pressed="${(f.sp | 0) === i}">${i ? spiceIcon(i) : ''}${t}</button>`).join('')}
        </div>
      </div>
    </div>
    ${groupSelect(e, cat)}
    ${f.ph ? '<p class="note">Фото змінюється тільки розробником — тут його не редагують.</p>' : ''}
    ${confirmDel === uid ? `<div class="confirm" role="alert">
        <span>Видалити «${esc(f.nu || 'нову позицію')}»?${isNew(e) ? '' : ' До збереження це можна скасувати.'}</span>
        <div class="confirm-b"><button type="button" class="btn danger" data-act="delyes">Так, видалити</button><button type="button" class="btn" data-act="delno">Ні</button></div>
      </div>` : ''}
    <div class="ed-actions">
      <div class="ed-left">
        <button type="button" class="icon-btn" data-act="up" ${idx <= 0 ? 'disabled' : ''} aria-label="Перемістити вгору" title="Вгору">${ICON.up}</button>
        <button type="button" class="icon-btn" data-act="down" ${idx >= cat.ents.length - 1 ? 'disabled' : ''} aria-label="Перемістити вниз" title="Вниз">${ICON.down}</button>
        ${isChanged(e) ? '<button type="button" class="btn small ghost" data-act="revert">Відмінити зміни позиції</button>' : ''}
      </div>
      <div class="ed-right">
        <button type="button" class="btn ghost danger-t" data-act="del">${ICON.trash}Видалити</button>
        <button type="button" class="btn primary" data-act="done">Готово</button>
      </div>
    </div>
  </div>`;
}

// wine lists: sub-headings (e.g. "France" -> "Білі 150 мл"); the item belongs to the last heading above it
function groupSelect(e, cat) {
  if (!cat.ents.some(x => x.k === 'h')) return '';
  const groups = []; let country = '';
  cat.ents.forEach((x, i) => {
    if (x.k !== 'h') return;
    const t = x.obj.ua || x.obj.h, next = cat.ents[i + 1];
    if (next && next.k === 'h') { country = t; return; }
    groups.push({ uid: x.uid, label: (country ? country + ' — ' : '') + t });
  });
  let cur = null;
  for (let i = cat.ents.indexOf(e); i >= 0; i--) if (cat.ents[i].k === 'h') { cur = cat.ents[i].uid; break; }
  return `<label class="fld"><span class="lbl">Підзаголовок у списку</span>
    <select data-group="${e.uid}">${groups.map(g => `<option value="${g.uid}"${g.uid === cur ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>`;
}
document.addEventListener('change', ev => {
  const sel = ev.target.closest && ev.target.closest('select[data-group]'); if (!sel) return;
  const e = S.byUid.get(+sel.dataset.group), cat = catOf(e);
  cat.ents.splice(cat.ents.indexOf(e), 1);
  let i = cat.ents.findIndex(x => x.uid === +sel.value) + 1;
  while (i < cat.ents.length && cat.ents[i].k === 'i') i++;
  cat.ents.splice(i, 0, e);
  render();
  const r = document.querySelector(`.row[data-uid="${e.uid}"]`);
  if (r) { r.scrollIntoView({ block: 'start' }); const s = r.querySelector('select[data-group]'); if (s) s.focus(); }
});

function headingHtml(e, cat, i) {
  const country = cat.ents[i + 1] && cat.ents[i + 1].k === 'h';
  return `<div class="subh${country ? ' country' : ''}" title="Підзаголовок (не редагується)">${esc(e.obj.ua || e.obj.h)}</div>`;
}
function addBtn(cat, at, label) {
  return `<button type="button" class="addbtn" data-act="add" data-sec="${cat.sec}" data-cat="${esc(cat.id)}" data-at="${at}">${ICON.plus}${label || 'Додати позицію'}</button>`;
}

function catHtml(cat) {
  const key = cat.sec + ':' + cat.id;
  const items = cat.ents.filter(e => e.k === 'i' && !e.del).length;
  const isColl = collapsed.has(key);
  let body = '';
  if (!isColl) {
    cat.ents.forEach((e, i) => { body += e.k === 'h' ? headingHtml(e, cat, i) : rowHtml(e); });
    // for wine lists the new item's sub-heading is chosen in its editor (see "group" select)
    body += addBtn(cat, cat.ents.length, 'Додати позицію');
  }
  return `<section class="cat${catChanged(cat) ? ' changed' : ''}" id="cat-${esc(key)}">
    <h2 class="cat-h"><button type="button" data-act="coll" data-key="${esc(key)}" aria-expanded="${!isColl}">
      <span class="cat-t">${esc(cat.ua)}</span><span class="cat-n">${items}</span>${catChanged(cat) ? '<span class="cdot" title="Є зміни"></span>' : ''}${ICON.chev}
    </button></h2>
    ${isColl ? '' : `<div class="cat-b">${body}</div>`}
  </section>`;
}

function matches(e, q) {
  if (e.k !== 'i') return false;
  const f = e.f;
  return [f.nu, f.ne, f.du, f.de, f.p, f.lu, f.le].join(' ').toLowerCase().includes(q);
}

function render() {
  if (!S) return;
  renderTabs();
  const list = $('#list'), index = $('#index');
  $('.layout').classList.toggle('searching', !!query);
  // bar / tea / wine have no photos: drop the empty thumbnail column there
  list.classList.toggle('nophotos', !query && !S.secs[section].some(c => c.ents.some(e => e.k === 'i' && e.f.ph)));
  if (query) {
    let html = '', n = 0;
    for (const s of SECTIONS) {
      let sh = '';
      for (const c of S.secs[s.key]) {
        const hits = c.ents.filter(e => matches(e, query) || open.has(e.uid));
        if (!hits.length) continue;
        n += hits.length;
        sh += `<section class="cat"><h2 class="cat-h static"><span class="cat-t">${esc(c.ua)}</span><span class="cat-n">${hits.length}</span></h2><div class="cat-b">${hits.map(rowHtml).join('')}</div></section>`;
      }
      if (sh) html += `<h2 class="sec-h">${s.ua}</h2>` + sh;
    }
    list.innerHTML = n ? html : `<div class="state">Нічого не знайдено за запитом «${esc(query)}».</div>`;
    index.innerHTML = '';
  } else {
    const cats = S.secs[section];
    list.innerHTML = noticeHtml() + `<div class="list-tools"><span>${cats.length} категорій</span>
      <span class="lt-b"><a class="btn small ghost" href="#history">Історія змін</a>
      <button type="button" class="btn small ghost" data-act="collall">${cats.every(c => collapsed.has(section + ':' + c.id)) ? 'Розгорнути всі' : 'Згорнути всі'}</button></span></div>` +
      cats.map(catHtml).join('');
    index.innerHTML = cats.map(c => `<a href="#cat-${esc(section + ':' + c.id)}" data-key="${esc(section + ':' + c.id)}">${esc(c.ua)}${catChanged(c) ? '<span class="cdot"></span>' : ''}</a>`).join('');
  }
  renderBar();
}

/* re-render a single row (keeps the rest of the page and its scroll position) */
function rerenderRow(uid, focusSel) {
  const e = S.byUid.get(uid); if (!e) return;
  const el = document.querySelector(`.row[data-uid="${uid}"]`);
  if (!el) { render(); return; }
  const t = document.createElement('div'); t.innerHTML = rowHtml(e); el.replaceWith(t.firstElementChild);
  renderTabs(); renderBar(); refreshCatMarks(e);
  if (focusSel) { const f = document.querySelector(`.row[data-uid="${uid}"] ${focusSel}`); if (f) { f.focus(); if (f.classList.contains('pin')) f.select(); } }
}
function refreshCatMarks(e) {
  const cat = catOf(e), key = cat.sec + ':' + cat.id;
  const sec = document.getElementById('cat-' + key);
  if (sec) {
    sec.classList.toggle('changed', catChanged(cat));
    const btn = sec.querySelector('.cat-h button');
    if (btn) { const d = btn.querySelector('.cdot'); if (catChanged(cat) && !d) btn.querySelector('.chev').insertAdjacentHTML('beforebegin', '<span class="cdot" title="Є зміни"></span>'); if (!catChanged(cat) && d) d.remove(); }
  }
  const a = document.querySelector(`#index a[data-key="${CSS.escape(key)}"]`);
  if (a) { const d = a.querySelector('.cdot'); if (catChanged(cat) && !d) a.insertAdjacentHTML('beforeend', '<span class="cdot"></span>'); if (!catChanged(cat) && d) d.remove(); }
}

/* ---------------- save bar ---------------- */
let saving = false, barState = null; // barState: {type:'ok'|'error'|'conflict', msg}
function renderBar() {
  const n = changeCount(), bar = $('#savebar'), msg = $('#saveMsg'), act = $('#saveActions');
  const show = n > 0 || saving || barState;
  bar.hidden = !show || view !== 'menu';
  document.body.classList.toggle('has-bar', !bar.hidden);
  if (!show) return;
  if (saving) { msg.className = 'save-msg'; msg.textContent = 'Зберігаю…'; act.innerHTML = '<button class="btn primary" disabled>Збереження…</button>'; return; }
  if (barState && n === 0) {
    msg.className = 'save-msg ' + barState.type;
    msg.innerHTML = barState.html;
    act.innerHTML = barState.type === 'conflict'
      ? '<button type="button" class="btn primary" data-act="reload">Перезавантажити меню</button>'
      : '<button type="button" class="btn" data-act="closebar">Закрити</button>';
    return;
  }
  const bad = [...S.byUid.values()].filter(e => e.k === 'i' && !e.del && (isNew(e) || isChanged(e)) && problems(e).length).length;
  msg.className = 'save-msg' + (barState && barState.type !== 'ok' ? ' ' + barState.type : '');
  msg.innerHTML = barState && barState.type !== 'ok' ? barState.html
    : bad ? `<span class="warn">Виправте позиції з позначкою ⚠ (${bad})</span>` : `Незбережених змін: <b>${n}</b>`;
  const cancelArmed = armedKey === 'cancel' && Date.now() - armedAt < 4000;
  act.innerHTML = (barState && barState.type === 'conflict')
    ? '<button type="button" class="btn" data-act="reload">Перезавантажити (зміни буде втрачено)</button>'
    : `<button type="button" class="btn ${cancelArmed ? 'danger' : 'ghost'}" data-act="cancel">${cancelArmed ? 'Так, скасувати все' : 'Скасувати'}</button>
       <button type="button" class="btn primary" data-act="save" ${bad ? 'disabled' : ''}>Зберегти зміни (${n})</button>`;
}

async function save() {
  if (saving || !changeCount()) return;
  const bad = [...S.byUid.values()].filter(e => e.k === 'i' && !e.del && (isNew(e) || isChanged(e)) && problems(e).length);
  if (bad.length) { toast('Є позиції без назви або ціни — їх позначено ⚠'); return; }
  saving = true; barState = null; renderBar();
  try {
    const data = buildData();
    const j = await api('/api/menu', { method: 'POST', body: { data, ver: S.ver, message: summary() } });
    // saved: the new file is the new baseline
    const keepSec = section;
    open.clear(); editingPrice = null; confirmDel = null;
    S = buildState(data, j.ver, Object.assign({}, S.meta, { source: 'redis' })); section = keepSec; histCache = null;
    barState = { type: 'ok', html: 'Збережено. Зміни вже на сайті. <a href="/" target="_blank" rel="noopener">Відкрити сайт</a>' };
  } catch (e) {
    if (e.code === 'conflict') barState = { type: 'conflict', html: esc(e.message) };
    else if (e.status === 401) barState = { type: 'error', html: 'Сесія завершилась — увійдіть і натисніть «Зберегти» ще раз.' };
    else barState = { type: 'error', html: 'Не збережено: ' + esc(e.message) };
  } finally { saving = false; render(); }
}

/* ---------------- events ---------------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  const rowEl = t.closest('.row'), uid = rowEl ? +rowEl.dataset.uid : null, e = uid ? S.byUid.get(uid) : null;
  switch (act) {
    case 'price': startPrice(uid); break;
    case 'toggle':
      if (!e || e.del) break;
      if (ev.target.closest('a')) break;
      if (open.has(uid)) open.delete(uid); else open.add(uid);
      // desktop: focus the name field; phone: no focus, so the keyboard does not pop up
      confirmDel = null; rerenderRow(uid, open.has(uid) ? (narrow() ? null : '[data-f="nu"]') : '.edit');
      break;
    case 'done': open.delete(uid); confirmDel = null; rerenderRow(uid, '.edit'); break;
    case 'spice': e.f.sp = +t.dataset.v; rerenderRow(uid, `[data-act="spice"][data-v="${t.dataset.v}"]`); break;
    case 'addprice': e.f.p = priceParts(e.f.p).concat(['']).join(' / '); rerenderRow(uid); { const ins = document.querySelectorAll(`.row[data-uid="${uid}"] [data-pp]`); const last = ins[ins.length - 1]; if (last) last.focus(); } break;
    case 'rmprice': e.f.p = priceParts(e.f.p).slice(0, -1).join(' / '); rerenderRow(uid); break;
    case 'revert': e.f = fromArr(e.orig); rerenderRow(uid); break;
    case 'del': confirmDel = uid; rerenderRow(uid, '[data-act="delyes"]'); break;
    case 'delno': confirmDel = null; rerenderRow(uid, '[data-act="del"]'); break;
    case 'delyes': {
      confirmDel = null; open.delete(uid);
      if (isNew(e)) { const c = catOf(e); c.ents.splice(c.ents.indexOf(e), 1); S.byUid.delete(uid); render(); }
      else { e.del = true; rerenderRow(uid); }
      toast(isNew(e) ? 'Нову позицію прибрано' : 'Позицію позначено на видалення — вона зникне після збереження');
      break;
    }
    case 'restore': e.del = false; rerenderRow(uid); break;
    case 'up': case 'down': {
      const c = catOf(e), i = c.ents.indexOf(e), j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= c.ents.length) break;
      c.ents.splice(i, 1); c.ents.splice(j, 0, e);
      render();
      const b = document.querySelector(`.row[data-uid="${uid}"] [data-act="${act}"]`);
      if (b && !b.disabled) b.focus(); else { const r = document.querySelector(`.row[data-uid="${uid}"]`); if (r) r.scrollIntoView({ block: 'nearest' }); }
      break;
    }
    case 'add': {
      const c = S.secs[t.dataset.sec].find(x => x.id === t.dataset.cat);
      const ne = { k: 'i', uid: ++uidSeq, orig: null, f: { nu: '', ne: '', p: '', du: '', de: '', sp: 0, lu: '', le: '', ph: '', ou: '', oe: '' }, del: false, sec: c.sec, cat: c.id };
      S.byUid.set(ne.uid, ne); c.ents.splice(+t.dataset.at, 0, ne); open.add(ne.uid);
      render();
      const inp = document.querySelector(`.row[data-uid="${ne.uid}"] [data-f="nu"]`);
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
      break;
    }
    case 'coll': {
      const k = t.dataset.key;
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      const c = S.secs[section].find(x => section + ':' + x.id === k);
      const sec = t.closest('.cat'); const tmp = document.createElement('div'); tmp.innerHTML = catHtml(c); sec.replaceWith(tmp.firstElementChild);
      const nb = document.querySelector(`#cat-${CSS.escape(k)} .cat-h button`); if (nb) nb.focus();
      break;
    }
    case 'collall': {
      const cats = S.secs[section], all = cats.every(c => collapsed.has(section + ':' + c.id));
      cats.forEach(c => all ? collapsed.delete(section + ':' + c.id) : collapsed.add(section + ':' + c.id));
      render(); break;
    }
    case 'save': save(); break;
    case 'cancel':
      if (armed('cancel')) { S = buildState(S.data, S.ver, S.meta); open.clear(); editingPrice = null; confirmDel = null; barState = null; render(); toast('Усі зміни скасовано'); }
      else { renderBar(); setTimeout(renderBar, 4100); }
      break;
    case 'closebar': barState = null; renderBar(); break;
    case 'reload': barState = null; S = null; open.clear(); loadMenu(); break;
  }
});

// section tabs
$('#tabs').addEventListener('click', ev => {
  const b = ev.target.closest('[data-sec]'); if (!b) return;
  section = b.dataset.sec; query = ''; $('#q').value = ''; render(); scrollTo({ top: 0 });
});
$('#tabs').addEventListener('keydown', ev => {
  if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
  const i = SECTIONS.findIndex(s => s.key === section), j = (i + (ev.key === 'ArrowRight' ? 1 : SECTIONS.length - 1)) % SECTIONS.length;
  section = SECTIONS[j].key; query = ''; $('#q').value = ''; render(); $(`#tabs [data-sec="${section}"]`).focus();
});
// desktop category index: expand + scroll
$('#index').addEventListener('click', ev => {
  const a = ev.target.closest('a'); if (!a) return; ev.preventDefault();
  const k = a.dataset.key;
  if (collapsed.has(k)) { collapsed.delete(k); render(); }
  const el = document.getElementById('cat-' + k); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

let qt = 0;
$('#q').addEventListener('input', ev => { clearTimeout(qt); qt = setTimeout(() => { query = ev.target.value.trim().toLowerCase(); render(); }, 120); });

// editor fields: update model live, refresh only the row header
document.addEventListener('input', ev => {
  const t = ev.target, ed = t.closest('.editor'); if (!ed) return;
  const e = S.byUid.get(+ed.dataset.uid); if (!e) return;
  if (t.dataset.f) e.f[t.dataset.f] = t.value;
  else if (t.dataset.pp !== undefined) {
    t.value = t.value.replace(/\D/g, '');
    e.f.p = [...ed.querySelectorAll('[data-pp]')].map(x => x.value).join(' / ');
  } else return;
  refreshRowHead(e);
});
function refreshRowHead(e) {
  const el = document.querySelector(`.row[data-uid="${e.uid}"]`); if (!el) return;
  const t = document.createElement('div'); t.innerHTML = rowHtml(Object.assign({}, e, { uid: e.uid }));
  const fresh = t.firstElementChild;
  el.className = fresh.className;
  el.querySelector('.names').innerHTML = fresh.querySelector('.names').innerHTML;
  el.querySelector('.price').innerHTML = fresh.querySelector('.price').innerHTML;
  // "revert item" button appears/disappears
  const left = el.querySelector('.ed-left'), fl = fresh.querySelector('.ed-left');
  if (left && fl && left.children.length !== fl.children.length) left.innerHTML = fl.innerHTML;
  renderTabs(); renderBar(); refreshCatMarks(e);
}

/* inline quick price edit: tap price -> type -> Enter / tap elsewhere */
function startPrice(uid) {
  if (editingPrice && editingPrice !== uid) commitPrice(true);
  editingPrice = uid;
  rerenderRow(uid, '.pin[data-pi="0"]');
}
function commitPrice(keep) {
  const uid = editingPrice; if (!uid) return;
  const e = S.byUid.get(uid), box = document.querySelector(`.pedit[data-uid="${uid}"]`);
  editingPrice = null;
  if (e && box && keep) {
    const v = [...box.querySelectorAll('.pin')].map(x => x.value.replace(/\D/g, ''));
    if (v.every(Boolean)) e.f.p = v.join(' / ');
    else toast('Ціна не може бути порожньою — залишено попередню');
  }
  rerenderRow(uid, '.pbtn');
}
document.addEventListener('keydown', ev => {
  const pin = ev.target.closest && ev.target.closest('.pedit .pin');
  if (pin) {
    if (ev.key === 'Enter') { ev.preventDefault(); commitPrice(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); commitPrice(false); }
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (view === 'menu') save(); }
  if (ev.key === 'Escape' && ev.target.closest && ev.target.closest('.editor')) {
    const uid = +ev.target.closest('.editor').dataset.uid; open.delete(uid); confirmDel = null; rerenderRow(uid, '.edit');
  }
});
document.addEventListener('input', ev => { if (ev.target.matches('.pedit .pin')) ev.target.value = ev.target.value.replace(/\D/g, ''); });
document.addEventListener('focusout', ev => {
  const box = ev.target.closest && ev.target.closest('.pedit'); if (!box) return;
  setTimeout(() => { if (editingPrice === +box.dataset.uid && !box.contains(document.activeElement)) commitPrice(true); }, 0);
});

// never lose work by accident
addEventListener('beforeunload', ev => { if (!dirtyOk && changeCount()) { ev.preventDefault(); ev.returnValue = ''; } });

/* ---------------- toast ---------------- */
let toastT = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------------- views (menu / stats) ---------------- */
function setView() {
  view = location.hash === '#stats' ? 'stats' : location.hash === '#history' ? 'history' : 'menu';
  document.querySelectorAll('.view-l').forEach(a => a.setAttribute('aria-current', a.dataset.view === (view === 'history' ? 'menu' : view) ? 'page' : 'false'));
  $('#menuView').hidden = view !== 'menu'; $('#menuTools').hidden = view !== 'menu';
  $('#statsView').hidden = view !== 'stats';
  $('#histView').hidden = view !== 'history';
  renderBar();
  if (view === 'stats' && token) loadStats();
  if (view === 'history' && token) loadHistory();
  scrollTo({ top: 0 });
}

/* ---------------- notices about storage ---------------- */
function noticeHtml() {
  if (!S || !S.meta) return '';
  if (S.meta.storage === false) {
    // diagnostics: which Redis-like variables the server sees (names only)
    const names = (S.meta.envNames || []);
    const seen = names.length ? `Сервер бачить змінні: ${names.map(esc).join(', ')}. Потрібна пара REST URL + REST TOKEN від Upstash.`
                              : 'Сервер не бачить жодної змінної бази. Найчастіше — після підключення бази не зроблено Redeploy.';
    return `<div class="notice warn">База даних (Upstash Redis) ще не підключена — зміни зберегти не вийде.<br>${seen}</div>`;
  }
  if (S.meta.bundledChanged) return `<div class="notice">Розробник оновив файл меню на сайті після ваших змін. Зараз гості бачать вашу версію. <a href="#history">Докладніше</a></div>`;
  return '';
}

/* ---------------- history / rollback ---------------- */
let histCache = null, histConfirm = null, histBusy = false;
async function loadHistory() {
  const body = $('#histBody');
  if (!histCache) body.innerHTML = '<div class="state">Завантаження…</div>';
  try { histCache = await api('/api/history'); renderHistory(); }
  catch (e) { if (e.status !== 401) body.innerHTML = `<div class="state error">${esc(e.message)}</div>`; }
}
const fmtTime = t => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function renderHistory() {
  const h = histCache, body = $('#histBody'), dirty = changeCount() > 0;
  let html = '';
  if (!h.storage) html += `<div class="notice warn">База даних (Upstash Redis) ще не підключена — історія з’явиться після підключення і першого збереження.</div>`;
  if (dirty) html += `<div class="notice warn">У вас є незбережені зміни в меню. Спершу збережіть або скасуйте їх, щоб повертати версії.</div>`;
  if (h.bundledChanged) html += `<div class="card"><h2>Файл меню від розробника</h2>
    <p class="muted">Після вашого останнього збереження розробник оновив файл меню на сайті (наприклад, додав фото чи страви). Гості зараз бачать вашу версію з бази. Можна замінити її версією розробника — поточна збережеться в історії, і її можна буде повернути.</p>
    ${confirmBlock('bundled', 'Замінити меню версією з файлу сайту?', 'Так, замінити', dirty)}</div>`;
  html += `<div class="card"><h2>Поточна версія</h2><p class="muted">Версія ${h.ver}${h.source === 'bundled' ? ' — меню з файлу сайту (ще нічого не зберігали через адмінку)' : ''}.</p></div>`;
  html += `<div class="card"><h2>Попередні версії</h2>`;
  if (!h.items.length) html += '<p class="muted">Поки що порожньо. Після кожного збереження сюди потрапляє попередній стан меню (останні 20).</p>';
  else html += '<ul class="hist">' + h.items.map(it => `<li>
      <div class="hist-m"><b>Стан до ${esc(fmtTime(it.t))}</b><span class="muted">версія ${it.v}</span></div>
      <div class="hist-s">Після нього: ${esc(it.s || '—')}</div>
      ${confirmBlock(it.i, 'Повернути меню до стану до ' + fmtTime(it.t) + '? Поточна версія збережеться в історії.', 'Так, повернути', dirty, 'Повернути цю версію')}
    </li>`).join('') + '</ul>';
  html += '</div>';
  html += `<div class="card"><h2>Для розробника</h2><p class="muted">Поточне меню у форматі js/data.js — щоб перенести зміни у файл сайту.</p>
    <button type="button" class="btn small" data-hact="download">Скачати data.js</button></div>`;
  body.innerHTML = html;
}
function confirmBlock(key, question, yes, disabled, label) {
  if (histConfirm === key) return `<div class="confirm" role="alert"><span>${esc(question)}</span>
    <div class="confirm-b"><button type="button" class="btn danger" data-hact="yes" data-k="${key}" ${histBusy ? 'disabled' : ''}>${histBusy ? 'Зачекайте…' : yes}</button><button type="button" class="btn" data-hact="no">Ні</button></div></div>`;
  return `<button type="button" class="btn small" data-hact="ask" data-k="${key}" ${disabled || !histCache.storage ? 'disabled' : ''}>${label || 'Замінити версією розробника'}</button>`;
}
$('#histBody').addEventListener('click', async ev => {
  const b = ev.target.closest('[data-hact]'); if (!b) return;
  const act = b.dataset.hact, k = b.dataset.k;
  if (act === 'ask') { histConfirm = k === 'bundled' ? 'bundled' : +k; renderHistory(); return; }
  if (act === 'no') { histConfirm = null; renderHistory(); return; }
  if (act === 'download') { downloadData(); return; }
  if (act === 'yes' && !histBusy) {
    histBusy = true; renderHistory();
    try {
      const body = k === 'bundled' ? { source: 'bundled', ver: histCache.ver } : { index: +k, ver: histCache.ver };
      await api('/api/rollback', { method: 'POST', body });
      toast('Версію повернуто. Зміни вже на сайті.');
      histConfirm = null; S = null; open.clear(); barState = null;
      await loadMenu(); await loadHistory();
    } catch (e) {
      toast(e.message);
      if (e.code === 'conflict') { histConfirm = null; await loadHistory(); }
    } finally { histBusy = false; if (histCache) renderHistory(); }
  }
});
function downloadData() {
  if (!S) return;
  const text = '// Menu data exported from the admin panel ' + new Date().toISOString().slice(0, 10) + '\nwindow.AZUMA_DATA = ' + JSON.stringify(S.data, null, 1) + ';\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  a.download = 'data.js'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
addEventListener('hashchange', setView);

/* ---------------- statistics ---------------- */
let statDays = 30, statTop = 'period', lastStats = null;
$('#period').addEventListener('click', ev => {
  const b = ev.target.closest('[data-days]'); if (!b) return;
  statDays = +b.dataset.days;
  document.querySelectorAll('#period button').forEach(x => x.setAttribute('aria-pressed', x === b));
  loadStats();
});
async function loadStats() {
  const body = $('#statsBody');
  if (!lastStats) body.innerHTML = '<div class="state">Завантаження…</div>';
  try {
    const j = await api('/api/stats?days=' + statDays);
    lastStats = j; renderStats();
  } catch (e) {
    if (e.status === 401) return;
    body.innerHTML = `<div class="state error">${esc(e.message)}</div>`;
  }
}
const fmtDay = d => d.slice(8, 10) + '.' + d.slice(5, 7);
const num = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function catName(s, c) {
  if (!S || !S.secs[s]) return '';
  const x = S.secs[s].find(k => k.id === c); return x ? x.ua : '';
}
function renderStats() {
  const j = lastStats, body = $('#statsBody');
  if (!j.configured) {
    body.innerHTML = `<div class="empty-card"><h2>Статистика ще не підключена — див. інструкцію</h2>
      <p>Потрібно підключити безкоштовну базу Upstash Redis у Vercel: <b>Storage → Upstash (Redis) → Connect to project</b>. Після підключення змінні середовища з’являться автоматично; зробіть Redeploy — і відвідування почнуть рахуватися.</p></div>`;
    return;
  }
  const t = j.totals, days = j.series.length;
  const any = t.visits || t.dishOpens || Object.values(t.sections).some(Boolean);
  const avg = days ? Math.round(t.visits / days * 10) / 10 : 0;
  let html = `<div class="tiles">
    <div class="tile"><div class="tile-l">Відвідування</div><div class="tile-v">${num(t.visits)}</div><div class="tile-s">за ${days} днів</div></div>
    <div class="tile"><div class="tile-l">У середньому за день</div><div class="tile-v">${String(avg).replace('.', ',')}</div><div class="tile-s">відвідувань</div></div>
    <div class="tile"><div class="tile-l">Відкрито страв</div><div class="tile-v">${num(t.dishOpens)}</div><div class="tile-s">переглядів карток</div></div>
  </div>`;
  if (!any) html += '<div class="state">Поки що немає даних за цей період. Дані з’являться, коли гості відкриють сайт.</div>';
  html += `<section class="card"><h2>Відвідування по днях</h2>${chart(j.series)}
    <details class="tbl-d"><summary>Показати таблицею</summary><table class="tbl"><thead><tr><th>Дата</th><th class="r">Відвідування</th></tr></thead><tbody>
    ${j.series.slice().reverse().map(r => `<tr><td>${fmtDay(r.day)}.${r.day.slice(0, 4)}</td><td class="r">${num(r.visits)}</td></tr>`).join('')}</tbody></table></details></section>`;
  const secs = ['menu', 'bar', 'tea', 'wine', 'home'], smax = Math.max(1, ...secs.map(s => t.sections[s]));
  html += `<section class="card"><h2>Відкриття розділів</h2><div class="hbars">${secs.map(s => `
      <div class="hbar"><span class="hbar-l">${SEC_UA[s]}</span><span class="hbar-t"><span class="hbar-f" data-w="${(t.sections[s] / smax * 100).toFixed(1)}"></span></span><span class="hbar-v">${num(t.sections[s])}</span></div>`).join('')}
    </div></section>`;
  const list = statTop === 'all' ? j.topDishesAllTime : j.topDishes;
  html += `<section class="card"><div class="card-h"><h2>Популярні страви</h2>
      <div class="seg small" role="group" aria-label="Період для страв">
        <button type="button" data-top="period" aria-pressed="${statTop === 'period'}">За ${days} днів</button>
        <button type="button" data-top="all" aria-pressed="${statTop === 'all'}">За весь час</button></div></div>
    ${list.length ? `<table class="tbl dishes"><thead><tr><th class="n">#</th><th>Страва</th><th class="sec">Розділ</th><th class="r">Відкриттів</th></tr></thead><tbody>
      ${list.map((d, i) => `<tr><td class="n">${i + 1}</td><td>${esc(d.n)}<span class="sub">${esc(SEC_UA[d.s] || d.s)}${catName(d.s, d.c) ? ' · ' + esc(catName(d.s, d.c)) : ''}</span></td><td class="sec">${esc(SEC_UA[d.s] || d.s)}${catName(d.s, d.c) ? '<span class="sub2">' + esc(catName(d.s, d.c)) + '</span>' : ''}</td><td class="r">${num(d.count)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Ще ніхто не відкривав картки страв.</p>'}
  </section>`;
  body.innerHTML = html;
  // widths set through CSSOM: the CSP forbids inline style attributes
  body.querySelectorAll('.hbar-f[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
}
$('#statsBody').addEventListener('click', ev => {
  const b = ev.target.closest('[data-top]'); if (!b) return;
  statTop = b.dataset.top; renderStats();
});

// visits per day: single-series bar chart, inline SVG
function chart(series) {
  // drawn at the real pixel width of the card so axis labels stay 12px on a phone
  const W = Math.max(280, Math.round(($('#statsBody').clientWidth || 720) - 30)), H = W < 500 ? 180 : 220;
  const n = series.length, pl = 34, pr = 8, pt = 14, pb = 26;
  const max = Math.max(1, ...series.map(r => r.visits));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.max(4, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(k => k * mag).find(v => v >= max));
  const bw = (W - pl - pr) / n, gap = Math.min(4, bw * 0.25);
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  let g = '';
  [0, 0.5, 1].forEach(k => { const v = Math.round(top * k), yy = y(v);
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="ax" x="${pl - 6}" y="${yy + 4}" text-anchor="end">${v}</text>`; });
  const every = n <= 7 ? 1 : n <= 31 ? 7 : (W < 500 ? 21 : 14);
  series.forEach((r, i) => {
    const x = pl + i * bw + gap / 2, w = Math.max(1, bw - gap), yy = y(r.visits), h = H - pb - yy;
    const rad = Math.min(4, w / 2, h);
    if (r.visits > 0) g += `<path class="bar" d="M${x},${H - pb}V${yy + rad}q0,-${rad} ${rad},-${rad}h${w - 2 * rad}q${rad},0 ${rad},${rad}V${H - pb}Z"/>`;
    g += `<rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-i="${i}"><title>${fmtDay(r.day)}: ${r.visits} відвідувань</title></rect>`;
    if ((n - 1 - i) % every === 0) {
      const last = i === n - 1 && n > 7; // keep the last date inside the card
      g += `<text class="ax" x="${last ? pl + (i + 1) * bw : pl + i * bw + bw / 2}" y="${H - 8}" text-anchor="${last ? 'end' : 'middle'}">${fmtDay(r.day)}</text>`;
    }
  });
  g += `<line class="base" x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Відвідування по днях">${g}</svg><div class="tip" hidden></div></div>`;
}
// hover / tap tooltip on chart bars
$('#statsBody').addEventListener('pointerover', ev => {
  const r = ev.target.closest('.hit'); const box = ev.target.closest('.chart'); if (!box) return;
  const tip = box.querySelector('.tip');
  box.querySelectorAll('.hit.on').forEach(x => x.classList.remove('on'));
  if (!r) { tip.hidden = true; return; }
  r.classList.add('on');
  const d = lastStats.series[+r.dataset.i];
  tip.innerHTML = `<b>${num(d.visits)}</b> відвідувань<br><span>${fmtDay(d.day)}.${d.day.slice(0, 4)}</span>`;
  tip.hidden = false;
  const bb = r.getBoundingClientRect(), cb = box.getBoundingClientRect();
  const x = Math.min(Math.max(bb.left - cb.left + bb.width / 2, 50), cb.width - 50);
  tip.style.left = x + 'px';
});
$('#statsBody').addEventListener('pointerleave', () => { document.querySelectorAll('.chart .tip').forEach(t => { t.hidden = true; }); }, true);

let rsT = 0, lastW = innerWidth;
addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (innerWidth !== lastW && view === 'stats' && lastStats) { lastW = innerWidth; renderStats(); } }, 150); });

/* ---------------- boot ---------------- */
if (token) { $('#app').hidden = false; loadMenu(); } else showLogin();
setView();
})();
