/* GDC CRM service worker — handles Web Push delivery & click-through. */
/* eslint-disable no-undef */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'GDC CRM', body: event.data && event.data.text() } }
  const title = data.title || 'GDC CRM'
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.type || 'gdc',
    data: { link: data.link || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) { c.focus(); if ('navigate' in c && link) c.navigate(link); return }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    })
  )
})
