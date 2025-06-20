const { Pool } = require('pg');
const { logger, logError, logPerformance, createTimer } = require('../utils/logger');
const { z } = require('zod');
const fs = require('fs').promises;
const path = require('path');

/**
 * PostgreSQL Manager
 * Manages PostgreSQL connections, database setup, and LangGraph checkpointing
 * Implements database patterns from LangGraph-DEV-HANDOFF.md
 */

const PostgreSQLConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  user: z.string().default('zerovector'),
  password: z.string(),
  database: z.string().default('zerovector3'),
  ssl: z.union([z.boolean(), z.object({}).passthrough()]).default(false),
  max: z.number().default(20), // Maximum pool size
  min: z.number().default(5),  // Minimum pool size
  idleTimeoutMillis: z.number().default(30000),
  connectionTimeoutMillis: z.number().default(10000),
  acquireTimeoutMillis: z.number().default(60000),
  createTimeoutMillis: z.number().default(30000),
  destroyTimeoutMillis: z.number().default(5000),
  reapIntervalMillis: z.number().default(1000),
  createRetryIntervalMillis: z.number().default(200),
  propagateCreateError: z.boolean().default(false)
});

class PostgreSQLManager {
  constructor(config = {}) {
    this.config = PostgreSQLConfigSchema.parse(config);
    this.pool = null;
    this.connected = false;
    this.connectionStats = {
      totalConnections: 0,
      totalErrors: 0,
      activeConnections: 0,
      idleConnections: 0,
      lastConnected: null,
      lastError: null
    };

    logger.info('PostgreSQLManager initialized', {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      maxConnections: this.config.max
    });
  }

  /**
   * Initialize PostgreSQL connection pool
   */
  async initialize() {
    const timer = createTimer('postgresql_initialization');

    try {
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        ssl: this.config.ssl,
        max: this.config.max,
        min: this.config.min,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
        acquireTimeoutMillis: this.config.acquireTimeoutMillis,
        createTimeoutMillis: this.config.createTimeoutMillis,
        destroyTimeoutMillis: this.config.destroyTimeoutMillis,
        reapIntervalMillis: this.config.reapIntervalMillis,
        createRetryIntervalMillis: this.config.createRetryIntervalMillis,
        propagateCreateError: this.config.propagateCreateError
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Test connection
      await this.testConnection();

      // Initialize database schema
      await this.initializeSchema();

      this.connected = true;
      this.connectionStats.lastConnected = new Date().toISOString();

      timer.end({ success: true });

      logger.info('PostgreSQL pool initialized successfully', {
        maxConnections: this.config.max,
        minConnections: this.config.min,
        database: this.config.database
      });

      return this.pool;

    } catch (error) {
      timer.end({ error: true });
      this.connectionStats.lastError = error.message;
      logError(error, {
        operation: 'postgresql_initialization',
        config: { ...this.config, password: '[REDACTED]' }
      });
      throw error;
    }
  }

  /**
   * Setup PostgreSQL event handlers
   */
  setupEventHandlers() {
    this.pool.on('connect', (client) => {
      this.connectionStats.totalConnections++;
      this.connectionStats.activeConnections++;
      
      logger.debug('PostgreSQL client connected', {
        activeConnections: this.connectionStats.activeConnections,
        totalConnections: this.connectionStats.totalConnections
      });
    });

    this.pool.on('acquire', (client) => {
      logger.debug('PostgreSQL client acquired from pool');
    });

    this.pool.on('release', (client) => {
      logger.debug('PostgreSQL client released back to pool');
    });

    this.pool.on('remove', (client) => {
      this.connectionStats.activeConnections--;
      logger.debug('PostgreSQL client removed from pool', {
        activeConnections: this.connectionStats.activeConnections
      });
    });

    this.pool.on('error', (error, client) => {
      this.connectionStats.totalErrors++;
      this.connectionStats.lastError = error.message;
      
      logError(error, {
        operation: 'postgresql_pool_error',
        clientProcessId: client?.processID
      });
    });
  }

