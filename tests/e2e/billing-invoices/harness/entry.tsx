/**
 * Built-component harness entry — drives the REAL React
 * `@fuzefront/billing-ui → InvoiceHistoryPanel` with a stubbed `listInvoices`.
 *
 * This is bundled at test time by `built-component.spec.ts` (esbuild) into
 * `.harness/bundle.js` and loaded by `.harness/index.html` over `file://`. It is
 * NOT part of `@fuzefront/billing-ui` — it imports the component from source so
 * the independent e2e exercises the actual implementation, not the static frame.
 *
 * The scenario is selected from `location.hash` (e.g. `#populated`, `#loadmore`,
 * `#empty`, `#loading`, `#error`) so one bundle serves every state the approved
 * frames assert. The mock is a pure closure — no network, no vendor SDK.
 *
 * IMPORTANT (vendor neutrality): every URL / string produced here is a FuzeFront
 * opaque hosted document. No vendor brand name ("stripe"/"link") appears in any
 * fixture value — the spec asserts the rendered DOM stays vendor-neutral.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
// Import the built component + i18n provider straight from billing-ui source.
import { InvoiceHistoryPanel } from '../../../../packages/billing-ui/src/components/InvoiceHistoryPanel';
import { BillingI18nProvider } from '../../../../packages/billing-ui/src/i18n';

// Minimal structural shape of a billing-client invoice (types are erased at
// bundle time; these are just the fields the component reads).
type Invoice = {
  id: string;
  number: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft';
  created: string;
  amountDue: number;
  currency: string;
  invoicePdf?: string;
  hostedInvoiceUrl?: string;
};
type ListResponse = { invoices: Invoice[]; nextCursor: string | null };
type ListInvoices = (opts: { limit?: number; cursor?: string }) => Promise<ListResponse>;

// A vendor-neutral, FuzeFront-hosted opaque document base. No "stripe"/"link".
const DOC = 'https://docs.fuzefront.com/billing';

const pdf = (n: string): string => `${DOC}/${n}.pdf`;
const hosted = (n: string): string => `${DOC}/${n}`;

/** Page 1: the four status variants the frames assert; FF-2026-0042 is paid. */
const PAGE_1: Invoice[] = [
  {
    id: 'in_0042',
    number: 'FF-2026-0042',
    status: 'paid',
    created: '2026-07-01T00:00:00.000Z',
    amountDue: 4200,
    currency: 'usd',
    invoicePdf: pdf('FF-2026-0042'),
  },
  {
    id: 'in_0041',
    number: 'FF-2026-0041',
    status: 'open',
    created: '2026-06-01T00:00:00.000Z',
    amountDue: 4200,
    currency: 'usd',
    invoicePdf: pdf('FF-2026-0041'),
  },
  {
    id: 'in_0040',
    number: 'FF-2026-0040',
    status: 'void',
    created: '2026-05-01T00:00:00.000Z',
    amountDue: 0,
    currency: 'usd',
    // No PDF for this one -> exercises the hosted-document link branch.
    hostedInvoiceUrl: hosted('FF-2026-0040'),
  },
  {
    id: 'in_0039',
    number: 'FF-2026-0039',
    status: 'uncollectible',
    created: '2026-04-01T00:00:00.000Z',
    amountDue: 4200,
    currency: 'usd',
    invoicePdf: pdf('FF-2026-0039'),
  },
];

/** Page 2: appended by "Load more" using the next cursor. */
const PAGE_2: Invoice[] = [
  {
    id: 'in_0038',
    number: 'FF-2026-0038',
    status: 'paid',
    created: '2026-03-01T00:00:00.000Z',
    amountDue: 4200,
    currency: 'usd',
    invoicePdf: pdf('FF-2026-0038'),
  },
  {
    id: 'in_0037',
    number: 'FF-2026-0037',
    status: 'paid',
    created: '2026-02-01T00:00:00.000Z',
    amountDue: 4200,
    currency: 'usd',
    invoicePdf: pdf('FF-2026-0037'),
  },
];

const NEXT = 'cursor-page-2';

/** Build the scenario-specific `listInvoices` stub. */
function makeMock(scenario: string): ListInvoices {
  let calls = 0;
  return ({ cursor } = {}) => {
    calls += 1;
    switch (scenario) {
      case 'empty':
        return Promise.resolve({ invoices: [], nextCursor: null });

      case 'loading':
        // Never settles -> the panel stays in its loading skeleton state.
        return new Promise<ListResponse>(() => {});

      case 'error':
        // First load fails; a retry (subsequent call) recovers with page 1.
        if (calls === 1) return Promise.reject(new Error('simulated fetch failure'));
        return Promise.resolve({ invoices: PAGE_1, nextCursor: null });

      case 'loadmore':
        if (cursor === NEXT) return Promise.resolve({ invoices: PAGE_2, nextCursor: null });
        // First page (2 rows) advertises a next cursor.
        return Promise.resolve({ invoices: PAGE_1.slice(0, 2), nextCursor: NEXT });

      case 'populated':
      default:
        return Promise.resolve({ invoices: PAGE_1, nextCursor: NEXT });
    }
  };
}

const scenario = (location.hash || '#populated').replace(/^#/, '') || 'populated';

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  React.createElement(
    BillingI18nProvider,
    null,
    React.createElement(InvoiceHistoryPanel, {
      enabled: true,
      pageSize: 20,
      // Cast is a no-op at runtime; the component only awaits the promise shape.
      listInvoices: makeMock(scenario) as never,
    }),
  ),
);

// Signal readiness for the driver (React has committed the first paint).
(window as unknown as { __HARNESS_READY__: boolean }).__HARNESS_READY__ = true;
