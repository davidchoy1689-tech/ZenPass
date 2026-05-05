const { Pool } = require('pg');

async function tryConnect() {
  // Try pooler connection with empty/default password
  const pool = new Pool({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.pqgrkeavopksdttrzdqc',
    password: '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000
  });

  try {
    const res = await pool.query('SELECT 1 as success');
    console.log('✅ Connected!', res.rows[0]);
    return true;
  } catch (err) {
    console.log('❌ Failed:', err.message);
    
    // Try with service key as password
    console.log('   Retrying with service key...');
    pool.options.password = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3JrZWF2b3Brc2R0dHJ6ZHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwMzQ3OCwiZXhwIjoyMDkzMzc5NDc4fQ.91zpdSB41hXH89hx0zinfCKNEWjVo2-z8IwtvGfqp3o';
    try {
      const res2 = await pool.query('SELECT 1 as success');
      console.log('✅ Connected with service key!', res2.rows[0]);
      return true;
    } catch(err2) {
      console.log('❌ Still failed:', err2.message);
      return false;
    }
  } finally {
    await pool.end();
  }
}

tryConnect().catch(console.error);
