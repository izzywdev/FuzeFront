import { useCallback, useEffect, useState } from 'react';
import type { BillingInvoice, InvoiceListResponse } from '@fuzefront/billing-client';
import { useBillingI18n } from '../i18n';
import { invoiceStatusTone, invoiceStatusLabel } from '../lib/status';
import { Button } from './primitives';

/** Signature of the injected data source (mirrors billing-client.listInvoices). */
export type ListInvoices = (opts: {
  limit?: number;
  cursor?: string;
}) => Promise<InvoiceListResponse>;

export interface InvoiceHistoryPanelProps {
  /**
   * Feature-flag gate (`fuzefront.billing.invoice-history`, default OFF). The
   * caller resolves the flag (e.g. via `@fuzefront/feature-flags`) and forwards
   * the result here so this package stays flag-provider-agnostic and testable.
   * When false the panel renders nothing.
   */
  enabled?: boolean;
  /**
   * Injected data source — the caller passes `client.listInvoices` (or the host
   * service wrapper). Kept as a callback so the panel is fully testable without
   * a network and never hard-codes an API host / vendor.
   */
  listInvoices: ListInvoices;
  /** Page size for the initial load and each "Load more". */
  pageSize?: number;
}

type LoadState = 'loading' | 'error' | 'ready';

/** Decorative download glyph (matches the approval frame). */
function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v12m0 0l4-4m-4 4l-4-4M4 21h16" />
    </svg>
  );
}

/** Decorative document glyph for the "View" (hosted) link + empty state. */
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 3v5h5M8 13h8M8 17h5M6 3h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="ffb-invoices__empty-icon ffb-invoices__empty-icon--error"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

