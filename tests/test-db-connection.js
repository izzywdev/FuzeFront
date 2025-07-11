const { Client } = require('pg');

async function testConnection() {
  console.log('🔍 Testing database connection...');
  
  const client = new Client({
    host: 'fuzeinfra-postgres',
    port: 5432,
    database: 'fuzefront_platform',
    user: 'fuzefront_user',
    password: 'FuzeFront_2024_SecureDB_Pass!',
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