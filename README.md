# PROTOCOL (30 Days of Dahl) — kiande.com

A single-user, forever-running daily discipline tracker styled after the
**Deus Ex: Human Revolution** UI. Installable PWA, fully offline after first
load, all data in localStorage on the device. Based on *30 Days of
Discipline* by Victor Pride. Full build specification in [SPEC.md](SPEC.md)
(the spec still governs the tier/streak/protocol math; navigation and
presentation evolved past it: swipeable tabs, offcanvas System menu,
bottom-sheet Loadout, mp3 soundboard — see [SOUNDS.md](SOUNDS.md) — and a
desktop view that is only a deploy-to-phone landing page).

GitHub: https://github.com/dahlskebank/30days

## How this project differs from the dfault boilerplate

This is **not** an Eleventy project. The spec demands vanilla HTML/CSS/JS
with **no framework, no build step, no dependencies** — so there is no
`src/`, no `package.json`, and nothing to build.

`_site/` is kept as the web-root folder name purely so the Laragon vhost
and deploy flow match every other project — but here it is **hand-authored
source, committed to git**, not generated output. Edit files in `_site/`
directly; refresh the browser; that's the whole pipeline.

```
kiande.com/
├── SPEC.md                  the build specification (source of truth)
├── README.md                this file
└── _site/                   ← web root (Laragon vhost + deploy target)
    ├── index.html           the entire app shell — all five views live here
    ├── styles.css           all styling (design tokens at the top)
    ├── app.js               entry point: init, view switching, rendering
    ├── storage.js           ALL persistence (localStorage + migrations)
    ├── model.js             date math, tiers, streak, protocol derivation
    ├── sound.js             Web Audio synth blips (no audio assets)
    ├── fx.js                boot sequence, decode text, parallax
    ├── sw.js                service worker (cache-first app shell)
    ├── manifest.webmanifest PWA manifest (app name: Protocol)
    ├── assets/fonts/        self-hosted Rajdhani + Chakra Petch (woff2)
    ├── assets/icons/        PWA icons, apple-touch-icon (favicon.ico at root)
    │                        (NOT /icons/ — that URL is shadowed by Apache's
    │                        built-in autoindex icon alias on shared hosting)
    ├── assets/sounds/       check-off soundboard mp3s (see SOUNDS.md)
    ├── assets/img/          og-image, QR code for the desktop landing
    ├── .htaccess            Apache hardening (Tier 1 static site)
    ├── 404.html / 403.html  error pages
    └── robots.txt, sitemap.xml, humans.txt, .well-known/security.txt
```

## Local development (Laragon)

- Vhost: `E:\vlaragon\etc\apache2\sites-enabled\kiande.conf`
  → doc root `E:/www/dev/kiande.com/_site`
- Hosts entry: `127.0.0.1  kiande.com`
- HTTPS uses a dedicated cert (`E:\vlaragon\etc\ssl\kiande.crt` — the shared
  laragon.crt has no kiande.com SAN, which silently blocks the service
  worker). Trust it once from an **admin** prompt:
  `certutil -addstore Root E:\vlaragon\etc\ssl\kiande.crt`
- Browse to **https://kiande.com**. The service worker also runs on
  plain `http://localhost` for quick testing.
- After changing `sw.js`-cached files, bump the `CACHE` version constant in
  `sw.js` so the service worker picks up the new shell.

## Google Analytics

The GA4 snippet in `index.html` is gated behind a `gaId` constant near the
top of the inline script. It ships **empty** (analytics disabled). Create a
GA4 property for kiande.com and paste the `G-XXXXXXXXXX` id there to enable.

## Updating the deployed app

The service worker uses a versioned cache-first strategy: bump `CACHE` in
`sw.js` with every deploy or returning phones will keep the old shell.

## Version

App version lives in one place: the `APP_VERSION` constant in `app.js`
(shown in the System view and the desktop footer).

## License

WTFPL — see the license text at http://www.wtfpl.net/
