---
title: Getting Started with FuzeFront
description: Sign in to the FuzeFront portal for the first time, find your way around, and launch your first app.
audience: user
order: 1
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Getting Started with FuzeFront

FuzeFront is a portal that gathers the apps your team uses into one place. You sign in once, pick the organization you are working in, and launch apps from a shared launcher without signing in to each one separately. The portal lives at https://app.fuzefront.com.

This article walks through your first session. Each section links to a longer article when you want more detail.

## What you need

- A modern desktop or mobile browser.
- An account. You can create one yourself on the sign-in page, or accept an invitation from an organization owner or admin (see [Organizations and teams](organizations-and-teams.md)).
- There is no shared or default account for the portal. Each person signs in with their own credentials.

## How to sign in

1. Open https://app.fuzefront.com. If you are not signed in you land on the sign-in page.
2. Sign in with your email address and password, or choose **Sign in with Google** if the button is shown.
3. If your account has two-factor verification turned on, you are asked to complete the extra verification step before the portal opens.

Authentication is handled by the platform's single sign-on service (Authentik, using OpenID Connect), so the same identity works across every app you launch from the portal. For the technical background see [Authentication and authorization](../developer-guide/authentication-and-authorization.md).

## How to create an account

1. On the sign-in page choose **Sign up**.
2. Enter your first name, last name, email, and a password, then choose **Create account**.
3. When email verification is enabled for the portal, you are sent to a "check your inbox" page. Open the link in the email to verify the address.

If you were invited to an organization, sign up (or sign in) using the same email address the invitation was sent to. The invitation only works for that address.

## What you see after signing in

You land on the **Dashboard**. It greets you by first name and shows an **Available Applications** grid with one card per app you can use right now. Each card shows the app's icon, name, a short description, and a health indicator. An app marked **(Offline)** is currently unreachable and cannot be launched until it recovers.

If the grid is empty, the message reads "No applications available". Nothing is wrong with your account. It means no app has been installed for you or your active organization yet. See [Installing and using apps](installing-and-using-apps.md).

## How to launch an app

Select an app card on the Dashboard, or use the app launcher (the grid icon) in the top bar, or pick the app from the **Apps** section of the left sidebar. The app opens inside the portal, with the portal's top bar still visible. Some apps open on their own address instead of inside the portal frame; the launcher handles that for you.

## Choose your working context

Apps and billing can belong to you personally or to an organization. Open the avatar menu at the right of the top bar to switch between organizations you belong to. Where the personal context is enabled for your deployment, a **Personal** entry is also listed, for working as yourself rather than as an organization. The Dashboard, the sidebar, and the launcher update to match. Details are in [Organizations and teams](organizations-and-teams.md).

## Where to go next

- [Navigating the portal](navigating-the-portal.md): the top bar, sidebar, language, and theme controls.
- [Organizations and teams](organizations-and-teams.md): create an organization, invite people, understand roles.
- [Installing and using apps](installing-and-using-apps.md): add apps to your launcher.
- [Account and security](account-and-security.md): sign-in methods, two-factor, and sessions.
- [Billing and plans](billing-and-plans.md): plans and invoices.
- [Mobile app](mobile-app.md): use FuzeFront on your phone.
- [Getting help](getting-help.md): service status and how to report a problem.

If you build apps that run inside the portal, start with the [developer overview](../developer-guide/overview.md).
