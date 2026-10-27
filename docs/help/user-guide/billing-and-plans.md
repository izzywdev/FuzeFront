---
title: Billing and Plans
description: Understand FuzeFront plans, how to subscribe or change plan, and where to find invoices and payment methods.
audience: user
order: 6
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Billing and Plans

Billing in FuzeFront is handled through Stripe. You pick a plan on the **Billing** page, pay through Stripe, and manage invoices and payment methods from the same page. This article explains the plans and the steps for common tasks.

## Open the Billing page

Choose **Billing** in the sidebar. The page opens on the **Plans** tab and has two more tabs, **Invoices** and **Payments**. At the top, a summary of your current subscription shows your plan, its status, trial and renewal dates where they apply, and options to change or cancel it.

## Whose billing am I looking at?

Billing follows your active context:

- In your **personal** context, you see your own billing.
- In an **organization**, you see that organization's billing. You need permission to manage the organization to view or change it; otherwise requests are refused with an "insufficient organization permissions" error. See [Organizations and teams](organizations-and-teams.md).

Switch context from the top bar before you change a plan, so the right account is billed.

## The plans

| Plan | Price (monthly, USD) | Notes |
|------|----------------------|-------|
| Free | $0 | Entry tier. |
| Builder | $29 | Self-serve. |
| Business | $99 | Self-serve. |
| Enterprise | Contact sales | No self-serve checkout; the page shows **Contact Sales**. |

The catalog is read from Stripe, which is the source of truth for plans and prices, so the Billing page is what to trust if anything here ever differs. The plan list includes the features of each plan. A separate low-price test plan exists for checkout testing only; it is not meant for customers.

## How to subscribe or change plan

1. Open **Billing**, then the **Plans** tab.
2. Find the plan you want. The recommended plan is highlighted.
3. Choose the button on its card. It reads **Subscribe** if you have no subscription, or **Upgrade**, **Downgrade**, or **Switch** relative to your current plan. Your current plan is marked **Current Plan**.
4. If you are subscribing for the first time, you are taken to a Stripe checkout page to enter payment details, then returned to the Billing page. If you already have a subscription, an upgrade, downgrade, or switch is applied to the existing subscription without a new checkout.

For **Enterprise**, the button is **Contact Sales** rather than a checkout. It opens a pre-filled email message to the sales team, so your device needs an email app or webmail handler configured.

## How to cancel or resume

In the subscription summary at the top of the Billing page, choose **Cancel subscription**. The subscription ends at the close of the current billing period, and the summary says so. Until then you can choose **Resume subscription** to keep your plan. **Change plan** takes you back to the Plans tab.

## Invoices

The **Invoices** tab lists your Stripe invoices in pages. Choose **Load more** to see older ones. If the list cannot load you see "Could not load invoices. Please try again shortly."

## Payment methods

The **Payments** tab has a **Manage billing** button. It opens the Stripe Billing portal, a secure Stripe-hosted page where you add or change cards and see payment history. FuzeFront never handles your card number. You return to the Payments tab when you are done. If the portal does not open you see "Could not open the billing portal. Please try again."

## Related

- [Organizations and teams](organizations-and-teams.md)
- [Account and security](account-and-security.md)
- [Getting help](getting-help.md): if a billing page will not load, check the status page and report it.
