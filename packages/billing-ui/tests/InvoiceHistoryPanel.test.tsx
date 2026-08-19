import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BillingInvoice, InvoiceListResponse } from '@fuzefront/billing-client';
import { InvoiceHistoryPanel } from '../src/components/InvoiceHistoryPanel';
import { renderWithI18n } from './helpers';

const makeInvoice = (over: Partial<BillingInvoice> = {}): BillingInvoice => ({
  id: 'inv_1',
  number: 'FF-2026-0042',
  created: '2026-07-01T00:00:00.000Z',
  amountDue: 4900,
  amountPaid: 4900,
  currency: 'usd',
  status: 'paid',
  hostedInvoiceUrl: null,
  invoicePdf: 'https://files.example.test/inv_1.pdf',
  ...over,
});

const page = (
  invoices: BillingInvoice[],
  nextCursor: string | null = null,
): InvoiceListResponse => ({ invoices, nextCursor });

describe('InvoiceHistoryPanel — feature-flag gate', () => {
  it('renders nothing when the flag is OFF (default)', () => {
    const listInvoices = vi.fn();
    const { container } = renderWithI18n(
      <InvoiceHistoryPanel listInvoices={listInvoices} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it('renders and fetches when the flag is ON', async () => {
    const listInvoices = vi.fn().mockResolvedValue(page([makeInvoice()]));
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);
    expect(await screen.findByTestId('invoice-history-panel')).toBeInTheDocument();
    await waitFor(() => expect(listInvoices).toHaveBeenCalledWith({ limit: 20 }));
  });
});

describe('InvoiceHistoryPanel — rows', () => {
  it('renders a row per invoice with number, date and amount', async () => {
    const listInvoices = vi.fn().mockResolvedValue(
      page([
        makeInvoice({ id: 'a', number: 'FF-2026-0042' }),
        makeInvoice({ id: 'b', number: 'FF-2026-0031', created: '2026-06-01T00:00:00.000Z' }),
      ]),
    );
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);

    const panel = within(await screen.findByTestId('invoice-history-panel'));
    const rows = await screen.findAllByTestId('invoice-row');
    expect(rows).toHaveLength(2);
    expect(panel.getByText('FF-2026-0042')).toBeInTheDocument();
    expect(panel.getByText('FF-2026-0031')).toBeInTheDocument();
    // 4900 cents → $49.00
    expect(panel.getAllByText('$49.00')).toHaveLength(2);
    // count readout
    expect(panel.getByText('2 shown')).toBeInTheDocument();
  });

  it('maps each status to its semantic pill tone and exposes data-status', async () => {
    const listInvoices = vi.fn().mockResolvedValue(
      page([
        makeInvoice({ id: 'p', number: 'P-1', status: 'paid' }),
        makeInvoice({ id: 'o', number: 'O-1', status: 'open' }),
        makeInvoice({ id: 'v', number: 'V-1', status: 'void', amountDue: 0 }),
        makeInvoice({ id: 'u', number: 'U-1', status: 'uncollectible' }),
      ]),
    );
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);
    await screen.findAllByTestId('invoice-row');

    const rowFor = (num: string) =>
      document.querySelector(`[data-invoice="${num}"]`) as HTMLElement;

    expect(rowFor('P-1')).toHaveAttribute('data-status', 'paid');
    expect(rowFor('P-1').querySelector('.ffb-invoices__pill--success')).not.toBeNull();
    expect(rowFor('O-1').querySelector('.ffb-invoices__pill--warning')).not.toBeNull();
    expect(rowFor('V-1').querySelector('.ffb-invoices__pill--neutral')).not.toBeNull();
    expect(rowFor('U-1')).toHaveAttribute('data-status', 'uncollectible');
    expect(rowFor('U-1').querySelector('.ffb-invoices__pill--error')).not.toBeNull();
  });
});

