const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const config = require('../config');

/**
 * Database Repository
 * Handles all database operations using better-sqlite3
 */
class DatabaseRepository {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize database connection and create tables
   */
  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(config.database.path);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Open database connection
      this.db = new Database(config.database.path);
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      // Set performance optimizations
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 1000000');
      this.db.pragma('temp_store = memory');
      this.db.pragma('mmap_size = 268435456'); // 256MB

      await this.createTables();
      await this.createIndexes();

      this.isInitialized = true;
      logger.info('Database initialized successfully', {
        path: config.database.path,
        mode: this.db.readonly ? 'readonly' : 'readwrite'
      });

    } catch (error) {
      logger.error('Database initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Create all database tables
   */
  async createTables() {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
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
      `CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Password reset tokens table
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // API keys table (updated to reference users)
      `CREATE TABLE IF NOT EXISTS api_keys (
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
      `CREATE TABLE IF NOT EXISTS vector_metadata (
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
      `CREATE TABLE IF NOT EXISTS personas (
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

      // Vector collections table (for organizing vectors)
      `CREATE TABLE IF NOT EXISTS vector_collections (
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
      `CREATE TABLE IF NOT EXISTS audit_logs (
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

      // Entities table (for knowledge graph)
      `CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        vector_id TEXT,
        type TEXT NOT NULL, -- PERSON, CONCEPT, EVENT, OBJECT, PLACE
        name TEXT NOT NULL,
        normalized_name TEXT,
        properties TEXT, -- JSON metadata
        confidence REAL DEFAULT 1.0,
        content_hash TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE,
        FOREIGN KEY (vector_id) REFERENCES vector_metadata (id) ON DELETE SET NULL
      )`,

      // Relationships table (for knowledge graph)
      `CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL, -- MENTIONS, RELATES_TO, FOLLOWS, etc.
        strength REAL DEFAULT 1.0,
        context TEXT,
        properties TEXT, -- JSON metadata
        content_hash TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(persona_id, source_entity_id, target_entity_id, relationship_type),
        FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE,
        FOREIGN KEY (source_entity_id) REFERENCES entities (id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities (id) ON DELETE CASCADE
      )`
    ];

    for (const tableSQL of tables) {
      this.db.exec(tableSQL);
    }

    // Handle schema migrations after tables are created
    await this.handleSchemaMigrations();

    logger.info('Database tables created successfully');
  }

  /**
   * Handle schema migrations for existing tables
   */
  async handleSchemaMigrations() {
    // Temporarily disable foreign key constraints during migration
    this.db.pragma('foreign_keys = OFF');
    
    // Check if personas table exists and needs migration
    const personasTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='personas'").all();
    
    if (personasTables.length > 0) {
      // Check current schema
      const schema = this.db.prepare("PRAGMA table_info(personas)").all();
      const columns = schema.map(col => col.name);
      
      logger.info('Found existing personas table with columns:', { columns });
      
      // Check if user_id column is missing
      if (!columns.includes('user_id')) {
        logger.info('Migrating personas table: adding user_id column');
        
        // Since SQLite doesn't support adding foreign key columns easily,
        // we'll recreate the table with the new schema
        this.db.exec('ALTER TABLE personas RENAME TO personas_old');
        
        // Create new personas table with correct schema
        this.db.exec(`
          CREATE TABLE personas (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'default-user',
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
          )
        `);
        
        // Copy data from old table, mapping old columns to new ones
        this.db.exec(`
          INSERT INTO personas (
            id, user_id, name, description, system_prompt, config, 
            max_memory_size, memory_decay_time, created_at, updated_at, is_active
          )
          SELECT 
            id, 
            'default-user' as user_id,
            name, 
            description, 
            system_prompt, 
            COALESCE(parameters, '{}') as config,
            max_memory_size, 
            memory_decay_time, 
            created_at, 
            updated_at, 
            is_active
          FROM personas_old
        `);
        
        // Drop old table
        this.db.exec('DROP TABLE personas_old');
        
        logger.info('Personas table migration completed');
      }
    }

    // Check if api_keys table exists and needs migration
    const apiKeysTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").all();
    
    if (apiKeysTables.length > 0) {
      // Check current schema
      const schema = this.db.prepare("PRAGMA table_info(api_keys)").all();
      const columns = schema.map(col => col.name);
      
      logger.info('Found existing api_keys table with columns:', { columns });
      
      // Check if name column is missing or user_id column is missing
      if (!columns.includes('name') || !columns.includes('user_id')) {
        logger.info('Migrating api_keys table: updating schema');
        
        // Recreate the table with the new schema
        this.db.exec('ALTER TABLE api_keys RENAME TO api_keys_old');
        
        // Create new api_keys table with correct schema
        this.db.exec(`
          CREATE TABLE api_keys (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'default-user',
            key_hash TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT 'Legacy API Key',
            permissions TEXT NOT NULL, -- JSON array
            rate_limit INTEGER DEFAULT 1000,
            created_at INTEGER NOT NULL,
            updated_at INTEGER,
            expires_at INTEGER,
            last_used INTEGER,
            is_active BOOLEAN DEFAULT 1,
            usage_count INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )
        `);
        
        // Copy data from old table, mapping old columns to new ones
        // Build select clause based on available columns
        const selectFields = [
          'id',
          columns.includes('user_id') ? 'user_id' : "'default-user' as user_id",
          'key_hash',
          columns.includes('name') ? 'name' : 
            (columns.includes('description') ? 'COALESCE(description, \'Legacy API Key\') as name' : "'Legacy API Key' as name"),
          columns.includes('permissions') ? 'permissions' : "'[\"read\",\"write\"]' as permissions",
          columns.includes('rate_limit') ? 'rate_limit' : '1000 as rate_limit',
          'created_at',
          columns.includes('updated_at') ? 'updated_at' : 'created_at as updated_at',
          columns.includes('expires_at') ? 'expires_at' : 'NULL as expires_at',
          columns.includes('last_used') ? 'last_used' : 'NULL as last_used',
          columns.includes('is_active') ? 'is_active' : '1 as is_active',
          columns.includes('usage_count') ? 'usage_count' : '0 as usage_count'
        ];
        
        let insertQuery = `
          INSERT INTO api_keys (
            id, user_id, key_hash, name, permissions, rate_limit, 
            created_at, updated_at, expires_at, last_used, is_active, usage_count
          )
          SELECT 
            ${selectFields.join(',\n            ')}
          FROM api_keys_old
        `;
        
        this.db.exec(insertQuery);
        
        // Drop old table
        this.db.exec('DROP TABLE api_keys_old');
        
        logger.info('API keys table migration completed');
      }
    }
    
    // Re-enable foreign key constraints after migration
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * Create database indexes for performance
   */
  async createIndexes() {
    const indexes = [
      // User indexes
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login)',

      // Refresh token indexes
      'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)',

      // API key indexes
      'CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)',
      'CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at)',

      // Vector metadata indexes
      'CREATE INDEX IF NOT EXISTS idx_vector_metadata_persona_id ON vector_metadata(persona_id)',
      'CREATE INDEX IF NOT EXISTS idx_vector_metadata_content_type ON vector_metadata(content_type)',
      'CREATE INDEX IF NOT EXISTS idx_vector_metadata_source ON vector_metadata(source)',
      'CREATE INDEX IF NOT EXISTS idx_vector_metadata_created_at ON vector_metadata(created_at)',

      // Persona indexes
      'CREATE INDEX IF NOT EXISTS idx_personas_user_id ON personas(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_personas_created_at ON personas(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_personas_is_active ON personas(is_active)',

      // Vector collection indexes
      'CREATE INDEX IF NOT EXISTS idx_vector_collections_user_id ON vector_collections(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_vector_collections_created_at ON vector_collections(created_at)',

      // Audit log indexes
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_api_key_id ON audit_logs(api_key_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)',

      // Entity indexes (for knowledge graph)
      'CREATE INDEX IF NOT EXISTS idx_entities_persona_id ON entities(persona_id)',
      'CREATE INDEX IF NOT EXISTS idx_entities_persona_type ON entities(persona_id, type)',
      'CREATE INDEX IF NOT EXISTS idx_entities_vector_id ON entities(vector_id)',
      'CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)',
      'CREATE INDEX IF NOT EXISTS idx_entities_created_at ON entities(created_at)',

      // Relationship indexes (for knowledge graph)
      'CREATE INDEX IF NOT EXISTS idx_relationships_persona_id ON relationships(persona_id)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_source_entity ON relationships(source_entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_target_entity ON relationships(target_entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relationship_type)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_source_target ON relationships(source_entity_id, target_entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_created_at ON relationships(created_at)'
    ];

    for (let i = 0; i < indexes.length; i++) {
      const indexSQL = indexes[i];
      try {
        logger.info(`Creating index ${i + 1}/${indexes.length}: ${indexSQL}`);
        this.db.exec(indexSQL);
      } catch (error) {
        logger.error(`Failed to create index: ${indexSQL}`, { error: error.message });
        throw error;
      }
    }

    logger.info('Database indexes created successfully');
  }

  /**
   * User Management Methods
   */

  // Insert new user
  async insertUser(userData) {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, role, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    return stmt.run(
      userData.id,
      userData.email,
      userData.passwordHash,
      userData.role || 'user',
      now,
      now,
      userData.isActive !== false ? 1 : 0
    );
  }

  // Get user by email
  async getUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1');
    return stmt.get(email);
  }

  // Get user by ID
  async getUserById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');
    return stmt.get(id);
  }

  // Update user
  async updateUser(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  // Update failed login attempts
  async updateFailedLoginAttempts(email, attempts, lockUntil = null) {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
      WHERE email = ?
    `);
    return stmt.run(attempts, lockUntil, Date.now(), email);
  }

  // Update last login
  async updateLastLogin(id) {
    const stmt = this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?');
    const now = Date.now();
    return stmt.run(now, now, id);
  }

  /**
   * Refresh Token Methods
   */

  // Insert refresh token
  async insertRefreshToken(tokenData) {
    const stmt = this.db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, last_used)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    return stmt.run(
      tokenData.id,
      tokenData.userId,
      tokenData.token,
      tokenData.expiresAt,
      now,
      now
    );
  }

  // Get refresh token
  async getRefreshToken(token) {
    const stmt = this.db.prepare('SELECT * FROM refresh_tokens WHERE token = ?');
    return stmt.get(token);
  }

  // Update refresh token last used
  async updateRefreshTokenLastUsed(id) {
    const stmt = this.db.prepare('UPDATE refresh_tokens SET last_used = ? WHERE id = ?');
    return stmt.run(Date.now(), id);
  }

  // Delete refresh token
  async deleteRefreshToken(token) {
    const stmt = this.db.prepare('DELETE FROM refresh_tokens WHERE token = ?');
    return stmt.run(token);
  }

  // Delete all user refresh tokens
  async deleteAllUserRefreshTokens(userId) {
    const stmt = this.db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?');
    return stmt.run(userId);
  }

  // Cleanup expired refresh tokens
  async cleanupExpiredRefreshTokens() {
    const stmt = this.db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?');
    return stmt.run(Date.now());
  }

  /**
   * API Key Methods
   */

  // Insert API key
  async insertApiKey(keyData) {
    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, user_id, key_hash, name, permissions, rate_limit, created_at, updated_at, expires_at, is_active, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    return stmt.run(
      keyData.id,
      keyData.userId,
      keyData.keyHash,
      keyData.name,
      JSON.stringify(keyData.permissions),
      keyData.rateLimit || 1000,
      now,
      now,
      keyData.expiresAt,
      keyData.isActive !== false ? 1 : 0,
      0
    );
  }

  // Get API key by hash
  async getApiKeyByHash(keyHash) {
    const stmt = this.db.prepare(`
      SELECT ak.*, u.email, u.role as user_role
      FROM api_keys ak
      JOIN users u ON ak.user_id = u.id
      WHERE ak.key_hash = ? AND ak.is_active = 1 AND u.is_active = 1
      AND (ak.expires_at IS NULL OR ak.expires_at > ?)
    `);
    const result = stmt.get(keyHash, Date.now());
    
    if (result && result.permissions) {
      result.permissions = JSON.parse(result.permissions);
    }
    
    return result;
  }

  // List user API keys
  async listApiKeys(userId, includeInactive = false) {
    const whereClause = includeInactive ? 'user_id = ?' : 'user_id = ? AND is_active = 1';
    const stmt = this.db.prepare(`
      SELECT id, user_id, name, permissions, rate_limit, created_at, updated_at, expires_at, last_used, is_active, usage_count
      FROM api_keys 
      WHERE ${whereClause}
      ORDER BY created_at DESC
    `);
    
    const results = stmt.all(userId);
    return results.map(key => ({
      ...key,
      permissions: JSON.parse(key.permissions)
    }));
  }

  // Update API key
  async updateApiKey(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'key_hash') {
        if (key === 'permissions') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  // Update API key last used
  async updateApiKeyLastUsed(id) {
    const stmt = this.db.prepare(`
      UPDATE api_keys 
      SET last_used = ?, usage_count = usage_count + 1, updated_at = ?
      WHERE id = ?
    `);
    const now = Date.now();
    return stmt.run(now, now, id);
  }

  // Delete API key
  async deleteApiKey(id) {
    const stmt = this.db.prepare('DELETE FROM api_keys WHERE id = ?');
    return stmt.run(id);
  }

  /**
   * Vector Metadata Methods
   */

  // Find vector metadata by ID
  async findVectorMetadataById(id) {
    const stmt = this.db.prepare('SELECT * FROM vector_metadata WHERE id = ?');
    const result = stmt.get(id);
    
    if (result) {
      result.tags = JSON.parse(result.tags);
      result.customMetadata = JSON.parse(result.custom_metadata);
    }
    
    return result;
  }

  // Insert vector metadata
  async insertVectorMetadata(metadata) {
    try {
      // First check if vector metadata with this ID already exists
      const existing = await this.findVectorMetadataById(metadata.id);
      if (existing) {
        logger.warn('Vector metadata with this ID already exists, returning existing record', {
          service: 'zero-vector-server',
          version: '1.0.0',
          vectorId: metadata.id,
          personaId: metadata.personaId
        });
        return existing;
      }

      const stmt = this.db.prepare(`
        INSERT INTO vector_metadata (id, dimensions, persona_id, content_type, source, tags, custom_metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      const result = stmt.run(
        metadata.id,
        metadata.dimensions,
        metadata.personaId,
        metadata.contentType,
        metadata.source,
        JSON.stringify(metadata.tags || []),
        JSON.stringify(metadata.customMetadata || {}),
        now,
        now
      );

      logger.info('Vector metadata inserted successfully', {
        service: 'zero-vector-server',
        version: '1.0.0',
        vectorId: metadata.id,
        personaId: metadata.personaId,
        dimensions: metadata.dimensions
      });

      return result;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && error.message.includes('vector_metadata.id')) {
        logger.warn('UNIQUE constraint violation, finding existing vector metadata', {
          service: 'zero-vector-server',
          version: '1.0.0',
          vectorId: metadata.id,
          personaId: metadata.personaId,
          error: error.message
        });

        // Find and return the existing record
        const existing = await this.findVectorMetadataById(metadata.id);
        if (existing) {
          logger.info('Found existing vector metadata after UNIQUE constraint violation', {
            service: 'zero-vector-server',
            version: '1.0.0',
            vectorId: existing.id,
            personaId: existing.persona_id
          });
          return existing;
        }
      }

      logger.error('Failed to insert vector metadata', {
        service: 'zero-vector-server',
        version: '1.0.0',
        vectorId: metadata.id,
        personaId: metadata.personaId,
        error: error.message
      });
      throw error;
    }
  }

  // Get vector metadata
  async getVectorMetadata(id) {
    const stmt = this.db.prepare('SELECT * FROM vector_metadata WHERE id = ?');
    const result = stmt.get(id);
    
    if (result) {
      result.tags = JSON.parse(result.tags);
      result.customMetadata = JSON.parse(result.custom_metadata);
    }
    
    return result;
  }

  // Update vector metadata
  async updateVectorMetadata(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id') {
        if (key === 'tags' || key === 'customMetadata') {
          const dbKey = key === 'customMetadata' ? 'custom_metadata' : key;
          fields.push(`${dbKey} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`UPDATE vector_metadata SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  // Delete vector metadata
  async deleteVectorMetadata(id) {
    const stmt = this.db.prepare('DELETE FROM vector_metadata WHERE id = ?');
    return stmt.run(id);
  }

  // Search vector metadata
  async searchVectorMetadata(filters = {}) {
    let query = 'SELECT * FROM vector_metadata WHERE 1=1';
    const params = [];

    if (filters.personaId) {
      query += ' AND persona_id = ?';
      params.push(filters.personaId);
    }

    if (filters.contentType) {
      query += ' AND content_type = ?';
      params.push(filters.contentType);
    }

    if (filters.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }

    // ORDER BY must come before LIMIT in SQL
    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    return results.map(result => ({
      ...result,
      tags: JSON.parse(result.tags),
      customMetadata: JSON.parse(result.custom_metadata)
    }));
  }

  /**
   * Persona Methods
   */

  // Insert persona
  async insertPersona(personaData) {
    const stmt = this.db.prepare(`
      INSERT INTO personas (id, user_id, name, description, system_prompt, config, max_memory_size, memory_decay_time, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    return stmt.run(
      personaData.id,
      personaData.userId,
      personaData.name,
      personaData.description,
      personaData.systemPrompt,
      JSON.stringify(personaData.config || {}),
      personaData.maxMemorySize || 1000,
      personaData.memoryDecayTime || 604800000,
      now,
      now,
      personaData.isActive !== false ? 1 : 0
    );
  }

  // Get persona by ID
  async getPersonaById(id) {
    const stmt = this.db.prepare('SELECT * FROM personas WHERE id = ? AND is_active = 1');
    const result = stmt.get(id);
    
    if (result && result.config) {
      result.config = JSON.parse(result.config);
    }
    
    return result;
  }

  // List user personas
  async listPersonas(userId, includeInactive = false) {
    const whereClause = includeInactive ? 'user_id = ?' : 'user_id = ? AND is_active = 1';
    const stmt = this.db.prepare(`
      SELECT * FROM personas 
      WHERE ${whereClause}
      ORDER BY created_at DESC
    `);
    
    const results = stmt.all(userId);
    return results.map(persona => ({
      ...persona,
      config: JSON.parse(persona.config)
    }));
  }

  // Update persona
  async updatePersona(id, updates) {
    const fields = [];
    const values = [];
    
    // Map camelCase API fields to snake_case database columns
    const fieldMapping = {
      'systemPrompt': 'system_prompt',
      'maxMemorySize': 'max_memory_size',
      'memoryDecayTime': 'memory_decay_time'
    };
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id') {
        // Get the database column name (either mapped or original)
        const dbField = fieldMapping[key] || key;
        
        if (key === 'config') {
          fields.push(`${dbField} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${dbField} = ?`);
          values.push(updates[key]);
        }
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`UPDATE personas SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  // Delete persona
  async deletePersona(id) {
    const stmt = this.db.prepare('UPDATE personas SET is_active = 0, updated_at = ? WHERE id = ?');
    return stmt.run(Date.now(), id);
  }

  /**
   * Audit Log Methods
   */

  // Insert audit log
  async insertAuditLog(logData) {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, user_id, api_key_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      logData.id,
      logData.userId,
      logData.apiKeyId,
      logData.action,
      logData.resourceType,
      logData.resourceId,
      JSON.stringify(logData.details || {}),
      logData.ipAddress,
      logData.userAgent,
      Date.now()
    );
  }

  // Get audit logs
  async getAuditLogs(filters = {}) {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (filters.userId) {
      query += ' AND user_id = ?';
      params.push(filters.userId);
    }

    if (filters.action) {
      query += ' AND action = ?';
      params.push(filters.action);
    }

    if (filters.resourceType) {
      query += ' AND resource_type = ?';
      params.push(filters.resourceType);
    }

    if (filters.startDate) {
      query += ' AND created_at >= ?';
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      query += ' AND created_at <= ?';
      params.push(filters.endDate);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    return results.map(log => ({
      ...log,
      details: JSON.parse(log.details)
    }));
  }

  /**
   * Entity Methods (for knowledge graph)
   */

  // Insert entity
  async insertEntity(entityData) {
    const stmt = this.db.prepare(`
      INSERT INTO entities (id, persona_id, vector_id, type, name, normalized_name, properties, confidence, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    return stmt.run(
      entityData.id,
      entityData.personaId,
      entityData.vectorId || null,
      entityData.type,
      entityData.name,
      entityData.normalizedName || entityData.name.toLowerCase(),
      JSON.stringify(entityData.properties || {}),
      entityData.confidence || 1.0,
      entityData.contentHash || null,
      now,
      now
    );
  }

  // Get entity by ID
  async getEntityById(id) {
    const stmt = this.db.prepare('SELECT * FROM entities WHERE id = ?');
    const result = stmt.get(id);
    
    if (result && result.properties) {
      result.properties = JSON.parse(result.properties);
    }
    
    return result;
  }

  // Get entities by persona
  async getEntitiesByPersona(personaId, filters = {}) {
    let query = 'SELECT * FROM entities WHERE persona_id = ?';
    const params = [personaId];

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters.minConfidence) {
      query += ' AND confidence >= ?';
      params.push(filters.minConfidence);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    return results.map(result => ({
      ...result,
      properties: JSON.parse(result.properties)
    }));
  }

  // Search entities by name
  async searchEntitiesByName(personaId, searchTerm, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM entities 
      WHERE persona_id = ? AND name LIKE ?
      ORDER BY confidence DESC, created_at DESC
      LIMIT ?
    `);
    
    const results = stmt.all(personaId, `%${searchTerm}%`, limit);
    return results.map(result => ({
      ...result,
      properties: JSON.parse(result.properties)
    }));
  }

  // Update entity
  async updateEntity(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id') {
        if (key === 'properties') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`UPDATE entities SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  // Delete entity
  async deleteEntity(id) {
    const stmt = this.db.prepare('DELETE FROM entities WHERE id = ?');
    return stmt.run(id);
  }

  /**
   * Relationship Methods (for knowledge graph)
   */

  // Insert relationship
  async insertRelationship(relationshipData) {
    const stmt = this.db.prepare(`
      INSERT INTO relationships (id, persona_id, source_entity_id, target_entity_id, relationship_type, strength, context, properties, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    return stmt.run(
      relationshipData.id,
      relationshipData.personaId,
      relationshipData.sourceEntityId,
      relationshipData.targetEntityId,
      relationshipData.relationshipType,
      relationshipData.strength || 1.0,
      relationshipData.context || null,
      JSON.stringify(relationshipData.properties || {}),
      relationshipData.contentHash || null,
      now,
      now
    );
  }

  // Get relationship by ID
  async getRelationshipById(id) {
    const stmt = this.db.prepare('SELECT * FROM relationships WHERE id = ?');
    const result = stmt.get(id);
    
    if (result && result.properties) {
      result.properties = JSON.parse(result.properties);
    }
    
    return result;
  }

  // Find relationship by UNIQUE constraint fields
  async findRelationshipByFields(personaId, sourceEntityId, targetEntityId, relationshipType) {
    const stmt = this.db.prepare(`
      SELECT * FROM relationships 
      WHERE persona_id = ? AND source_entity_id = ? AND target_entity_id = ? AND relationship_type = ?
    `);
    const result = stmt.get(personaId, sourceEntityId, targetEntityId, relationshipType);
    
    if (result && result.properties) {
      result.properties = JSON.parse(result.properties);
    }
    
    return result;
  }

  // Get relationships for entity
  async getEntityRelationships(entityId, direction = 'both', limit = 50) {
    let query;
    let params;

    if (direction === 'outgoing') {
      query = 'SELECT * FROM relationships WHERE source_entity_id = ? ORDER BY strength DESC, created_at DESC';
      params = [entityId];
    } else if (direction === 'incoming') {
      query = 'SELECT * FROM relationships WHERE target_entity_id = ? ORDER BY strength DESC, created_at DESC';
      params = [entityId];
    } else {
      query = 'SELECT * FROM relationships WHERE source_entity_id = ? OR target_entity_id = ? ORDER BY strength DESC, created_at DESC';
      params = [entityId, entityId];
    }

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    return results.map(result => ({
      ...result,
      properties: JSON.parse(result.properties)
    }));
  }

  // Find related entities (graph traversal)
  async findRelatedEntities(entityId, maxDepth = 2, limit = 100) {
    // Use recursive CTE for graph traversal
    const stmt = this.db.prepare(`
      WITH RECURSIVE entity_path(entity_id, source_id, depth, path) AS (
        -- Base case: start with the given entity
        SELECT ?, ?, 0, ?
        
        UNION
        
        -- Recursive case: find connected entities
        SELECT 
          CASE 
            WHEN r.source_entity_id = ep.entity_id THEN r.target_entity_id
            ELSE r.source_entity_id
          END as entity_id,
          ep.entity_id as source_id,
          ep.depth + 1,
          ep.path || ',' || (CASE 
            WHEN r.source_entity_id = ep.entity_id THEN r.target_entity_id
            ELSE r.source_entity_id
          END)
        FROM entity_path ep
        JOIN relationships r ON (r.source_entity_id = ep.entity_id OR r.target_entity_id = ep.entity_id)
        WHERE ep.depth < ?
          AND (CASE 
            WHEN r.source_entity_id = ep.entity_id THEN r.target_entity_id
            ELSE r.source_entity_id
          END) NOT IN (
            SELECT value FROM (
              SELECT TRIM(value) as value FROM (
                SELECT ep.path as text
                UNION ALL
                SELECT ',' || ep.entity_id
              ), json_each('["' || REPLACE(text, ',', '","') || '"]')
              WHERE value != ''
            )
          )
      )
      SELECT DISTINCT ep.entity_id, ep.depth, e.name, e.type, e.confidence
      FROM entity_path ep
      JOIN entities e ON e.id = ep.entity_id
      WHERE ep.entity_id != ?
      ORDER BY ep.depth, e.confidence DESC
      LIMIT ?
    `);

    const results = stmt.all(entityId, entityId, entityId, maxDepth, entityId, limit);
    return results;
  }

  // Get relationships by persona
  async getRelationshipsByPersona(personaId, filters = {}) {
    let query = 'SELECT * FROM relationships WHERE persona_id = ?';
    const params = [personaId];

    if (filters.relationshipType) {
      query += ' AND relationship_type = ?';
      params.push(filters.relationshipType);
    }

    if (filters.minStrength) {
      query += ' AND strength >= ?';
      params.push(filters.minStrength);
    }

    query += ' ORDER BY strength DESC, created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    return results.map(result => ({
      ...result,
      properties: JSON.parse(result.properties)
    }));
  }

  // Update relationship
  async updateRelationship(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id') {
        if (key === 'properties') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`UPDATE relationships SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  // Delete relationship
  async deleteRelationship(id) {
    const stmt = this.db.prepare('DELETE FROM relationships WHERE id = ?');
    return stmt.run(id);
  }

  // Get knowledge graph statistics for persona
  async getGraphStats(personaId) {
    const entityStats = this.db.prepare(`
      SELECT type, COUNT(*) as count, AVG(confidence) as avg_confidence
      FROM entities 
      WHERE persona_id = ? 
      GROUP BY type
      ORDER BY count DESC
    `).all(personaId);

    const relationshipStats = this.db.prepare(`
      SELECT relationship_type, COUNT(*) as count, AVG(strength) as avg_strength
      FROM relationships 
      WHERE persona_id = ? 
      GROUP BY relationship_type
      ORDER BY count DESC
    `).all(personaId);

    const totalEntities = this.db.prepare('SELECT COUNT(*) as count FROM entities WHERE persona_id = ?').get(personaId);
    const totalRelationships = this.db.prepare('SELECT COUNT(*) as count FROM relationships WHERE persona_id = ?').get(personaId);

    return {
      totalEntities: totalEntities.count,
      totalRelationships: totalRelationships.count,
      entityTypes: entityStats,
      relationshipTypes: relationshipStats
    };
  }

  /**
   * General Database Methods
   */

  // Get database statistics
  async getStats() {
    const stats = {};
    
    const tables = ['users', 'api_keys', 'vector_metadata', 'personas', 'refresh_tokens', 'audit_logs'];
    
    for (const table of tables) {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
      stats[table] = stmt.get().count;
    }
    
    return stats;
  }

  // Check if database is healthy
  async healthCheck() {
    try {
      const result = this.db.prepare('SELECT 1 as test').get();
      return result.test === 1;
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return false;
    }
  }

  // Close database connection
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      logger.info('Database connection closed');
    }
  }
}

module.exports = DatabaseRepository;
