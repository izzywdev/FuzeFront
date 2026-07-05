"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fuzemarketPolicy = void 0;
// Worked example: the FuzeMarket consumer product's authorization policy.
//
// FuzeMarket submits this with BARE keys (Listing/Order/Cart, seller/buyer/
// market-admin). The platform namespaces them to fuzemarket.Listing, …,
// fuzemarket.seller, … on merge (see ../product-policy.ts) so they never collide
// with the platform's own resources/roles or with another product's.
//
// Role intent:
//   seller        — manages their own listings + reads orders against them
//   buyer         — browses listings, owns a cart, places/reads their own orders
//   market-admin  — full control of every FuzeMarket resource within the tenant
exports.fuzemarketPolicy = {
    product: 'fuzemarket',
    name: 'FuzeMarket',
    resources: [
        {
            key: 'Listing',
            name: 'Listing',
            actions: {
                create: { name: 'Create' },
                read: { name: 'Read' },
                update: { name: 'Update' },
                delete: { name: 'Delete' },
                publish: { name: 'Publish' },
            },
        },
        {
            key: 'Order',
            name: 'Order',
            actions: {
                create: { name: 'Create' },
                read: { name: 'Read' },
                update: { name: 'Update' },
                cancel: { name: 'Cancel' },
                refund: { name: 'Refund' },
            },
        },
        {
            key: 'Cart',
            name: 'Cart',
            actions: {
                read: { name: 'Read' },
                add_item: { name: 'Add Item' },
                remove_item: { name: 'Remove Item' },
                checkout: { name: 'Checkout' },
            },
        },
    ],
    roles: [
        {
            key: 'seller',
            name: 'Seller',
            permissions: [
                'Listing:create', 'Listing:read', 'Listing:update', 'Listing:delete', 'Listing:publish',
                'Order:read', 'Order:update', 'Order:refund',
            ],
        },
        {
            key: 'buyer',
            name: 'Buyer',
            permissions: [
                'Listing:read',
                'Cart:read', 'Cart:add_item', 'Cart:remove_item', 'Cart:checkout',
                'Order:create', 'Order:read', 'Order:cancel',
            ],
        },
        {
            key: 'market-admin',
            name: 'Market Admin',
            permissions: [
                'Listing:create', 'Listing:read', 'Listing:update', 'Listing:delete', 'Listing:publish',
                'Order:create', 'Order:read', 'Order:update', 'Order:cancel', 'Order:refund',
                'Cart:read', 'Cart:add_item', 'Cart:remove_item', 'Cart:checkout',
            ],
        },
    ],
};
exports.default = exports.fuzemarketPolicy;
//# sourceMappingURL=fuzemarket.policy.js.map