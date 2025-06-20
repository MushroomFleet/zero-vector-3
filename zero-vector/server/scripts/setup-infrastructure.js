#!/usr/bin/env node

/**
 * Infrastructure Setup Script
 * Sets up Redis, PostgreSQL, and initializes all services for zero-vector-3
 * Implements setup procedures from LangGraph-DEV-HANDOFF.md
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const serviceManager = require('../src/services/ServiceManager');
const { logger, logError } = require('../src/utils/logger');

async function setupInfrastructure() {
  console.log('🚀 Starting Zero-Vector-3 Infrastructure Setup...\n');

  try {
    // 1. Test environment variables
    console.log('📋 Checking environment configuration...');
    await checkEnvironmentVariables();
    
    // 2. Initialize all services
    console.log('🔧 Initializing services...');
    await serviceManager.initialize();
    
    // 3. Verify setup
    console.log('🔍 Verifying setup...');
    await verifySetup();
    
    // 4. Show status
    console.log('📊 Getting system status...');
    await showSystemStatus();
    
    console.log('\n✅ Infrastructure setup completed successfully!');
    console.log('🎯 Zero-Vector-3 is ready for LangGraph integration.');
    
  } catch (error) {
    console.error('\n❌ Infrastructure setup failed:', error.message);
    logError(error, { operation: 'infrastructure_setup' });
    process.exit(1);
  } finally {
    // Cleanup
    await serviceManager.shutdown();
    process.exit(0);
  }
}

async function checkEnvironmentVariables() {
  const requiredVars = [
    'OPENAI_API_KEY',
    'POSTGRES_PASSWORD',
    'JWT_SECRET',
    'API_KEY_SECRET'
  ];

  const optionalVars = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER', 
    'POSTGRES_DATABASE',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD'
  ];

  console.log('  Required variables:');
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
    console.log(`    ✓ ${varName}: ${value.substring(0, 10)}...`);
  }

  console.log('  Optional variables:');
  for (const varName of optionalVars) {
    const value = process.env[varName];
    if (value) {
      console.log(`    ✓ ${varName}: ${value}`);
    } else {
      console.log(`    - ${varName}: using default`);
    }
  }
  
  console.log('  ✅ Environment configuration OK\n');
}

async function verifySetup() {
  // Test Redis connection
  console.log('  Testing Redis connection...');
  const redisManager = serviceManager.getService('redis');
  const redisHealth = await redisManager.performHealthCheck();
  if (!redisHealth) {
    throw new Error('Redis health check failed');
  }
  console.log('    ✓ Redis connection OK');

  // Test PostgreSQL connection
  console.log('  Testing PostgreSQL connection...');
  const postgresManager = serviceManager.getService('postgres');
  const postgresHealth = await postgresManager.getHealthInfo();
  if (!postgresHealth.healthy) {
    throw new Error('PostgreSQL health check failed');
  }
  console.log('    ✓ PostgreSQL connection OK');
  console.log(`    ✓ Database: ${postgresHealth.database_name || 'zerovector3'}`);
  if (postgresHealth.postgres_version) {
    console.log(`    ✓ Version: ${postgresHealth.postgres_version.split(' ')[0]}`);
  } else {
    console.log(`    ✓ Version: PostgreSQL (connected)`);
  }

  // Test cache functionality
  console.log('  Testing cache functionality...');
  const cacheManager = serviceManager.getService('cache');
  await cacheManager.cacheEmbedding('test', [0.1, 0.2, 0.3], { provider: 'test' });
  const cached = await cacheManager.getCachedEmbedding('test', { provider: 'test' });
  if (!cached || !cached.cached) {
    throw new Error('Cache functionality test failed');
  }
  console.log('    ✓ Cache functionality OK');

  // Test approval service
  console.log('  Testing approval service...');
  const approvalService = serviceManager.getService('approval');
  const stats = approvalService.getStats();
  console.log(`    ✓ Approval service OK (pending: ${stats.pendingRequests})`);

  console.log('  ✅ All services verified\n');
}

async function showSystemStatus() {
  try {
    const health = await serviceManager.getHealthStatus();
    const metrics = await serviceManager.getPerformanceMetrics();

    console.log(`  Overall Health: ${getHealthEmoji(health.overall)} ${health.overall.toUpperCase()}`);
    console.log(`  Services: ${health.serviceCount} initialized`);
    
    console.log('\n  Service Details:');
    for (const [serviceName, serviceHealth] of Object.entries(health.services)) {
      const emoji = getHealthEmoji(serviceHealth.status);
      console.log(`    ${emoji} ${serviceName}: ${serviceHealth.status}`);
      
      if (serviceHealth.stats && serviceName === 'cache') {
        console.log(`      - Hit rate: ${(serviceHealth.stats.hit_rate * 100).toFixed(1)}%`);
        console.log(`      - Cache size: ${serviceHealth.stats.lru_cache_size} items`);
      }
      
      if (serviceHealth.stats && serviceName === 'approval') {
        console.log(`      - Total requests: ${serviceHealth.stats.totalRequests}`);
        console.log(`      - Pending: ${serviceHealth.stats.pendingRequests}`);
      }
      
      if (serviceHealth.metrics && serviceName === 'redis') {
        const conn = serviceHealth.metrics.connection;
        console.log(`      - Connected: ${conn.connected}`);
        console.log(`      - Total connections: ${conn.total_connections}`);
      }
      
      if (serviceHealth.metrics && serviceName === 'postgres') {
        const pool = serviceHealth.metrics.pool_stats;
        console.log(`      - Pool: ${pool.idleCount}/${pool.totalCount} connections`);
      }
    }

    console.log('\n  Ready for:');
    console.log('    🤖 LangGraph agent orchestration');
    console.log('    💾 High-performance caching');
    console.log('    👥 Human-in-the-loop workflows');
    console.log('    🔍 Hybrid vector-graph search');
    console.log('    📊 Performance monitoring');

  } catch (error) {
    console.log('  ⚠️  Could not retrieve detailed status:', error.message);
  }
}

function getHealthEmoji(status) {
  switch (status) {
    case 'healthy': return '✅';
    case 'degraded': return '⚠️';
    case 'unhealthy': return '❌';
    default: return '❓';
  }
}

// Run setup if called directly
if (require.main === module) {
  setupInfrastructure();
}

module.exports = {
  setupInfrastructure,
  checkEnvironmentVariables,
  verifySetup,
  showSystemStatus
};
