#!/usr/bin/env node

/**
 * Database Setup Script for Zero-Vector-3
 * Creates the zerovector3 database and zerovector user
 */

const { Client } = require('pg');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function askPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    let password = '';
    
    process.stdin.on('data', function(char) {
      char = char + '';
      
      switch(char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(password);
          break;
        case '\u0003':
          process.exit();
          break;
        case '\u007f': // backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          password += char;
          process.stdout.write('*');
          break;
      }
    });
  });
}

async function setupDatabase() {
  console.log('🗄️  Zero-Vector-3 Database Setup\n');
  
  try {
    // Get PostgreSQL superuser credentials
    console.log('First, we need your PostgreSQL superuser credentials:');
    const postgresPassword = await askPassword('Enter postgres superuser password: ');
    
    // Get new user credentials
    console.log('\nNow, choose credentials for the zerovector user:');
    const zerovectorPassword = await askPassword('Enter password for zerovector user: ');
    const confirmPassword = await askPassword('Confirm password: ');
    
    if (zerovectorPassword !== confirmPassword) {
      console.error('❌ Passwords do not match!');
      process.exit(1);
    }
    
    console.log('\n🔧 Creating database and user...');
    
    // Connect as postgres superuser
    const client = new Client({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: postgresPassword,
      database: 'postgres'
    });
    
    await client.connect();
    console.log('✅ Connected to PostgreSQL as superuser');
    
    // Check if user already exists
    const userCheck = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'zerovector'"
    );
    
    if (userCheck.rows.length === 0) {
      // Create user
      await client.query(
        `CREATE USER zerovector WITH PASSWORD '${zerovectorPassword}'`
      );
      console.log('✅ Created zerovector user');
    } else {
      // Update password
      await client.query(
        `ALTER USER zerovector WITH PASSWORD '${zerovectorPassword}'`
      );
      console.log('✅ Updated zerovector user password');
    }
    
    // Check if database already exists
    const dbCheck = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'zerovector3'"
    );
    
    if (dbCheck.rows.length === 0) {
      // Create database
      await client.query('CREATE DATABASE zerovector3 OWNER zerovector');
      console.log('✅ Created zerovector3 database');
    } else {
      console.log('✅ zerovector3 database already exists');
    }
    
    // Grant privileges
    await client.query('GRANT ALL PRIVILEGES ON DATABASE zerovector3 TO zerovector');
    console.log('✅ Granted database privileges');
    
    await client.end();
    
    // Connect to new database to grant schema privileges
    const dbClient = new Client({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: postgresPassword,
      database: 'zerovector3'
    });
    
    await dbClient.connect();
    await dbClient.query('GRANT ALL ON SCHEMA public TO zerovector');
    await dbClient.query('GRANT CREATE ON SCHEMA public TO zerovector');
    console.log('✅ Granted schema privileges');
    
    await dbClient.end();
    
    // Test connection with new user
    console.log('\n🧪 Testing connection with zerovector user...');
    const testClient = new Client({
      host: 'localhost',
      port: 5432,
      user: 'zerovector',
      password: zerovectorPassword,
      database: 'zerovector3'
    });
    
    await testClient.connect();
    const result = await testClient.query('SELECT version()');
    console.log('✅ Connection test successful!');
    console.log(`   PostgreSQL version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);
    await testClient.end();
    
    // Update .env file
    console.log('\n📝 Updating .env file...');
    const fs = require('fs');
    const path = require('path');
    
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Update PostgreSQL password
    envContent = envContent.replace(
      /POSTGRES_PASSWORD=.*/,
      `POSTGRES_PASSWORD=${zerovectorPassword}`
    );
    
    // Update PostgreSQL URL
    envContent = envContent.replace(
      /POSTGRES_URL=.*/,
      `POSTGRES_URL=postgresql://zerovector:${zerovectorPassword}@localhost:5432/zerovector3`
    );
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Updated .env file with new credentials');
    
    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   • Database: zerovector3');
    console.log('   • User: zerovector');
    console.log('   • Host: localhost:5432');
    console.log('   • .env file updated');
    
    console.log('\n🚀 Next steps:');
    console.log('   Run: npm run setup:infrastructure');
    
  } catch (error) {
    console.error('\n❌ Database setup failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Troubleshooting:');
      console.error('   • Make sure PostgreSQL is installed and running');
      console.error('   • Check if the postgresql-x64-16 service is started');
      console.error('   • Verify the postgres superuser password is correct');
    }
    
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };
