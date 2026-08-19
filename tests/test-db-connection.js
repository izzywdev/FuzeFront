const { Client } = require('pg');

async function testConnection() {
  console.log('🔍 Testing database connection...');
  
  if (!process.env.DB_PASSWORD) {
    console.error('❌ DB_PASSWORD must be set in the environment');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST || 'fuzeinfra-postgres',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'fuzefront_platform',
    user: process.env.DB_USER || 'fuzefront_user',
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully!');
    
    const result = await client.query('SELECT 1 as test');
    console.log('✅ Query result:', result.rows[0]);
    
    await client.end();
    console.log('✅ Connection closed');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('Error details:', error);
  }
}

testConnection(); 