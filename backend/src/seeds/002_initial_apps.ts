import { Knex } from 'knex'

export async function seed(knex: Knex): Promise<void> {
  // Delete existing entries
  await knex('apps').del()

  // Insert seed entries for apps
  await knex('apps').insert([
    {
      id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      name: 'Task Manager',
      url: 'http://localhost:3002',
      icon_url: '/icons/task-manager.svg',
      status: 'active',
      integration_type: 'module_federation',
      description:
        'A comprehensive task management application for organizing and tracking work items.',
      marketplace_metadata: JSON.stringify({
        category: 'productivity',
        version: '1.0.0',
        author: 'FuzeFront Team',
        permissions: ['tasks:read', 'tasks:write', 'tasks:delete'],
        remoteUrl: 'http://localhost:3002/remoteEntry.js',
        scope: 'taskManagerApp',
        module: './TaskManagerApp',
      }),
      visibility: 'organization',
      is_marketplace_approved: false,
      install_count: 0,
      rating: 0.0,
      review_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'b2c3d4e5-f6g7-8901-2345-678901bcdefg',
      name: 'Dashboard',
      url: 'http://localhost:5173',
      icon_url: '/icons/dashboard.svg',
      status: 'active',
      integration_type: 'spa',
      description:
        'Main platform dashboard providing overview and navigation to all applications.',
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
      id: 'c3d4e5f6-g7h8-9012-3456-789012cdefgh',
      name: 'Demo External App',
      url: 'https://www.example.com',
      icon_url: '/icons/external.svg',
      status: 'active',
      integration_type: 'iframe',
      description:
        'Demo external application to showcase iframe integration capabilities.',
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
  ])

  console.log('✅ Apps seeded successfully')
}
