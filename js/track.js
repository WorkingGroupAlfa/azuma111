/* Anonymous usage counters for the owner's admin statistics.
   No cookies, no identifiers, no personal data: only "a visit happened", "section X opened",
   "dish Y opened", counted per day on the server (/api/track). Independent of app.js. */
(function () {
  'use strict';
  if (location.protocol === 'file:' || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  var URL_ = '/api/track', SECTIONS = ['menu', 'bar', 'tea', 'wine'];

  function send(o) {
    var body = JSON.stringify(o);
    try {
      // text/plain keeps sendBeacon a "simple" request (no preflight)
      if (navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(URL_, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); } catch (e) { /* ignore */ }
  }
  function sectionNow() { var h = location.hash.slice(1); return SECTIONS.indexOf(h) >= 0 ? h : 'home'; }

  // one visit per browser session
  try {
    if (!sessionStorage.getItem('azuma-v')) { sessionStorage.setItem('azuma-v', '1'); send({ t: 'visit' }); }
  } catch (e) { send({ t: 'visit' }); }

  var last = null;
  function onRoute() { var s = sectionNow(); if (s === last) return; last = s; send({ t: 'section', s: s }); }
  onRoute();
  addEventListener('hashchange', onRoute);

  // dish sheet opens: the list renders <button class="item" data-c="<category id>" data-i="<index>">
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.item[data-c]');
    if (!b) return;
    var s = sectionNow(), D = window.AZUMA_DATA;
    if (s === 'home' || !D || !D[s]) return;
    var cat = null;
    for (var i = 0; i < D[s].length; i++) if (String(D[s][i].id) === b.getAttribute('data-c')) { cat = D[s][i]; break; }
    var it = cat && cat.items[+b.getAttribute('data-i')];
    if (!Array.isArray(it) || !it[0]) return;
    send({ t: 'dish', s: s, c: String(cat.id), n: String(it[0]).slice(0, 120) });
  }, true);
})();
