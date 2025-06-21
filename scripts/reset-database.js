const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

/**
 * Database Reset Script
 * Safely drops and recreates the database with proper schema and default data
 */
class DatabaseResetScript {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/vectordb.sqlite');
    this.backupPath = path.join(__dirname, '../data/vectordb_backup_' + Date.now() + '.sqlite');
  }

  async run() {
    console.log('🔄 Starting database reset...');
    
    try {
      // 1. Backup existing database if it exists
      await this.backupDatabase();
      
      // 2. Remove existing database files
      await this.removeExistingDatabase();
      
      // 3. Create fresh database with proper schema
      await this.createFreshDatabase();
      
      // 4. Insert default data
      await this.insertDefaultData();
      
      console.log('✅ Database reset completed successfully!');
      console.log(`📁 Backup saved to: ${this.backupPath}`);
      
    } catch (error) {
      console.error('❌ Database reset failed:', error);
      throw error;
    }
  }

  async backupDatabase() {
    if (fs.existsSync(this.dbPath)) {
      console.log('📦 Creating backup of existing database...');
      fs.copyFileSync(this.dbPath, this.backupPath);
      console.log(`✅ Backup created: ${this.backupPath}`);
    } else {
      console.log('ℹ️  No existing database found, skipping backup');
    }
  }

  async removeExistingDatabase() {
    console.log('🗑️  Removing existing database files...');
    
    const filesToRemove = [
      this.dbPath,
      this.dbPath + '-shm',
      this.dbPath + '-wal'
    ];
    
    for (const file of filesToRemove) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`   Removed: ${path.basename(file)}`);
      }
    }
  }

  async createFreshDatabase() {
    console.log('🏗️  Creating fresh database with enhanced schema...');
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Open new database connection
    const db = new Database(this.dbPath);
    
    try {
      // Enable foreign keys and set performance optimizations
      db.pragma('foreign_keys = ON');
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = 1000000');
      db.pragma('temp_store = memory');
      db.pragma('mmap_size = 268435456'); // 256MB

      // Create all tables
      await this.createTables(db);
      
      // Create indexes
      await this.createIndexes(db);
      
      console.log('✅ Database schema created successfully');
      
    } finally {
      db.close();
    }
  }

  createTables(db) {
    console.log('📋 Creating database tables...');
    
    const tables = [
      // Users table
      `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        last_login INTEGER,
        is_active BOOLEAN DEFAULT 1,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until INTEGER
      )`,

      // Refresh tokens table (for JWT authentication)
      `CREATE TABLE refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Password reset tokens table
      `CREATE TABLE password_reset_tokens (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // API keys table
      `CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL, -- JSON array
        rate_limit INTEGER DEFAULT 1000,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        expires_at INTEGER,
        last_used INTEGER,
        is_active BOOLEAN DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Vector metadata table
      `CREATE TABLE vector_metadata (
        id TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL,
        persona_id TEXT,
        content_type TEXT,
        source TEXT,
        tags TEXT, -- JSON array
        custom_metadata TEXT, -- JSON object
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )`,

      // Personas table
      `CREATE TABLE personas (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        system_prompt TEXT,
        config TEXT, -- JSON object for parameters
        max_memory_size INTEGER DEFAULT 1000,
        memory_decay_time INTEGER DEFAULT 604800000, -- 7 days in ms
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Vector collections table
      `CREATE TABLE vector_collections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        dimensions INTEGER NOT NULL,
        distance_metric TEXT DEFAULT 'cosine',
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Audit log table
      `CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        api_key_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT, -- JSON object
        ip_address TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL
      )`,

      // Enhanced entities table with deterministic IDs
      `CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        vector_id TEXT,
        type TEXT NOT NULL, -- PERSON, CONCEPT, EVENT, OBJECT, PLACE
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL, -- For consistent lookups
        properties TEXT, -- JSON metadata
        confidence REAL DEFAULT 1.0,
        content_hash TEXT, -- For deterministic ID generation
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE,
        FOREIGN KEY (vector_id) REFERENCES vector_metadata (id) ON DELETE SET NULL,
        UNIQUE(persona_id, normalized_name, type) -- Prevent duplicates
      )`,

      // Enhanced relationships table with better constraints
      `CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL, -- MENTIONS, RELATES_TO, FOLLOWS, etc.
        strength REAL DEFAULT 1.0,
        context TEXT,
        properties TEXT, -- JSON metadata
        content_hash TEXT, -- For deterministic processing
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE,
        FOREIGN KEY (source_entity_id) REFERENCES entities (id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities (id) ON DELETE CASCADE,
        UNIQUE(persona_id, source_entity_id, target_entity_id, relationship_type) -- Prevent duplicates
      )`
    ];

    for (const tableSQL of tables) {
      db.exec(tableSQL);
    }
    
    console.log(`✅ Created ${tables.length} tables`);
  }

  createIndexes(db) {
    console.log('📊 Creating database indexes...');
    
    const indexes = [
      // User indexes
      'CREATE INDEX idx_users_email ON users(email)',
      'CREATE INDEX idx_users_created_at ON users(created_at)',
      'CREATE INDEX idx_users_last_login ON users(last_login)',

      // Refresh token indexes
      'CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id)',
      'CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)',

      // API key indexes
      'CREATE INDEX idx_api_keys_user_id ON api_keys(user_id)',
      'CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash)',
      'CREATE INDEX idx_api_keys_created_at ON api_keys(created_at)',
      'CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at)',

      // Vector metadata indexes
      'CREATE INDEX idx_vector_metadata_persona_id ON vector_metadata(persona_id)',
      'CREATE INDEX idx_vector_metadata_content_type ON vector_metadata(content_type)',
      'CREATE INDEX idx_vector_metadata_source ON vector_metadata(source)',
      'CREATE INDEX idx_vector_metadata_created_at ON vector_metadata(created_at)',

      // Persona indexes
      'CREATE INDEX idx_personas_user_id ON personas(user_id)',
      'CREATE INDEX idx_personas_created_at ON personas(created_at)',
      'CREATE INDEX idx_personas_is_active ON personas(is_active)',

      // Vector collection indexes
      'CREATE INDEX idx_vector_collections_user_id ON vector_collections(user_id)',
      'CREATE INDEX idx_vector_collections_created_at ON vector_collections(created_at)',

      // Audit log indexes
      'CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id)',
      'CREATE INDEX idx_audit_logs_api_key_id ON audit_logs(api_key_id)',
      'CREATE INDEX idx_audit_logs_action ON audit_logs(action)',
      'CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at)',

      // Enhanced entity indexes
      'CREATE INDEX idx_entities_persona_id ON entities(persona_id)',
      'CREATE INDEX idx_entities_persona_type ON entities(persona_id, type)',
      'CREATE INDEX idx_entities_vector_id ON entities(vector_id)',
      'CREATE INDEX idx_entities_name ON entities(name)',
      'CREATE INDEX idx_entities_normalized_name ON entities(normalized_name)',
      'CREATE INDEX idx_entities_content_hash ON entities(content_hash)',
      'CREATE INDEX idx_entities_created_at ON entities(created_at)',

      // Enhanced relationship indexes
      'CREATE INDEX idx_relationships_persona_id ON relationships(persona_id)',
      'CREATE INDEX idx_relationships_source_entity ON relationships(source_entity_id)',
      'CREATE INDEX idx_relationships_target_entity ON relationships(target_entity_id)',
      'CREATE INDEX idx_relationships_type ON relationships(relationship_type)',
      'CREATE INDEX idx_relationships_source_target ON relationships(source_entity_id, target_entity_id)',
      'CREATE INDEX idx_relationships_content_hash ON relationships(content_hash)',
      'CREATE INDEX idx_relationships_created_at ON relationships(created_at)'
    ];

    for (const indexSQL of indexes) {
      db.exec(indexSQL);
    }
    
    console.log(`✅ Created ${indexes.length} indexes`);
  }

  async insertDefaultData() {
    console.log('📝 Inserting default data...');
    
    const db = new Database(this.dbPath);
    
    try {
      const now = Date.now();
      
      // Create default user
      const defaultUserId = 'default-user';
      const defaultPasswordHash = await bcrypt.hash('test-password-123', 10);
      
      const insertUser = db.prepare(`
        INSERT INTO users (id, email, password_hash, role, created_at, updated_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertUser.run(
        defaultUserId,
        'test@zero-vector.local',
        defaultPasswordHash,
        'admin',
        now,
        now,
        1
      );
      
      console.log(`✅ Created default user: ${defaultUserId}`);
      
      // Create default API key
      const apiKeyId = uuidv4();
      const apiKeyHash = await bcrypt.hash('test-api-key-123', 10);
      
      const insertApiKey = db.prepare(`
        INSERT INTO api_keys (id, user_id, key_hash, name, permissions, rate_limit, created_at, updated_at, is_active, usage_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertApiKey.run(
        apiKeyId,
        defaultUserId,
        apiKeyHash,
        'Default Test API Key',
        JSON.stringify(['read', 'write', 'admin']),
        10000,
        now,
        now,
        1,
        0
      );
      
      console.log(`✅ Created default API key: ${apiKeyId}`);
      
      // Log creation in audit log
      const auditLogId = uuidv4();
      const insertAuditLog = db.prepare(`
        INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertAuditLog.run(
        auditLogId,
        defaultUserId,
        'DATABASE_RESET',
        'system',
        'database',
        JSON.stringify({
          action: 'fresh_database_created',
          timestamp: now,
          script_version: '1.0.0'
        }),
        now
      );
      
      console.log('✅ Default data insertion completed');
      
    } finally {
      db.close();
    }
  }
}

// Run the script if called directly
if (require.main === module) {
  const resetScript = new DatabaseResetScript();
  resetScript.run()
    .then(() => {
      console.log('🎉 Database reset script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database reset script failed:', error);
      process.exit(1);
    });
}

module.exports = DatabaseResetScript;
