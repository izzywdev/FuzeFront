'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.seed = seed
async function seed(knex) {
  // Delete existing entries
  await knex('apps').del()
  // Insert seed entries for apps
  await knex('apps').insert([
    {
      id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      name: 'Task Manager',
      url: 'http://localhost:3002',
      icon_url: '/icons/task-manager.svg',
      is_active: true,
      integration_type: 'module_federation',
      remote_url: 'http://localhost:3002/remoteEntry.js',
      scope: 'taskManagerApp',
      module: './TaskManagerApp',
      description:
        'A comprehensive task management application for organizing and tracking work items.',
      metadata: JSON.stringify({
        category: 'productivity',
        version: '1.0.0',
        author: 'FuzeFront Team',
        permissions: ['tasks:read', 'tasks:write', 'tasks:delete'],
      }),
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'b2c3d4e5-f6g7-8901-2345-678901bcdefg',
      name: 'Dashboard',
      url: 'http://localhost:5173',
      icon_url: '/icons/dashboard.svg',
      is_active: true,
      integration_type: 'spa',
      description:
        'Main platform dashboard providing overview and navigation to all applications.',
      metadata: JSON.stringify({
        category: 'core',
        version: '1.0.0',
        author: 'FuzeFront Team',
        permissions: ['dashboard:read'],
      }),
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'c3d4e5f6-g7h8-9012-3456-789012cdefgh',
      name: 'Demo External App',
      url: 'https://www.example.com',
      icon_url: '/icons/external.svg',
      is_active: true,
      integration_type: 'iframe',
      description:
        'Demo external application to showcase iframe integration capabilities.',
      metadata: JSON.stringify({
        category: 'demo',
        version: '1.0.0',
        author: 'External',
        permissions: [],
      }),
      created_at: new Date(),
      updated_at: new Date(),
    },
  ])
  console.log('✅ Apps seeded successfully')
}
//# sourceMappingURL=002_initial_apps.js.map
