# Shopify Navigator (PWA)

AI‑powered navigation maps for the Shopify Admin UI — **plus** an AI assistant that
helps you add a new product to your store. Type what you want to do, get exact
click‑by‑click directions. Available in **10 languages**.

## What's in this folder
- `index.html` — the whole app (vanilla JS, no build step)
- `manifest.webmanifest` — PWA config
- `sw.js` — service worker (offline + installable)
- `icon-*.png`, `apple-touch-icon.png`, `favicon.png` — app icons
- `server/` — optional self-hosted server (zero-dependency Node ≥18): serves the app,
  proxies Claude with a **server-held API key** (end users need no key), and runs
  **real background store scans** every 10 minutes even when the app is closed
- `deploy/` — Docker + Caddy (auto-HTTPS) stack + `setup.sh` for a fresh Ubuntu VPS
- `android/` + `.well-known/assetlinks.json` — Android TWA app config; the signed APK
  is built by `.github/workflows/shopify-nav-apk.yml`

## Self-hosted server (recommended)

Running `server/server.js` behind the provided Caddy stack gives you:
- **No API keys for users** — the server holds one `ANTHROPIC_API_KEY` and proxies
  `/api/message`. The app auto-detects the server via `/api/health` and switches to
  keyless mode. The server key is only honored for same-origin requests (the app it
  serves + the Android TWA); foreign origins must send their own `x-user-api-key`.
  Per-IP + global rate limits, a model allowlist, `max_tokens` clamping and a
  web-tools-only allowlist bound abuse.
- **True background store scans** — registered stores are rescanned every 10 min
  server-side (`SCAN_INTERVAL_MS`); the app just pulls the fresh profile.
- **Android APK hosting** — serves `/.well-known/assetlinks.json` for TWA validation.

Deploy on a fresh Ubuntu VPS (e.g. Contabo):
```bash
git clone <this repo> && cd FuzeFront/shopify-nav/deploy
sudo bash setup.sh          # installs Docker, asks for domain + API key, starts app+Caddy
```
DNS prerequisite: an A record pointing your domain (e.g. `shopify-nav.fuzefront.com`)
at the server's IP. Caddy then obtains the Let's Encrypt certificate automatically.

## Android APK (TWA)

`.github/workflows/shopify-nav-apk.yml` builds and signs the APK with Bubblewrap.
Requires GitHub secrets `SHOPIFY_NAV_KEYSTORE_B64`, `SHOPIFY_NAV_KEYSTORE_STORE_PASSWORD`,
`SHOPIFY_NAV_KEYSTORE_KEY_PASSWORD` (the build is skipped with a warning when unset).
Pushes to `master` touching `shopify-nav/**` publish a `shopify-nav-android-vN` Release;
PRs upload the APK as an artifact. The keystore fingerprint is pinned in both
`android/twa-manifest.json` and `.well-known/assetlinks.json` — rotate all three
together (see `android/generate-keystore.sh`). Never commit `*.keystore` (gitignored).

## Features
- **Navigation guide** — describe any task and get an exact, click‑by‑click guide to the Shopify Admin UI. "Stuck on a step?" lets you send a screenshot and get remedial help.
- **Add‑a‑product assistant** — when you ask to *add a new product to your store* (e.g. "can you add a new product for me"), the app opens an interactive assistant instead of a plain guide. It:
  1. Suggests 4 products tailored to your store (2 classic, 1 differentiating, 1 trending on TikTok).
  2. Lets you type a product, paste a supplier link (e.g. AliExpress), or attach a photo.
  3. Finds a real matching product (image + price) and asks "is this it?" — you can say no, explain what's wrong, and it searches again.
  4. Asks which supplier app you use (DSers, AutoDS, …) and builds a **ready‑to‑copy English prompt** you paste into an AI agent with browser/computer control (e.g. Claude Code / Manus) to actually upload the product.
- **Store profile & scan** (Settings) — enter your store URL and the app scans it to learn your niche, style, and colors so suggestions and the final prompt match your brand. Auto‑refreshes every 10 minutes while the app is open, plus a **Scan now** button.
- **10 languages** — Hebrew, English (US/UK), Russian, Chinese, French, Spanish, German, Arabic, Portuguese — switchable in Settings, with full RTL/LTR support. The AI's answers are produced in the selected language.

## Requirements
- The add‑a‑product assistant and store scan use Claude's built‑in **web search / web fetch** tools, so they need a **tools‑capable model**: **Sonnet 5** (default) or **Opus 4.8**. **Haiku** works for the navigation guide only; the smart flows automatically upgrade to Sonnet 5 if Haiku is selected.

## Deploy in 60 seconds (Netlify Drop — easiest)
1. Go to https://app.netlify.com/drop
2. Drag this entire folder onto the page
3. You get an HTTPS URL like `https://something.netlify.app`
4. Open it on your phone

## Or with Vercel
1. Install: `npm i -g vercel`
2. In this folder run: `vercel`
3. Follow prompts → get an HTTPS URL

## Install on your phone (add to home screen)
- **iPhone (Safari):** open the URL → Share → "Add to Home Screen"
- **Android (Chrome):** open the URL → menu (⋮) → "Install app" / "Add to Home Screen"

Once added, it opens fullscreen like a native app.

## First run
On first open it asks for your **Anthropic API key** (get one at
https://console.anthropic.com/settings/keys). It's stored **only on your device**
(localStorage) and is sent only to Anthropic's API. Change it anytime via the ⚙️ gear.

## Notes
- Navigation searches are cached on‑device (per language), so repeating a search is instant and works offline.
- Model is switchable in settings: **Haiku** (fast), **Sonnet** (precise, default), **Opus** (smartest).
- Live product/price/image data from AliExpress is **best‑effort** — AliExpress aggressively blocks automated access, so results can be partial.
- **Background store scanning only runs while the app is open** (a PWA limitation, especially on iOS). Use **Scan now** after making changes you want reflected immediately.
- HTTPS is required for PWA install — that's why you host it (Netlify/Vercel) rather than open the file directly.

## Test locally (optional)
```
cd shopify-nav
python -m http.server 8080
```
Then open http://localhost:8080 (service worker + install work on localhost too).
