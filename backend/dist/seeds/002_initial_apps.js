"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed = seed;
async function seed(knex) {
    // Delete existing entries
    await knex('apps').del();
    // Insert seed entries for apps
    await knex('apps').insert([
        {
            id: 'b2c3d4e5-f6a7-8901-2345-678901bcdef0',
            name: 'Dashboard',
            url: 'http://localhost:5173',
            icon_url: '/icons/dashboard.svg',
            is_active: true,
            integration_type: 'spa',
            description: 'Main platform dashboard providing overview and navigation to all applications.',
            marketplace_metadata: JSON.stringify({
                category: 'core',
                version: '1.0.0',
                author: 'FuzeFront Team',
                permissions: ['dashboard:read'],
            }),
            visibility: 'organization',
            is_marketplace_approved: false,
            install_count: 5,
            rating: 4.8,
            review_count: 3,
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            id: 'c3d4e5f6-a7b8-9012-3456-789012cdef01',
            name: 'Demo External App',
            url: 'https://www.example.com',
            icon_url: '/icons/external.svg',
            is_active: true,
            integration_type: 'iframe',
            description: 'Demo external application to showcase iframe integration capabilities.',
            marketplace_metadata: JSON.stringify({
                category: 'demo',
                version: '1.0.0',
                author: 'External',
                permissions: [],
            }),
            visibility: 'public',
            is_marketplace_approved: true,
            marketplace_approved_at: new Date(),
            install_count: 12,
            rating: 3.5,
            review_count: 8,
            created_at: new Date(),
            updated_at: new Date(),
        },
    ]);
    console.log('✅ Apps seeded successfully');
}
//# sourceMappingURL=002_initial_apps.js.map