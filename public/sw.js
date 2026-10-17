// Service worker: guarda a "casca" do app para abrir sem internet.
// Os dados (Supabase) não passam por aqui: ficam no localStorage via lib/offline.js.

const CACHE = 'meu-plano-v1'
const BASICO = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-icon.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

// A página manda a lista de arquivos que já carregou (JS/CSS do Next) para guardar.
self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'cachear') {
    e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls.map((u) => c.add(u).catch(() => {})))))
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Página: tenta a rede (versão nova) e cai no cache sem internet.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copia))
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Arquivos do build e ícones: cache primeiro (os nomes do Next mudam a cada deploy).
  if (url.pathname.startsWith('/_next/static/') || BASICO.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then((achado) => achado || fetch(req).then((res) => {
        if (res.ok) {
          const copia = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copia))
        }
        return res
      }))
    )
  }
})
