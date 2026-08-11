import { ProductPolicy } from '../product-policy'

// FuzeFinance consumer product's authorization policy (#490). FuzeFinance is
// hosted as a Module-Federation portal inside FuzeFront (like FuzeMarket) —
// it uses the existing FuzeFront session, so no dedicated Authentik OIDC
// provider is needed; only the Permit resource/role mapping below.
//
// Submitted with BARE keys (Invoice/LedgerEntry/Report/Payout,
// admin/finance-officer). The platform namespaces them to
// fuzefinance.Invoice, …, fuzefinance.admin, … on merge (see
// ../product-policy.ts) so they never collide with the platform's own
// resources/roles or with another product's.
//
// Role intent (Enterprise Pro tier):
//   finance-officer — day-to-day finance operations: create/read/update/send
//                     invoices, record/read ledger entries, read+export
//                     reports, read payouts. Cannot void an invoice or
//                     approve a payout — both move/reverse real money and are
//                     reserved for admin.
//   admin           — full control of every fuzefinance resource within the
//                     tenant, including voiding invoices and approving payouts.
export const fuzefinancePolicy: ProductPolicy = {
  product: 'fuzefinance',
  name: 'FuzeFinance',
  resources: [
    {
      key: 'Invoice',
      name: 'Invoice',
      actions: {
        create: { name: 'Create' },
        read: { name: 'Read' },
        update: { name: 'Update' },
        send: { name: 'Send' },
        void: { name: 'Void' },
      },
    },
    {
      key: 'LedgerEntry',
      name: 'Ledger Entry',
      actions: {
        create: { name: 'Create' },
        read: { name: 'Read' },
        reconcile: { name: 'Reconcile' },
      },
    },
    {
      key: 'Report',
      name: 'Report',
      actions: {
        read: { name: 'Read' },
        export: { name: 'Export' },
      },
    },
    {
      key: 'Payout',
      name: 'Payout',
      actions: {
        read: { name: 'Read' },
        approve: { name: 'Approve' },
      },
    },
  ],
  roles: [
    {
      key: 'finance-officer',
      name: 'Finance Officer',
      permissions: [
        'Invoice:create', 'Invoice:read', 'Invoice:update', 'Invoice:send',
        'LedgerEntry:create', 'LedgerEntry:read', 'LedgerEntry:reconcile',
        'Report:read', 'Report:export',
        'Payout:read',
      ],
    },
    {
      key: 'admin',
      name: 'Admin',
      permissions: [
        'Invoice:create', 'Invoice:read', 'Invoice:update', 'Invoice:send', 'Invoice:void',
        'LedgerEntry:create', 'LedgerEntry:read', 'LedgerEntry:reconcile',
        'Report:read', 'Report:export',
        'Payout:read', 'Payout:approve',
      ],
    },
  ],
}

export default fuzefinancePolicy
