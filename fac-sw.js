// AL MUTAGADED factory app — the phone's helper (service worker), 20 Oct 2026 (Abbas: "do all").
// Scope = factory.html only (memo.html and every other page are never touched by it).
// 1. OPENS INSTANTLY: the app page is kept on the phone and shown at once, even on a weak line; the newest page is fetched in the background.
//    A link with ?v=<version> (the app's own "new version" reload) always takes the network first, so updates still arrive at once.
// 2. NOTIFICATIONS without the ntfy app: the relay sends a Web Push (through the fast-lane worker); this shows it, and a tap opens that chat.
// It never touches the relay, the fast lane, Trello or Slack requests: those go to the network exactly as before.
'use strict';
const SHELL = 'fac-shell-1', PAGE = new URL('factory.html', self.registration.scope).href.split('?')[0];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.add(new Request(PAGE, { cache: 'no-store' }))).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => /^fac-shell-/.test(k) && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

async function fresh(c) { const r = await fetch(PAGE, { cache: 'no-store' }); if (r && r.ok) await c.put(PAGE, r.clone()); return r; }
self.addEventListener('fetch', e => {
  const rq = e.request; if (rq.method !== 'GET' || rq.mode !== 'navigate' || rq.url.split(/[?#]/)[0] !== PAGE) return;   // only the app page itself
  e.respondWith((async () => {
    const c = await caches.open(SHELL), have = await c.match(PAGE);
    if (/[?&]v=/.test(rq.url) || !have) { try { return await Promise.race([fresh(c), new Promise((_, no) => setTimeout(() => no(new Error('slow')), have ? 4000 : 60000))]); } catch (x) { if (have) return have; throw x; } }
    e.waitUntil(fresh(c).catch(() => {}));      // shown from the phone at once; the newest copy is saved for next time
    return have;
  })());
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'AL MUTAGADED', { body: d.body || 'New message · নতুন মেসেজ', tag: d.tag || 'fac', renotify: true,
    icon: 'fac-icon-180.png', badge: 'fac-icon-180.png', data: { url: d.url || PAGE } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data || {}).url || PAGE, card = (url.match(/#card=([\w.]+)/) || [])[1] || '';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = cs.filter(c => c.url.split(/[?#]/)[0] === PAGE)[0];
    if (w) { await w.focus(); if (card) w.postMessage({ open: card }); return; }
    await self.clients.openWindow(url);
  })());
});
