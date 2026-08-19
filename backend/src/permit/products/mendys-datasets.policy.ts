import { ProductPolicy } from '../product-policy'

// The MendysRobotics datasets-marketplace consumer product's authorization
// policy (product key `mendys-datasets` — the same key allowlisted for
// billing-service payment-mode checkout via BILLING_PRODUCT_KEYS).
//
// Submitted with BARE keys (Dataset/TalentProfile/Order/Equipment/Report,
// talent/buyer/admin). The platform namespaces them to
// mendys-datasets.Dataset, …, mendys-datasets.talent, … on merge (see
// ../product-policy.ts) so they never collide with the platform's own
// resources/roles or with another product's.
//
// Role intent:
//   talent — records/curates datasets and manages their own talent profile
//   buyer  — browses datasets, places/reads/checks-out/cancels their orders,
//            reads the equipment catalogue
//   admin  — full control of every mendys-datasets resource within the tenant
export const mendysDatasetsPolicy: ProductPolicy = {
  product: 'mendys-datasets',
  name: 'MendysRobotics Datasets',
  resources: [
    {
      key: 'Dataset',
      name: 'Dataset',
      actions: {
        create: { name: 'Create' },
        read: { name: 'Read' },
        update: { name: 'Update' },
        publish: { name: 'Publish' },
        archive: { name: 'Archive' },
      },
    },
    {
      key: 'TalentProfile',
      name: 'Talent Profile',
      actions: {
        create: { name: 'Create' },
        read: { name: 'Read' },
        update: { name: 'Update' },
        approve: { name: 'Approve' },
        suspend: { name: 'Suspend' },
      },
    },
    {
      key: 'Order',
      name: 'Order',
      actions: {
        create: { name: 'Create' },
        read: { name: 'Read' },
        update: { name: 'Update' },
        checkout: { name: 'Checkout' },
        cancel: { name: 'Cancel' },
        manage: { name: 'Manage' },
      },
    },
    {
      key: 'Equipment',
      name: 'Equipment',
      actions: {
        read: { name: 'Read' },
        manage: { name: 'Manage' },
      },
    },
    {
      key: 'Report',
      name: 'Report',
      actions: {
        read: { name: 'Read' },
      },
    },
  ],
  roles: [
    {
      key: 'talent',
      name: 'Talent',
      permissions: [
        'Dataset:create', 'Dataset:read', 'Dataset:update',
        'TalentProfile:create', 'TalentProfile:read', 'TalentProfile:update',
      ],
    },
    {
      key: 'buyer',
      name: 'Buyer',
      permissions: [
        'Dataset:read',
        'Order:create', 'Order:read', 'Order:checkout', 'Order:cancel',
        'Equipment:read',
      ],
    },
    {
      key: 'admin',
      name: 'Admin',
      permissions: [
        'Dataset:create', 'Dataset:read', 'Dataset:update', 'Dataset:publish', 'Dataset:archive',
        'TalentProfile:create', 'TalentProfile:read', 'TalentProfile:update', 'TalentProfile:approve', 'TalentProfile:suspend',
        'Order:create', 'Order:read', 'Order:update', 'Order:checkout', 'Order:cancel', 'Order:manage',
        'Equipment:read', 'Equipment:manage',
        'Report:read',
      ],
    },
  ],
}

export default mendysDatasetsPolicy
