require('dotenv').config();
const postgres = require('postgres');

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/hvac_db';

const sql = postgres(connectionString, {
  max: 10, // Maximum number of connections
  idle_timeout: 20,
  connect_timeout: 10,
});

module.exports = { sql };
