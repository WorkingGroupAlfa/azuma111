/* AZUMA menu: registers the service worker (sw.js) for offline use.
 * - only over http(s) (skipped on file://) and only if supported;
 * - after `load`, so it never competes with the first paint;
 * - no forced reload when a new SW takes over: updates appear on the next visit.
 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;

  // Collect dish photo URLs from the menu data (img/menu/*.webp).
  function photoUrls() {
    try {
      var m = JSON.stringify(window.AZUMA_DATA || {}).match(/img\/menu\/[^"\\]+\.webp/g) || [];
      return m.filter(function (u, i) { return m.indexOf(u) === i; });
    } catch (e) { return []; }
  }

  // Pre-cache all dish photos in the background (~2.5 MB) so that sheets open
  // with photos even offline. Skipped when the guest asked to save data or is
  // on 2G: then photos are cached only as they are opened.
  function warmPhotos(reg) {
    var c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
    var send = function () {
      var sw = reg.active;
      if (sw) sw.postMessage({ type: 'warm', urls: photoUrls() });
    };
    // Give the page some idle time first.
    var later = window.requestIdleCallback || function (f) { setTimeout(f, 3000); };
    later(send, { timeout: 8000 });
  }

  window.addEventListener('load', function () {
    // updateViaCache:'none' = browser always checks sw.js itself on the server.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(function () { return navigator.serviceWorker.ready; })
      .then(warmPhotos)
      .catch(function () { /* no SW = site still works online */ });
  });
})();