  /**
   * Test database connection
   */
  async testConnection() {
    const timer = createTimer('postgresql_connection_test');

    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
      client.release();

      timer.end({ success: true });

      logger.info('PostgreSQL connection test successful', {
        currentTime: result.rows[0].current_time,
        version: result.rows[0].postgres_version.split(' ')[0]
      });

      return result.rows[0];

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'postgresql_connection_test',
        host: this.config.host,
        database: this.config.database
      });
      throw error;
    }
  }

  /**
   * Initialize database schema for LangGraph and approval workflows
   */
  async initializeSchema() {
    const timer = createTimer('postgresql_schema_initialization');

    try {
      const client = await this.pool.connect();

      try {
        await client.query('BEGIN');

        // Create extensions
        await this.createExtensions(client);

        // Create LangGraph checkpoint tables
        await this.createLangGraphTables(client);

        // Create approval workflow tables
        await this.createApprovalTables(client);

        // Create indexes for performance
        await this.createIndexes(client);

        // Create functions and triggers
        await this.createFunctions(client);

        await client.query('COMMIT');

        timer.end({ success: true });

        logger.info('PostgreSQL schema initialized successfully');

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'postgresql_schema_initialization'
      });
      throw error;
    }
  }

  /**
   * Create required PostgreSQL extensions
   */
  async createExtensions(client) {
    const extensions = [
      'uuid-ossp',
      'pgcrypto'
    ];

    for (const extension of extensions) {
      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
        logger.debug(`PostgreSQL extension created: ${extension}`);
      } catch (error) {
        logger.warn(`Failed to create extension ${extension}`, { error: error.message });
      }
    }
  }

  /**
   * Create LangGraph checkpoint tables
   */
  async createLangGraphTables(client) {
    // Main checkpoints table
    await client.query(`
      CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint_data JSONB NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (thread_id, checkpoint_id)
      )
    `);

    // Checkpoint writes table for tracking all writes
    await client.query(`
      CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        value JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (thread_id, checkpoint_id, task_id, idx)
      )
    `);

    // Thread metadata table
    await client.query(`
      CREATE TABLE IF NOT EXISTS langgraph_threads (
        thread_id TEXT PRIMARY KEY,
        user_id TEXT,
        persona_id TEXT,
        workflow_type TEXT,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_checkpoint_id TEXT,
        last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    logger.debug('LangGraph tables created successfully');
  }

  /**
   * Create approval workflow tables
   */
  async createApprovalTables(client) {
    // Approval requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id TEXT NOT NULL,
        thread_id TEXT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        proposed_response TEXT,
        risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
        risk_score DECIMAL(3,2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
        sensitive_topics TEXT[] DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'timeout', 'escalated')),
        approval_level TEXT DEFAULT 'human' CHECK (approval_level IN ('auto', 'human', 'escalated')),
        submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        reviewed_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        reviewer_id TEXT,
        approval_reason TEXT,
        rejection_reason TEXT,
        escalation_reason TEXT,
        context JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Approval history table for audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('created', 'reviewed', 'escalated', 'timeout', 'modified')),
        actor_id TEXT,
        previous_status TEXT,
        new_status TEXT,
        details JSONB DEFAULT '{}',
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Escalation rules table
    await client.query(`
      CREATE TABLE IF NOT EXISTS escalation_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_name TEXT NOT NULL UNIQUE,
        conditions JSONB NOT NULL,
        escalation_level INTEGER NOT NULL DEFAULT 1,
        timeout_minutes INTEGER DEFAULT 60,
        assignee_ids TEXT[] DEFAULT '{}',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    logger.debug('Approval workflow tables created successfully');
  }

  /**
   * Create database indexes for performance
   */
  async createIndexes(client) {
    const indexes = [
      // LangGraph indexes
      'CREATE INDEX IF NOT EXISTS idx_langgraph_checkpoints_thread_id ON langgraph_checkpoints(thread_id)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_checkpoints_created_at ON langgraph_checkpoints(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_checkpoints_parent ON langgraph_checkpoints(parent_checkpoint_id)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_checkpoint_writes_thread_checkpoint ON langgraph_checkpoint_writes(thread_id, checkpoint_id)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_threads_user_id ON langgraph_threads(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_threads_status ON langgraph_threads(status)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_threads_last_activity ON langgraph_threads(last_activity)',

      // Approval workflow indexes
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_user_id ON approval_requests(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_workflow_id ON approval_requests(workflow_id)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_submitted_at ON approval_requests(submitted_at)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_expires_at ON approval_requests(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_risk_level ON approval_requests(risk_level)',
      'CREATE INDEX IF NOT EXISTS idx_approval_history_approval_id ON approval_history(approval_request_id)',
      'CREATE INDEX IF NOT EXISTS idx_approval_history_timestamp ON approval_history(timestamp)',

      // GIN indexes for JSONB columns
      'CREATE INDEX IF NOT EXISTS idx_langgraph_checkpoints_metadata_gin ON langgraph_checkpoints USING GIN (metadata)',
      'CREATE INDEX IF NOT EXISTS idx_langgraph_threads_metadata_gin ON langgraph_threads USING GIN (metadata)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_context_gin ON approval_requests USING GIN (context)',
      'CREATE INDEX IF NOT EXISTS idx_approval_requests_metadata_gin ON approval_requests USING GIN (metadata)'
    ];

    for (const indexSql of indexes) {
      try {
        await client.query(indexSql);
      } catch (error) {
        logger.warn('Failed to create index', { 
          sql: indexSql.substring(0, 100),
          error: error.message 
        });
      }
    }

    logger.debug('Database indexes created successfully');
  }

  /**
   * Create database functions and triggers
   */
  async createFunctions(client) {
    // Function to update updated_at timestamps
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    // Triggers for updated_at columns
    const tables = [
      'langgraph_threads',
      'approval_requests',
      'escalation_rules'
    ];

    for (const table of tables) {
      await client.query(`
        DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
        CREATE TRIGGER update_${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column()
      `);
    }

    // Function to automatically create approval history entries
    await client.query(`
      CREATE OR REPLACE FUNCTION create_approval_history()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO approval_history (approval_request_id, action, new_status, details)
          VALUES (NEW.id, 'created', NEW.status, jsonb_build_object('initial_creation', true));
          RETURN NEW;
        ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
          INSERT INTO approval_history (approval_request_id, action, previous_status, new_status, actor_id, details)
          VALUES (NEW.id, 'reviewed', OLD.status, NEW.status, NEW.reviewer_id, 
                  jsonb_build_object('review_timestamp', NOW()));
          RETURN NEW;
        END IF;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    // Trigger for approval history
    await client.query(`
      DROP TRIGGER IF EXISTS approval_history_trigger ON approval_requests;
      CREATE TRIGGER approval_history_trigger
        AFTER INSERT OR UPDATE ON approval_requests
        FOR EACH ROW
        EXECUTE FUNCTION create_approval_history()
    `);

    logger.debug('Database functions and triggers created successfully');
  }

  /**
   * Get a database client from the pool
   */
  async getClient() {
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized. Call initialize() first.');
    }
    return await this.pool.connect();
  }

  /**
   * Execute a query with automatic client management
   */
  async query(text, params = []) {
    const timer = createTimer('postgresql_query', { 
      query: text.substring(0, 100) 
    });

    try {
      const result = await this.pool.query(text, params);
      
      timer.end({ 
        rowCount: result.rowCount,
        success: true 
      });

      return result;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'postgresql_query',
        query: text.substring(0, 200),
        params: params?.length || 0
      });
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  async transaction(callback) {
    const timer = createTimer('postgresql_transaction');
    const client = await this.getClient();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');

      timer.end({ success: true });
      
      return result;

    } catch (error) {
      await client.query('ROLLBACK');
      timer.end({ error: true });
      
      logError(error, {
        operation: 'postgresql_transaction'
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get pool status and statistics
   */
  getPoolStats() {
    if (!this.pool) {
      return { connected: false, error: 'Pool not initialized' };
    }

    return {
      connected: this.connected,
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      maxConnections: this.config.max,
      minConnections: this.config.min,
      stats: this.connectionStats
    };
  }

  /**
   * Get database health information
   */
  async getHealthInfo() {
    const timer = createTimer('postgresql_health_check');

    try {
      const queries = [
        'SELECT NOW() as current_time',
        'SELECT version() as postgres_version',
        'SELECT current_database() as database_name',
        'SELECT current_user as current_user',
        'SELECT pg_database_size(current_database()) as database_size',
        'SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = \'active\''
      ];

      const results = {};
      
      for (const query of queries) {
        const result = await this.query(query);
        const key = query.split(' ')[1].toLowerCase().replace('()', '');
        results[key] = result.rows[0][Object.keys(result.rows[0])[0]];
      }

      // Get table statistics
      const tableStats = await this.query(`
        SELECT 
          schemaname,
          relname as tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          n_dead_tup as dead_tuples
        FROM pg_stat_user_tables 
        WHERE schemaname = 'public'
        ORDER BY relname
      `);

      results.table_stats = tableStats.rows;

      timer.end({ success: true });

      return {
        healthy: true,
        ...results,
        pool_stats: this.getPoolStats()
      };

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'postgresql_health_check' });
      
      return {
        healthy: false,
        error: error.message,
        pool_stats: this.getPoolStats()
      };
    }
  }

  /**
   * Clean up old data (maintenance function)
   */
  async performMaintenance(options = {}) {
    const timer = createTimer('postgresql_maintenance');

    try {
      const {
        checkpointRetentionDays = 30,
        approvalHistoryRetentionDays = 90,
        inactiveThreadDays = 7
      } = options;

      let cleanedRecords = 0;

      await this.transaction(async (client) => {
        // Clean old checkpoints
        const checkpointResult = await client.query(`
          DELETE FROM langgraph_checkpoints 
          WHERE created_at < NOW() - INTERVAL '${checkpointRetentionDays} days'
        `);
        cleanedRecords += checkpointResult.rowCount;

        // Clean old approval history
        const historyResult = await client.query(`
          DELETE FROM approval_history 
          WHERE timestamp < NOW() - INTERVAL '${approvalHistoryRetentionDays} days'
        `);
        cleanedRecords += historyResult.rowCount;

        // Mark inactive threads
        await client.query(`
          UPDATE langgraph_threads 
          SET status = 'inactive'
          WHERE status = 'active' 
            AND last_activity < NOW() - INTERVAL '${inactiveThreadDays} days'
        `);

        // Vacuum analyze for performance
        await client.query('VACUUM ANALYZE');
      });

      timer.end({ 
        success: true, 
        cleanedRecords 
      });

      logger.info('PostgreSQL maintenance completed', {
        cleanedRecords,
        checkpointRetentionDays,
        approvalHistoryRetentionDays
      });

      return { cleanedRecords };

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'postgresql_maintenance' });
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    const timer = createTimer('postgresql_shutdown');

    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
        this.connected = false;
      }

      timer.end({ success: true });

      logger.info('PostgreSQL manager shutdown completed');

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'postgresql_shutdown' });
    }
  }
}

module.exports = PostgreSQLManager;
