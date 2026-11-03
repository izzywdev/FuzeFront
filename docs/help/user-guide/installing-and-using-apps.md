---
title: Installing and Using Apps
description: Find, install, launch, and uninstall apps in FuzeFront, and understand personal versus organization installs.
audience: user
order: 4
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Installing and Using Apps

FuzeFront is a host for other products. Each product registers itself with the portal as an app, and you decide which apps appear in your launcher. This article explains how to install and launch apps and why one might be missing.

## How apps appear in the portal

An app registers a manifest that gives it a name, a menu label, an icon, and a description. The portal reads those and shows the app in three places: the **Available Applications** grid on the Dashboard, the app launcher in the top bar, and the **Apps** section of the sidebar.

Apps run in one of two ways:

- **Inside the portal.** The app is mounted in the portal frame, so the top bar and sidebar stay visible. These are called portal apps and they open under an address starting with `/app/`.
- **Standalone.** The app has its own surface, either in a dedicated page of the portal or on its own address. It may not show the portal's navigation.

You do not need to know which kind an app is; launching it works the same way.

## How to launch an app

1. Select the app's card on the Dashboard, its tile in the top-bar launcher, or its entry in the sidebar.
2. If the app shows **(Offline)** and a health indicator, it is currently unreachable. Try again later; the portal reports it as unavailable rather than opening a blank page.

## How to install an app

1. In the sidebar, open **Applications**.
2. Scroll to **Install applications**. Each row shows the app's name, a short description, and a badge for the scope it supports: personal, organization, or both.
3. Choose **Install** on the app you want.
4. In the dialog, answer only what the app leaves open:
   - **Install to**: **My personal space** (only you see it and it follows you across organizations) or the **organization** you are currently in.
   - **Who can use it**: **Install for me** adds it to your launcher in this organization only; **Install for everyone** adds it to every member's launcher in the organization.
5. Choose **Install**. The app appears in your launcher and on your Dashboard.

Some apps are fixed to one scope. A personal-only app cannot be installed for an organization, and an organization-only app cannot be installed to your personal space. In those cases the dialog explains why and offers only what is allowed.

### Who can install for everyone

Installing for everyone requires an organization owner or admin. If you are a regular member the option is shown but disabled with that explanation. Ask an owner or admin, or install the app for yourself.

## How to uninstall an app

On **Applications**, apps you have installed show **Uninstall** instead of **Install**. Choose it to remove the app. If the app was installed for everyone, uninstalling removes it from every member's launcher in that organization, and the dialog warns you before you confirm.

## Why an app is missing

- **Wrong context.** Apps that require an organization are hidden while you are in the Personal context. Switch to an organization using the top-bar selector or avatar menu.
- **Not installed or not activated.** The Dashboard lists apps that belong to your active organization, apps available to everyone, and public apps. The empty state reads "No applications available". Install one from **Applications**, or ask an admin.
- **Offline.** The card is shown with **(Offline)**.
- **No access.** Some apps, such as internal staff tools, are limited to particular users or organizations.

## Registering your own app

The **Add application** card on the Applications page opens a register-and-activate form for a federated or standalone app: you supply a slug, names, an icon, a visibility, and how the app is loaded. This is aimed at people building apps, and the slug you choose cannot be changed later. See [Registering your app](../developer-guide/registering-your-app.md) and the [quickstart](../developer-guide/quickstart-build-a-microfrontend.md) before using it.

## Related

- [Organizations and teams](organizations-and-teams.md)
- [Navigating the portal](navigating-the-portal.md)
- [Mobile app](mobile-app.md): some apps also ship their own mobile apps.
- [Developer overview](../developer-guide/overview.md)
