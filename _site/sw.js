/* ============================================================
   sw.js — versioned cache-first app shell (SPEC §11).
   Update strategy: bump CACHE on every deploy — install caches the
   new shell, activate throws the old cache away, skipWaiting +
   clients.claim switch running clients over immediately.
   No runtime caching of anything else (there is nothing else:
   cross-origin requests like Google Analytics pass straight through).
   ============================================================ */

const CACHE = "30dod-v1.0.0";

/* NOTE: "/" (not "/index.html") — the .htaccess clean-URL rule 301s
   /index.html to /, and a cached redirected response is rejected by
   Chrome when replayed for a navigation. "/" returns a direct 200. */
const SHELL = [
	"/",
	"/styles.css",
	"/app.js",
	"/model.js",
	"/storage.js",
	"/sound.js",
	"/fx.js",
	"/manifest.webmanifest",
	"/fonts/rajdhani-v17-latin-500.woff2",
	"/fonts/rajdhani-v17-latin-600.woff2",
	"/fonts/rajdhani-v17-latin-700.woff2",
	"/fonts/chakra-petch-v13-latin-regular.woff2",
	"/fonts/chakra-petch-v13-latin-500.woff2",
	"/fonts/chakra-petch-v13-latin-600.woff2",
	"/icons/icon.svg",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/icon-maskable-192.png",
	"/icons/icon-maskable-512.png",
	"/icons/apple-touch-icon.png",
	"/favicon.ico",
	"/assets/img/qr-kiande.svg",
];

self.addEventListener("install", event => {
	event.waitUntil(
		caches.open(CACHE)
			/* cache:"reload" bypasses the HTTP cache — otherwise a deploy could
			   lock day-old app.js/styles.css (1-day TTL) into the new cache */
			.then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: "reload" }))))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener("activate", event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

// VERIFY: offline — airplane mode after first load, app fully works, fonts render
self.addEventListener("fetch", event => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return; /* GA etc. go straight to the network */

	/* any navigation lands on the shell (single page, offline included) */
	if (request.mode === "navigate"){
		event.respondWith(
			caches.match("/").then(hit => hit || fetch(request))
		);
		return;
	}

	event.respondWith(
		caches.match(request, { ignoreSearch: true }).then(hit => hit || fetch(request))
	);
});