/** A single invoice's download link — PDF when available, else the hosted doc. */
function InvoiceDownload({ invoice }: { invoice: BillingInvoice }) {
  const { strings } = useBillingI18n();
  const label = invoice.number ?? invoice.id;

  if (invoice.invoicePdf) {
    return (
      <a
        className="ffb-invoices__dl"
        href={invoice.invoicePdf}
        target="_blank"
        rel="noopener noreferrer"
        data-download="pdf"
        data-testid="invoice-download"
        aria-label={`${strings.invoiceDownloadAria} ${label} ${strings.invoiceDownloadPdf}`}
      >
        <DownloadIcon />
        {strings.invoiceDownloadPdf}
      </a>
    );
  }

  if (invoice.hostedInvoiceUrl) {
    return (
      <a
        className="ffb-invoices__dl"
        href={invoice.hostedInvoiceUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-download="hosted"
        data-testid="invoice-download"
        aria-label={`${strings.invoiceViewAria} ${label}`}
      >
        <DocumentIcon />
        {strings.invoiceView}
      </a>
    );
  }

  return null;
}

function InvoiceRow({ invoice }: { invoice: BillingInvoice }) {
  const { strings, formatCurrency, formatDate } = useBillingI18n();
  const tone = invoiceStatusTone(invoice.status);
  const number = invoice.number ?? invoice.id;

  return (
    <div
      className="ffb-invoices__row"
      data-invoice={number}
      data-status={invoice.status}
      data-testid="invoice-row"
    >
      <div className="ffb-invoices__row-main">
        <div className="ffb-invoices__row-top">
          <span className="ffb-invoices__num">{number}</span>
          <span className="ffb-invoices__date">· {formatDate(invoice.created)}</span>
        </div>
      </div>
      <div className="ffb-invoices__row-side">
        <span className={`ffb-invoices__pill ffb-invoices__pill--${tone}`}>
          <span className="ffb-invoices__pill-dot" aria-hidden="true" />
          {invoiceStatusLabel(invoice.status, strings)}
        </span>
        <span className="ffb-invoices__amount">
          {formatCurrency(invoice.amountDue, invoice.currency)}
        </span>
        <InvoiceDownload invoice={invoice} />
      </div>
    </div>
  );
}

/** Non-interactive skeleton row shown while the first page loads. */
function SkeletonRow() {
  return (
    <div className="ffb-invoices__row" aria-hidden="true">
      <div className="ffb-invoices__row-main">
        <span className="ffb-invoices__skel ffb-invoices__skel--wide" />
        <span className="ffb-invoices__skel ffb-invoices__skel--narrow" />
      </div>
      <span className="ffb-invoices__skel ffb-invoices__skel--pill" />
    </div>
  );
}

/**
 * Vendor-neutral invoice history. Renders newest-first rows from the injected
 * `listInvoices` source (id/number/amount/status from FuzeFront's own store; the
 * download link is an opaque provider-hosted document). Cursor "Load more"
 * appends the next page. Loading / empty / error states mirror the approval
 * frames. No vendor name is ever emitted.
 */
export function InvoiceHistoryPanel({
  enabled = false,
  listInvoices,
  pageSize = 20,
}: InvoiceHistoryPanelProps) {
  const { strings } = useBillingI18n();
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirst = useCallback(() => {
    let cancelled = false;
    setState('loading');
    listInvoices({ limit: pageSize })
      .then((res) => {
        if (cancelled) return;
        setInvoices(res.invoices);
        setNextCursor(res.nextCursor);
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setInvoices([]);
        setNextCursor(null);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [listInvoices, pageSize]);

  useEffect(() => {
    if (!enabled) return;
    const cancel = loadFirst();
    return cancel;
  }, [enabled, loadFirst]);

  // Feature flag OFF → render nothing at all.
  if (!enabled) return null;

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listInvoices({ limit: pageSize, cursor: nextCursor });
      setInvoices((prev) => [...prev, ...res.invoices]);
      setNextCursor(res.nextCursor);
    } catch {
      setState('error');
    } finally {
      setLoadingMore(false);
    }
  };

  const dataState =
    state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : invoices.length === 0
          ? 'empty'
          : undefined;

  const header = (
    <div className="ffb-invoices__head">
      <h3 className="ffb-invoices__title">{strings.invoicesHeading}</h3>
      {state === 'ready' && invoices.length > 0 && (
        <span className="ffb-invoices__count" data-invoice-count={invoices.length}>
          {invoices.length} {strings.invoicesShownSuffix}
        </span>
      )}
    </div>
  );

  return (
    <section
      className="ffb-invoices"
      data-panel="invoice-history"
      data-testid="invoice-history-panel"
      {...(dataState ? { 'data-state': dataState } : {})}
      aria-label={strings.invoicesHeading}
      aria-busy={state === 'loading' || undefined}
    >
      <div className="ffb-invoices__seam" aria-hidden="true" />
      {header}

      {state === 'loading' && (
        <div className="ffb-invoices__list" data-testid="invoice-loading">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {state === 'error' && (
        <div className="ffb-invoices__empty" data-error data-testid="invoice-error" role="alert">
          <ErrorIcon />
          <p className="ffb-invoices__empty-title">{strings.invoicesErrorHeading}</p>
          <p className="ffb-invoices__note">{strings.invoicesErrorBody}</p>
          <Button variant="ghost" data-action="retry" onClick={loadFirst}>
            {strings.retry}
          </Button>
        </div>
      )}

      {state === 'ready' && invoices.length === 0 && (
        <div className="ffb-invoices__empty" data-empty data-testid="invoice-empty">
          <DocumentIcon className="ffb-invoices__empty-icon" />
          <p className="ffb-invoices__empty-title">{strings.invoicesEmptyHeading}</p>
          <p className="ffb-invoices__note">{strings.invoicesEmptyBody}</p>
        </div>
      )}

      {state === 'ready' && invoices.length > 0 && (
        <>
          <div className="ffb-invoices__list" data-invoice-list>
            {invoices.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} />
            ))}
          </div>
          {nextCursor && (
            <div className="ffb-invoices__foot">
              <Button
                variant="ghost"
                data-action="load-more"
                onClick={loadMore}
                loading={loadingMore}
                disabled={loadingMore}
              >
                {strings.invoicesLoadMore}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
