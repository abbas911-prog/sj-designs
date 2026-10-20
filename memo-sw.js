// SJ Stock — the phone's helper (service worker), 21 Oct 2026. Scope = memo.html ONLY (the factory app and every other page are never touched).
// The app page is kept on the phone and shown at once, even on a weak line; the newest copy is checked in the background with ETag, so nothing
// is downloaded when the page did not change. A link with ?v=<version> (the app's own "new version" reload) always takes the network first.
// Relay, Trello, Slack, photos, the stock list: untouched — they go to the network exactly as before.
'use strict';
const SHELL = 'memo-shell-1', PAGE = new URL('memo.html', self.registration.scope).href.split('?')[0];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.add(new Request(PAGE, { cache: 'no-store' }))).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => /^memo-shell-/.test(k) && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function fresh(c, have) {
  const et = have && have.headers.get('ETag'), r = await fetch(PAGE, { cache: 'no-store', headers: et ? { 'If-None-Match': et } : {} });
  if (r.status === 304 && have) return have; if (r && r.ok) await c.put(PAGE, r.clone()); return r; }
self.addEventListener('fetch', e => {
  const rq = e.request; if (rq.method !== 'GET' || rq.mode !== 'navigate' || rq.url.split(/[?#]/)[0] !== PAGE) return;   // only the app page itself
  e.respondWith((async () => {
    const c = await caches.open(SHELL), have = await c.match(PAGE);
    if (/[?&]v=/.test(rq.url) || !have) { try { return await Promise.race([fresh(c, have), new Promise((_, no) => setTimeout(() => no(new Error('slow')), have ? 4000 : 60000))]); } catch (x) { if (have) return have; throw x; } }
    e.waitUntil(fresh(c, have).catch(() => {}));      // shown from the phone at once; the newest copy is saved for next time
    return have;
  })());
});
