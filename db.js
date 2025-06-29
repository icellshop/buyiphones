const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:TUcQNxKcsBRfznNAksETYtqICORsnUBu@gondola.proxy.rlwy.net:18882/railway',
  ssl: { rejectUnauthorized: false } // Railway necesita SSL
});

module.exports = pool;