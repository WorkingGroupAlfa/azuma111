'use strict';
// Strict validation of menu data sent by the admin, checked against the file currently in the repo.
// The admin may edit item fields, add/delete/reorder items. It may NOT change sections, categories,
// wine headings or photos — those must match the current file exactly.

const SECTIONS = ['menu', 'bar', 'tea', 'wine'];
const PRICE_RE = /^\d{1,7}( \/ \d{1,7}){0,4}$/;
const BAD_CHARS = /[<>\u0000-\u001f\u007f]/;
const LIMITS = { name: 200, desc: 600, long: 2000, opt: 60, opts: 12, items: 300, total: 3000 };

function check(ok, msg) { if (!ok) throw new Error(msg); }
function str(v, max, where, required) {
  check(typeof v === 'string', where + ': має бути текст');
  check(v.length <= max, where + ': занадто довгий текст (макс. ' + max + ')');
  check(!BAD_CHARS.test(v), where + ': недопустимі символи (< > або керуючі)');
  if (required) check(v.trim().length > 0, where + ': не може бути порожнім');
  check(v === v.trim(), where + ': зайві пробіли на початку/в кінці');
}
const isHeading = x => x && typeof x === 'object' && !Array.isArray(x);

function validateItem(it, where, photos) {
  check(Array.isArray(it), where + ': позиція має бути масивом');
  check(it.length >= 6 && it.length <= 10, where + ': неправильна кількість полів');
  str(it[0], LIMITS.name, where + ' (назва UA)', true);
  str(it[1], LIMITS.name, where + ' (назва EN)', true);
  check(typeof it[2] === 'string' && PRICE_RE.test(it[2]), where + ': ціна має бути числом або «число / число»');
  str(it[3], LIMITS.desc, where + ' (опис UA)');
  str(it[4], LIMITS.desc, where + ' (опис EN)');
  check(it[5] === 0 || it[5] === 1 || it[5] === 2, where + ': гострота має бути 0, 1 або 2');
  if (it.length > 6) str(it[6], LIMITS.long, where + ' (довгий опис UA)');
  if (it.length > 7) str(it[7], LIMITS.long, where + ' (довгий опис EN)');
  if (it.length > 8) {
    check(typeof it[8] === 'string', where + ': фото');
    if (it[8]) {
      // photos cannot be added or changed from the admin: only paths already in the file are allowed
      const n = photos.get(it[8]) || 0;
      check(n > 0, where + ': фото не можна змінювати через адмінку');
      photos.set(it[8], n - 1);
    }
  }
  if (it.length > 9) {
    const o = it[9];
    check(Array.isArray(o) && o.length === 2 && Array.isArray(o[0]) && Array.isArray(o[1]), where + ': варіанти мають неправильний формат');
    check(o[0].length >= 1 && o[0].length <= LIMITS.opts && o[0].length === o[1].length, where + ': кількість варіантів UA та EN має збігатися');
    o.forEach((l, li) => l.forEach((x, i) => str(x, LIMITS.opt, where + ' (варіант ' + (li ? 'EN' : 'UA') + ' ' + (i + 1) + ')', true)));
  }
}

function validate(next, current) {
  check(next && typeof next === 'object' && !Array.isArray(next), 'Дані меню мають неправильний формат');
  const keys = Object.keys(next), curKeys = Object.keys(current);
  check(JSON.stringify(keys) === JSON.stringify(curKeys), 'Розділи меню не можна змінювати');
  const photos = new Map();
  for (const k of curKeys) for (const c of current[k]) for (const it of c.items)
    if (Array.isArray(it) && it[8]) photos.set(it[8], (photos.get(it[8]) || 0) + 1);
  let total = 0;
  for (const k of keys) {
    check(Array.isArray(next[k]) && next[k].length === current[k].length, 'Категорії «' + k + '» не можна змінювати');
    next[k].forEach((cat, ci) => {
      const cc = current[k][ci];
      check(cat && typeof cat === 'object' && JSON.stringify(Object.keys(cat)) === JSON.stringify(Object.keys(cc)), 'Неправильна категорія у «' + k + '»');
      for (const f of Object.keys(cc)) if (f !== 'items') check(cat[f] === cc[f], 'Категорії не можна перейменовувати чи переставляти');
      check(Array.isArray(cat.items) && cat.items.length <= LIMITS.items, 'Забагато позицій у категорії ' + cc.ua);
      const heads = cat.items.filter(isHeading), curHeads = cc.items.filter(isHeading);
      check(JSON.stringify(heads) === JSON.stringify(curHeads), 'Підзаголовки у «' + cc.ua + '» не можна змінювати');
      cat.items.forEach((it, i) => {
        if (isHeading(it)) return;
        total++;
        validateItem(it, cc.ua + ' #' + (i + 1), photos);
      });
    });
  }
  check(total <= LIMITS.total, 'Забагато позицій');
}

module.exports = { validate, SECTIONS, PRICE_RE };
