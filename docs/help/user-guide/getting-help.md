---
title: Getting Help
description: Where to check service health, find answers, and report a problem with FuzeFront.
audience: user
order: 8
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Getting Help

This article lists the support paths that exist today, in the order that usually gets you to an answer fastest: self-service checks first, then your organization's admins, then reporting an issue.

## 1. Check this Help Center

The Help Center is the in-app documentation. Open **Help** from the bottom of the left sidebar (it stays pinned there on every page). The user guide has these articles:

- [Getting started](getting-started.md)
- [Navigating the portal](navigating-the-portal.md)
- [Organizations and teams](organizations-and-teams.md)
- [Installing and using apps](installing-and-using-apps.md)
- [Account and security](account-and-security.md)
- [Billing and plans](billing-and-plans.md)
- [Mobile app](mobile-app.md)

If you are building an app for the portal rather than using it, the developer guide starts at the [overview](../developer-guide/overview.md), with [troubleshooting](../developer-guide/troubleshooting.md) for build and registration problems.

## 2. Check the system status page

If a page will not load, an app shows **(Offline)**, or sign-in is slow, check platform health before assuming the problem is your account.

1. Choose **Status** at the bottom of the sidebar.
2. The **System Status** page shows the state of the backend API, the frontend, the WebSocket connection, and the database.
3. The page refreshes itself every 30 seconds, so you can leave it open while a problem is being fixed.

An individual app can be offline while the platform is healthy. In that case the app's card on the Dashboard carries the **(Offline)** label and a launch attempt tells you the app is unavailable; the app's own team resolves it.

## 3. Ask your organization owner or admin

Questions about membership and access are managed inside your organization, so owners and admins can answer them directly:

- You did not receive or cannot accept an invitation, or it expired. An owner or admin can resend or replace it. See [Organizations and teams](organizations-and-teams.md).
- You need a different role, or an app is not visible to you.
- You need an app installed for everyone. See [Installing and using apps](installing-and-using-apps.md).

## 4. Report a problem on GitHub

FuzeFront's issue tracker is the supported channel for bugs and requests:

https://github.com/izzywdev/FuzeFront/issues

Search existing issues first, then open a new one. A report is much easier to act on when it includes:

- What you were doing and what you expected to happen.
- What actually happened, including any message shown on screen, word for word.
- The address of the page (for example `/billing`), your browser and device, and whether you used the web, the installed web app, or the Android app.
- Which context was active: Personal or a named organization.
- The time, including time zone, so the team can match it to the platform logs.

Do not paste passwords, API tokens, one-time codes, or card details into an issue. If the tracker is not visible to your account, ask your organization admin to raise the report.

## What is not offered

There is no email address, chat server, or phone line listed for FuzeFront support in the product. If you see one quoted somewhere, it did not come from this documentation and should not be trusted.

## Related

- [Account and security](account-and-security.md): sign-in problems and sessions.
- [Billing and plans](billing-and-plans.md): billing pages that will not load.
- [Mobile app](mobile-app.md)
