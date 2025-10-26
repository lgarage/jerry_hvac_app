require('dotenv').config();
const postgres = require('postgres');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const sql = postgres(connectionString, {
  ssl: 'require',
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10
});

// Test connection
async function testConnection() {
  try {
    const result = await sql`SELECT NOW()`;
    console.log('✓ Database connected successfully');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    return false;
  }
}

module.exports = { sql, testConnection };
