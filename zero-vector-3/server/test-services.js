#!/usr/bin/env node

const net = require('net');

async function testConnection(host, port, serviceName) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 3000;

    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      console.log(`✅ ${serviceName} is running on ${host}:${port}`);
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      console.log(`❌ ${serviceName} connection timeout on ${host}:${port}`);
      socket.destroy();
      resolve(false);
    });

    socket.on('error', (err) => {
      console.log(`❌ ${serviceName} is not running on ${host}:${port} - ${err.message}`);
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function main() {
  console.log('🔍 Testing required services...\n');
  
  const postgresRunning = await testConnection('localhost', 5432, 'PostgreSQL');
  const redisRunning = await testConnection('localhost', 6379, 'Redis');
  
  console.log('\n📋 Service Status Summary:');
  console.log(`PostgreSQL: ${postgresRunning ? '✅ Running' : '❌ Not Running'}`);
  console.log(`Redis: ${redisRunning ? '✅ Running' : '❌ Not Running'}`);
  
  if (!postgresRunning || !redisRunning) {
    console.log('\n⚠️  Infrastructure setup requires both PostgreSQL and Redis to be running.');
    console.log('\nTo start these services:');
    if (!postgresRunning) {
      console.log('- PostgreSQL: Install and start PostgreSQL server');
      console.log('  - Windows: Download from https://www.postgresql.org/download/windows/');
      console.log('  - Or use Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password123 -e POSTGRES_USER=zerovector -e POSTGRES_DB=zerovector3 postgres:15');
    }
    if (!redisRunning) {
      console.log('- Redis: Install and start Redis server');
      console.log('  - Windows: Download from https://github.com/microsoftarchive/redis/releases');
      console.log('  - Or use Docker: docker run -d -p 6379:6379 redis:7-alpine');
    }
    process.exit(1);
  } else {
    console.log('\n🎉 All required services are running! You can now run the infrastructure setup.');
  }
}

main().catch(console.error);
