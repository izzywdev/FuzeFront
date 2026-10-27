---
title: Organizations and Teams
description: Create an organization, invite members, assign roles, and manage organization settings in FuzeFront.
audience: user
order: 3
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Organizations and Teams

An organization is the shared space where a team uses FuzeFront together. Members of an organization share its installed apps, and its billing is managed at the organization level. This article covers creating an organization, inviting people, and the four roles.

## Roles

Every member of an organization has exactly one role:

| Role | Typical use |
|------|-------------|
| Owner | Full control of the organization. The person who creates an organization becomes its owner. |
| Admin | Manages members, invitations, and settings alongside the owner. |
| Member | Uses the organization's apps and works in it day to day. |
| Viewer | Read-only participation. A viewer cannot change other members' roles. |

Authorization is enforced by the platform's policy service (Permit.io), so what a role may do is decided on the server, not by what the page happens to show. Open the **Permissions** tab on an organization (below) to see exactly what each role grants. The Owner role is assigned when an organization is created; it cannot be handed out through an invitation or changed from the role picker.

## How to create an organization

1. Open the avatar menu and choose **Create organization**, or go to **Organizations** in the sidebar and start a new one.
2. Enter an **Organization name** (up to 255 characters).
3. Enter a **slug**, a short unique identifier. It may contain letters, numbers, hyphens, and underscores, and be up to 100 characters.
4. Submit the form. A confirmation appears and you can go straight to the Dashboard.

If the slug is already taken, creation fails with a message that an organization with that slug exists. Choose another slug and try again.

## How to switch organizations

Use the organization selector in the top bar, or the avatar menu, to pick the organization you want to work in. The Dashboard, launcher, and sidebar then show that organization's apps. See [Navigating the portal](navigating-the-portal.md).

## Organization pages

Open **Organizations** in the sidebar and select an organization. Its page has three tabs:

- **Overview**: the number of members, the organization type, and whether it is active.
- **Members**: the member list, permissions, pending invitations, and API tokens (see below).
- **Settings**: rename or edit the organization, or delete it. This tab is available only to people who have permission to update the organization; others see a message that they lack permission.

If you can see an organization but are not a member (for example a platform organization), the Members tab says so and asks you to request an invitation from an owner or admin.

## How to invite people

Owners and admins can invite people.

1. Open the organization, then **Members**.
2. Choose **Invite member**.
3. Enter an email address on the **Single** tab, or paste many addresses, one per line, or drop a CSV file on the **Bulk / CSV** tab. A preview lists the recipients and flags invalid addresses.
4. Pick a role. The roles you can invite are Admin, Member, and Viewer; Member is the default.
5. Choose **Send invite**.

Invitation details:

- An invitation expires after 7 days.
- Only one pending invitation can exist for an email address in an organization; sending another is rejected until the first is accepted, revoked, or expired.
- The **Pending Invitations** tab lists open invitations with their role, the date invited, and expiry. Use **Resend** to extend an invitation and send it again, or **Revoke** to cancel it.

## How to accept an invitation

1. Open the link from the invitation email. It leads to a page titled "You are invited to join" the organization.
2. If you are not signed in, sign in or create an account. Use the email address the invitation was sent to.
3. Accept the invitation. You land in the organization with the role you were invited as.

If you are signed in as a different email address, the page tells you the invitation is for another address; sign out and sign in with the correct one. An expired or already-accepted invitation shows a clear message, and an owner or admin can send a fresh one.

## How to change a member's role or remove a member

On the **Members** tab, use the role picker on a member's row to switch them between Admin, Member, and Viewer. The picker is disabled if you are a Viewer, and always for the Owner row; the server also checks your permissions, so a change you are not allowed to make is rejected. Use **Remove** and confirm to take someone out of the organization.

## API tokens

The **API Tokens** tab creates tokens for scripts and services. A **Personal** token acts as you; a **Service** token acts as the organization. A new token is shown once, at creation. Copy it then, because it cannot be displayed again. Revoking a token stops every application using it immediately.

## Related

- [Installing and using apps](installing-and-using-apps.md): install an app for yourself or for everyone in an organization.
- [Billing and plans](billing-and-plans.md): organization billing requires permission to manage the organization.
- [Account and security](account-and-security.md)
