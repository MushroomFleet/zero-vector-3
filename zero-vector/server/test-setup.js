#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testSetup() {
  console.log('🧪 Testing individual components...\n');

  // Test 1: Redis Connection
  console.log('1. Testing Redis...');
  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: 'localhost',
      port: 6379,
      lazyConnect: false,
      enableOfflineQueue: true,
      connectTimeout: 5000,
      commandTimeout: 3000
    });

    await new Promise((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
      setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
    });

    const result = await redis.ping();
    console.log(`   ✅ Redis: ${result}`);
    await redis.quit();
  } catch (error) {
    console.log(`   ❌ Redis: ${error.message}`);
  }

  // Test 2: PostgreSQL Connection
  console.log('2. Testing PostgreSQL...');
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT) || 5432,
      user: process.env.POSTGRES_USER || 'zerovector',
      password: process.env.POSTGRES_PASSWORD || '',
      database: process.env.POSTGRES_DATABASE || 'zerovector3'
    });

    const result = await pool.query('SELECT NOW() as current_time');
    console.log(`   ✅ PostgreSQL: Connected at ${result.rows[0].current_time}`);
    await pool.end();
  } catch (error) {
    console.log(`   ❌ PostgreSQL: ${error.message}`);
  }

  // Test 3: Configuration Loading
  console.log('3. Testing Configuration...');
  try {
    const config = require('./src/config');
    console.log(`   ✅ Config loaded`);
    console.log(`   - Redis host: ${config.redis.host}:${config.redis.port}`);
    console.log(`   - PostgreSQL host: ${config.database.postgres.host}:${config.database.postgres.port}`);
    console.log(`   - Risk thresholds: ${JSON.stringify(config.humanInTheLoop.risk_thresholds)}`);
  } catch (error) {
    console.log(`   ❌ Config: ${error.message}`);
  }

  console.log('\n🏁 Test completed');
  process.exit(0);
}

testSetup().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
