---
title: Using FuzeFront on Mobile
description: Use the FuzeFront portal on a phone through the Android app or by installing it as a web app.
audience: user
order: 7
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Using FuzeFront on Mobile

FuzeFront works on phones in three ways: in the mobile browser, as an installable web app (PWA), and as a signed Android app. All three show the same portal at https://app.fuzefront.com and use the same account, so nothing is separate to sign up for.

## The mobile layout

On screens 768 pixels wide or narrower, the portal adapts:

- The sidebar becomes a slide-in drawer. Open it with the **menu button** (three bars) at the left of the top bar. Selecting a destination closes the drawer.
- The portal pages, app launcher, organization switching, and avatar menu described in [Navigating the portal](navigating-the-portal.md) are the same as on desktop; only the arrangement changes.

## Android app

The Android app is a Trusted Web Activity. It does not contain a separate copy of the portal. It opens https://app.fuzefront.com in full-screen standalone mode without the browser's address bar, backed by the same live service. That means you always get the current version of the portal, and there is no separate app update to wait for.

Requirements: Android 7.0 or later and Chrome 72 or later installed on the device.

### How to install the Android app

1. Download the latest `.apk` from the FuzeFront Android release on GitHub: https://github.com/izzywdev/FuzeFront/releases. Releases are named like "FuzeFront Android vN". The APK is signed by the FuzeFront build pipeline.
2. On the phone, allow installing from your browser or Files app: **Settings, Apps, Install unknown apps**.
3. Open the downloaded file and tap **Install**.
4. Launch **FuzeFront** from your home screen and sign in.

If you cannot open the Releases page, ask your organization owner or admin whether the APK has been shared with you, or use the web app install below. There is no Google Play listing for FuzeFront that this guide can point you to.

## Install as a web app (PWA)

Any modern mobile browser can add the portal to your home screen:

1. Open https://app.fuzefront.com in the browser and sign in.
2. Open the browser menu and choose **Install app** or **Add to Home screen**.
3. Launch FuzeFront from the new home-screen icon. It opens standalone, without browser chrome.

The web app updates itself in the background: the portal checks for a new version regularly and when the app regains focus.

## Mobile apps for other products

A product that runs on FuzeFront can publish its own mobile app. When it does, and you open the portal in a mobile browser:

- An **Install the app** banner appears when that app is open, with a button that reads **Google Play**, **App Store**, or **Download APK** depending on your device and what the product provides.
- The app's card on the Applications page shows its download links.

The banner is not shown inside the installed Android app or the installed web app, because you are already in an installed session.

## Troubleshooting

- **Blank or offline screen.** Open https://app.fuzefront.com in a normal browser tab to check connectivity, then see the status page described in [Getting help](getting-help.md).
- **Signed out unexpectedly.** Sign in again. You can keep several accounts signed in at once; see [Account and security](account-and-security.md).
- **An app is missing on mobile.** Check your active organization in the avatar menu; see [Installing and using apps](installing-and-using-apps.md).

For the first-time walkthrough, see [Getting started](getting-started.md).
