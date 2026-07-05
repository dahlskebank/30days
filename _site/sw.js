/* ============================================================
   sw.js — versioned cache-first app shell (SPEC §11).
   Update strategy: bump CACHE on every deploy — install caches the
   new shell, activate throws the old cache away, skipWaiting +
   clients.claim switch running clients over immediately.
   No runtime caching of anything else (there is nothing else:
   cross-origin requests like Google Analytics pass straight through).
   ============================================================ */

const CACHE = "30dod-v1.2.2";

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

/* Soundboard (~700 KB) is cached best-effort in a second pass: a single
   dropped audio fetch on flaky mobile must not fail the atomic core-shell
   install and leave the app with no offline capability at all. */
const SOUNDS = [
	"/sounds/check_dude_hehhehheh.mp3",
	"/sounds/check_dude_idefinitelyneed.mp3",
	"/sounds/check_dude_ididntexpectthat.mp3",
	"/sounds/check_dude_igottafindmore.mp3",
	"/sounds/check_dude_map_found3.mp3",
	"/sounds/check_dude_thatmustbetheone.mp3",
	"/sounds/check_dude_yess.mp3",
	"/sounds/uncheck_dk_FX108_chicken.mp3",
	"/sounds/uncheck_dk_FX109_chicken.mp3",
	"/sounds/uncheck_dk_FX194_bwaff.mp3",
	"/sounds/uncheck_dk_FX242_femscream.mp3",
	"/sounds/uncheck_dk_FX243_femscream.mp3",
	"/sounds/uncheck_dk_FX244_femscream.mp3",
	"/sounds/uncheck_dk_FX250_femscream.mp3",
	"/sounds/uncheck_dude_thatcantbegood.wav",
	"/sounds/uncheck_dude_thatsclearly.mp3",
	"/sounds/section_dude_aahthatsthestuff.mp3",
	"/sounds/allcore_serious-sam-extra-life.mp3",
	"/sounds/allbonus_dude_ifeelbetter.mp3",
	"/sounds/allpassive_check_dude_nowtheflowers.mp3",
	"/sounds/initiate_dk_FX93_pants.mp3",
	"/sounds/sound_toggle_FX154.mp3",
	"/sounds/wipe_oh-good-bale.mp3",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			/* cache:"reload" bypasses the HTTP cache — otherwise a deploy could
			   lock day-old app.js/styles.css (1-day TTL) into the new cache */
			.then(async (cache) => {
				await cache
					.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))
					.catch(async (err) => {
						/* addAll is atomic and its error never names the culprit —
						   probe each shell URL so the console says WHICH file 404s
						   (e.g. a partial deploy that skipped a folder) */
						const missing = [];
						for (const url of SHELL) {
							try {
								const r = await fetch(url, { cache: "reload" });
								if (!r.ok) missing.push(url + " → " + r.status);
							} catch (probeErr) {
								missing.push(url + " → network error");
							}
						}
						console.error(
							"[sw] install failed — missing shell files:",
							missing,
						);
						throw err;
					});
				await Promise.allSettled(
					SOUNDS.map((url) =>
						cache.add(new Request(url, { cache: "reload" })).catch(() => {
							/* best effort */
						}),
					),
				);
			})
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

// VERIFY: offline — airplane mode after first load, app fully works, fonts render
self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin)
		return; /* GA etc. go straight to the network */

	/* any navigation lands on the shell (single page, offline included) */
	if (request.mode === "navigate") {
		event.respondWith(caches.match("/").then((hit) => hit || fetch(request)));
		return;
	}

	event.respondWith(
		caches
			.match(request, { ignoreSearch: true })
			.then((hit) => hit || fetch(request)),
	);
});
