import type { CSSProperties } from 'react';
import { Alert, Button, DataTable, StatusPill } from '@fuzefront/design-system';
import { useBillingI18n } from '../../i18n';
import type { PriceBookEntry } from '../../api/portalBillingClient';

export type PriceBookLoadState = 'loading' | 'ready' | 'error';

export interface PriceBookTableProps {
  loadState: PriceBookLoadState;
  prices: PriceBookEntry[];
  onAddPrice: () => void;
  onEditPrice?: (id: string) => void;
  onRetry: () => void;
}

/** The plans a reseller portal sells to its own customers (08-billing). */
export function PriceBookTable({ loadState, prices, onAddPrice, onEditPrice, onRetry }: PriceBookTableProps) {
  const { strings, formatCurrency } = useBillingI18n();

  const columns = [
    { key: 'plan', header: strings.planColumnHeader },
    { key: 'price', header: strings.priceColumnHeader },
    { key: 'status', header: strings.statusColumnHeader },
    { key: 'actions', header: strings.actionsColumnHeader, align: 'right' as const },
  ];

  return (
    <section data-panel="price-book" data-state={loadState === 'error' ? 'error' : undefined}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          marginBlockEnd: 'var(--space-4)',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{strings.priceBookHeading}</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{strings.priceBookSub}</p>
        </div>
        <Button variant="primary" onClick={onAddPrice} data-action="add-price">
          {strings.addPriceAction}
        </Button>
      </div>

      {loadState === 'error' ? (
        <>
          <Alert tone="error" title={strings.priceBookErrorHeading} role="alert">
            {strings.priceBookErrorBody}
          </Alert>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button variant="secondary" onClick={onRetry} data-action="retry">
              {strings.retry}
            </Button>
          </div>
        </>
      ) : (
        <DataTable
          columns={columns}
          loading={loadState === 'loading'}
          emptyState={strings.priceBookEmptyHeading}
        >
          {prices.length > 0 && (
            <tbody>
              {prices.map((p) => (
                <tr key={p.id} data-price={p.id}>
                  <td style={CELL_STYLE}>{p.planName}</td>
                  <td style={{ ...CELL_STYLE, fontFamily: 'var(--font-mono)' }}>
                    {formatCurrency(p.amountCents, p.currency)}
                    {p.interval ? ` / ${p.interval}` : ''}
                  </td>
                  <td style={CELL_STYLE}>
                    <StatusPill status={p.status === 'active' ? 'active' : 'disabled'} data-price-status={p.status} />
                  </td>
                  <td style={{ ...CELL_STYLE, textAlign: 'right' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditPrice?.(p.id)}
                      data-action="edit-price"
                      data-target={p.id}
                    >
                      {strings.editPriceAction}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </DataTable>
      )}
    </section>
  );
}

const CELL_STYLE: CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
};