describe('InvoiceHistoryPanel — download link', () => {
  it('renders a PDF link with an accessible name when invoicePdf is present', async () => {
    const listInvoices = vi.fn().mockResolvedValue(
      page([makeInvoice({ number: 'FF-2026-0042', invoicePdf: 'https://x/pdf', hostedInvoiceUrl: null })]),
    );
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);
    const link = await screen.findByRole('link', {
      name: 'Download invoice FF-2026-0042 PDF',
    });
    expect(link).toHaveAttribute('data-download', 'pdf');
    expect(link).toHaveAttribute('href', 'https://x/pdf');
  });

  it('falls back to the hosted "View" link when no PDF is available', async () => {
    const listInvoices = vi.fn().mockResolvedValue(
      page([
        makeInvoice({
          number: 'FF-2026-0025',
          status: 'open',
          invoicePdf: null,
          hostedInvoiceUrl: 'https://x/hosted',
        }),
      ]),
    );
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);
    const link = await screen.findByRole('link', { name: 'View invoice FF-2026-0025' });
    expect(link).toHaveAttribute('data-download', 'hosted');
    expect(link).toHaveAttribute('href', 'https://x/hosted');
  });
});

describe('InvoiceHistoryPanel — states', () => {
  it('shows a loading skeleton before data resolves', async () => {
    let resolve!: (v: InvoiceListResponse) => void;
    const listInvoices = vi.fn().mockReturnValue(
      new Promise<InvoiceListResponse>((r) => {
        resolve = r;
      }),
    );
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);
    const panel = await screen.findByTestId('invoice-history-panel');
    expect(panel).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('invoice-loading')).toBeInTheDocument();
    resolve(page([]));
    await waitFor(() => expect(panel).not.toHaveAttribute('data-state', 'loading'));
  });

  it('shows the empty state when there are no invoices', async () => {
    const listInvoices = vi.fn().mockResolvedValue(page([]));
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);
    expect(await screen.findByTestId('invoice-empty')).toBeInTheDocument();
    expect(screen.getByText('No invoices yet')).toBeInTheDocument();
    const panel = screen.getByTestId('invoice-history-panel');
    expect(panel).toHaveAttribute('data-state', 'empty');
  });

  it('shows an error + retry, and retry re-fetches successfully', async () => {
    const user = userEvent.setup();
    const listInvoices = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page([makeInvoice()]));
    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} />);

    const error = await screen.findByTestId('invoice-error');
    expect(error).toBeInTheDocument();
    expect(screen.getByTestId('invoice-history-panel')).toHaveAttribute('data-state', 'error');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('invoice-row')).toBeInTheDocument();
    expect(listInvoices).toHaveBeenCalledTimes(2);
  });
});

describe('InvoiceHistoryPanel — load more', () => {
  it('appends the next cursor page and drops the button on the last page', async () => {
    const user = userEvent.setup();
    const listInvoices = vi
      .fn()
      .mockResolvedValueOnce(page([makeInvoice({ id: '1', number: 'FF-1' })], 'cursor-2'))
      .mockResolvedValueOnce(page([makeInvoice({ id: '2', number: 'FF-2' })], null));

    renderWithI18n(<InvoiceHistoryPanel enabled listInvoices={listInvoices} pageSize={1} />);

    expect(await screen.findByText('FF-1')).toBeInTheDocument();
    const loadMore = screen.getByRole('button', { name: 'Load more' });
    await user.click(loadMore);

    await waitFor(() =>
      expect(listInvoices).toHaveBeenNthCalledWith(2, { limit: 1, cursor: 'cursor-2' }),
    );
    expect(await screen.findByText('FF-2')).toBeInTheDocument();
    expect(screen.getByText('FF-1')).toBeInTheDocument();
    expect(screen.getAllByTestId('invoice-row')).toHaveLength(2);
    // last page → no more button
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('InvoiceHistoryPanel — vendor neutrality', () => {
  it('never leaks a payment-vendor name into the DOM', async () => {
    const listInvoices = vi.fn().mockResolvedValue(
      page([makeInvoice({ status: 'paid' }), makeInvoice({ id: '2', number: 'FF-2', status: 'open' })]),
    );
    const { container } = renderWithI18n(
      <InvoiceHistoryPanel enabled listInvoices={listInvoices} />,
    );
    await screen.findAllByTestId('invoice-row');
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain('stripe');
    // "link" as a standalone vendor word (guard against the Stripe "Link" wallet)
    expect(container.textContent?.toLowerCase()).not.toContain('stripe');
    expect(container.textContent?.toLowerCase()).not.toContain('link');
  });
});
