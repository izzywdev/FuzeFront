---
title: Account and Security
description: Manage your FuzeFront profile, sign-in methods, connected accounts, and signed-in sessions.
audience: user
order: 5
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Account and Security

This article covers the pages that belong to you personally: your profile, the ways you sign in, connected accounts, and signing out. Organization-wide controls such as roles and invitations are in [Organizations and teams](organizations-and-teams.md).

## How sign-in works

FuzeFront authenticates you through the platform's single sign-on service (Authentik, using OpenID Connect). You can sign in with:

- **Email and password**, the account you created on the sign-up page.
- **Google**, when the **Sign in with Google** button is shown on the sign-in page.

There is no shared or default account. If you cannot remember your password, use **Forgot password?** on the sign-in page where it is offered. Email verification and password reset are being rolled out behind a feature flag, so the link and the "check your inbox" screen appear only where that is enabled for your deployment.

If your account requires additional verification (two-factor), the sign-in page tells you that further verification is needed and asks you to complete it before you continue.

## Your profile

Choose **Profile** in the sidebar, or **Profile** in the avatar menu. The page has three tabs: **Profile**, **Security**, and **Notifications**.

- **Profile** holds your first name, last name, bio, timezone, and language preference. Edit them, then save.
- **Notifications** has switches for email notifications, push notifications in your browser, and marketing communications.
- **Security** shows your password and two-factor status and links onward to the security hub below.

To change the language you read the portal in right now, use the **Language** control in the avatar menu instead; see [Navigating the portal](navigating-the-portal.md).

## The Security hub

Choose **Settings** in the avatar menu to open the Security hub at `/account/security`. It summarizes your posture in one line (for example "Your account is well protected" or "Your account needs attention") and shows cards for:

- **Password**: change your password, or add one if you only sign in with a provider.
- **Two-factor auth**: a second step at sign-in using an authenticator app or an SMS code.
- **Devices & sessions**: see where you are signed in and sign out of any device.
- **API tokens**: create and revoke machine tokens for scripts and services.
- **Connected accounts**: link or unlink sign-in providers.

Current availability: the hub is released behind a feature flag. If the page reads "This area isn't available yet", it is not enabled for your account yet. Also, today only the **Connected accounts** card opens a dedicated page in the portal; the other cards are part of the hub design and their pages are not yet reachable in the portal shell, so they may show a "not found" page. Organization API tokens can be managed now from an organization's **Members** area (see [Organizations and teams](organizations-and-teams.md)).

If the hub cannot load, it shows "Couldn't load your security settings" and a **Try again** button; your account is unaffected.

## How to connect or disconnect a sign-in provider

1. Open the Security hub and choose **Connected accounts** (or go to `/account/security/connections`).
2. Under **Add a way to sign in**, choose **Connect** next to a provider such as Google.
3. Confirm on the provider's page. You are brought back to FuzeFront, which tells you the account is connected. Nothing links until you approve, and your FuzeFront password is never shared with the provider.
4. To remove a provider, choose **Remove** on its row.

Two safety rules apply:

- **Keep at least one way to sign in.** If a method is your only one, it cannot be unlinked. Set a password or link another provider first.
- **Set a password first.** If you signed up through a provider you have no password yet. Actions that need a password, such as changing it, ask you to set one first.

## Staying signed in on several accounts

The avatar menu lists the accounts signed in on this browser. You can keep up to five at once and switch between them. When you reach the limit, sign out of one before adding another. A row marked "Session expired" needs you to sign in again.

## How to sign out

Open the avatar menu and choose **Sign out**. If you have several accounts signed in, **Sign out** on an account's row signs out of only that account. On a shared computer, sign out before leaving.

## Connectors

**Connectors** in the sidebar is separate from sign-in. It lets you connect external accounts, such as Gmail, that FuzeFront agents may use on your behalf. Credentials stay in your FuzeKeys vault, and you can **Disconnect** at any time.

## Related

- [Getting started](getting-started.md)
- [Getting help](getting-help.md)
- [Authentication and authorization](../developer-guide/authentication-and-authorization.md): how sign-in and permissions work, for developers.
