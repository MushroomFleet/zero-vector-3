#!/usr/bin/env node

/**
 * Zero Vector 2.0 Migration Script
 * Migrates existing v1.0 database to hybrid vector-graph structure
 * with zero-downtime deployment support
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

// Import required services
const config = require('../src/config');
const logger = require('../src/utils/logger');

class HybridMigrationManager {
  constructor(options = {}) {
    this.dbPath = options.dbPath || config.database.path;
    this.dryRun = options.dryRun || false;
    this.batchSize = options.batchSize || 100;
    this.backupPath = options.backupPath || `${this.dbPath}.backup.${Date.now()}`;
    
    this.db = null;
    this.migrationStats = {
      startTime: Date.now(),
      memoriesProcessed: 0,
      entitiesCreated: 0,
      relationshipsCreated: 0,
      errors: [],
      phases: {}
    };
  }

  /**
   * Execute the complete migration process
   */
  async performMigration() {
    try {
      logger.info('Starting Zero Vector 2.0 migration', {
        dryRun: this.dryRun,
        dbPath: this.dbPath,
        batchSize: this.batchSize
      });

      // Phase 1: Backup and validation
      await this.createBackup();
      await this.validatePreMigration();

      // Phase 2: Add graph tables (non-breaking)
      await this.addGraphTables();

      // Phase 3: Process existing memories (background compatible)
      await this.migrateExistingMemories();

      // Phase 4: Validate migration results
      await this.validatePostMigration();

      // Phase 5: Cleanup and optimization
      await this.optimizeDatabase();

      const totalTime = Date.now() - this.migrationStats.startTime;
      logger.info('Migration completed successfully', {
        ...this.migrationStats,
        totalTimeMs: totalTime,
        dryRun: this.dryRun
      });

      return this.migrationStats;

    } catch (error) {
      logger.error('Migration failed', { error: error.message, stack: error.stack });
      
      if (!this.dryRun) {
        await this.handleMigrationFailure(error);
      }
      
      throw error;
    } finally {
      if (this.db) {
        this.db.close();
      }
    }
  }

  /**
   * Create database backup before migration
   */
  async createBackup() {
    const phaseStart = Date.now();
    
    if (this.dryRun) {
      logger.info('DRY RUN: Would create backup', { backupPath: this.backupPath });
    } else {
      logger.info('Creating database backup', { backupPath: this.backupPath });
      
      if (fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, this.backupPath);
        logger.info('Backup created successfully', { 
          backupPath: this.backupPath,
          sizeBytes: fs.statSync(this.backupPath).size
        });
      } else {
        throw new Error(`Database file not found: ${this.dbPath}`);
      }
    }

    this.migrationStats.phases.backup = Date.now() - phaseStart;
  }

  /**
   * Validate database state before migration
   */
  async validatePreMigration() {
    const phaseStart = Date.now();
    
    this.db = new Database(this.dbPath, { readonly: this.dryRun });
    
    // Check existing tables
    const existingTables = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map(row => row.name);

    const requiredTables = ['personas', 'vector_metadata', 'vector_indices'];
    const missingTables = requiredTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      throw new Error(`Required tables missing: ${missingTables.join(', ')}`);
    }

    // Count existing data
    const memoryCount = this.db.prepare('SELECT COUNT(*) as count FROM vector_metadata').get().count;
    const personaCount = this.db.prepare('SELECT COUNT(*) as count FROM personas').get().count;

    logger.info('Pre-migration validation passed', {
      existingTables: existingTables.length,
      memoryCount,
      personaCount
    });

    this.migrationStats.phases.validation = Date.now() - phaseStart;
    return { memoryCount, personaCount, existingTables };
  }

  /**
   * Add graph tables to existing database schema
   */
  async addGraphTables() {
    const phaseStart = Date.now();
    
    if (this.dryRun) {
      logger.info('DRY RUN: Would add graph tables');
      this.migrationStats.phases.addTables = Date.now() - phaseStart;
      return;
    }

    logger.info('Adding graph tables to database schema');

    // Close readonly connection and open writable
    if (this.db) {
      this.db.close();
    }
    this.db = new Database(this.dbPath);

    // Create entities table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        vector_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        properties TEXT,
        confidence REAL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (persona_id) REFERENCES personas (id),
        FOREIGN KEY (vector_id) REFERENCES vector_metadata (id)
      );
    `);

    // Create relationships table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        context TEXT,
        properties TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (persona_id) REFERENCES personas (id),
        FOREIGN KEY (source_entity_id) REFERENCES entities (id),
        FOREIGN KEY (target_entity_id) REFERENCES entities (id)
      );
    `);

    // Create performance indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_persona_type ON entities(persona_id, type);
      CREATE INDEX IF NOT EXISTS idx_entities_vector_id ON entities(vector_id);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_relationships_persona ON relationships(persona_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relationship_type);
    `);

    // Add migration tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        description TEXT,
        executed_at INTEGER NOT NULL,
        execution_time_ms INTEGER,
        success BOOLEAN DEFAULT FALSE
      );
    `);

    // Record this migration
    const migrationRecord = this.db.prepare(`
      INSERT INTO migration_log (version, description, executed_at, success)
      VALUES (?, ?, ?, ?)
    `);
    
    migrationRecord.run(
      '2.0.0',
      'Add graph tables for hybrid vector-graph capabilities',
      Date.now(),
      true
    );

    logger.info('Graph tables added successfully');
    this.migrationStats.phases.addTables = Date.now() - phaseStart;
  }

  /**
   * Process existing memories for entity extraction and graph building
   */
  async migrateExistingMemories() {
    const phaseStart = Date.now();
    
    logger.info('Processing existing memories for entity extraction');

    // Get all memories with content
    const memoriesQuery = this.db.prepare(`
      SELECT vm.id, vm.persona_id, vm.metadata, vm.created_at
      FROM vector_metadata vm
      WHERE vm.metadata IS NOT NULL
      ORDER BY vm.created_at ASC
    `);

    const memories = memoriesQuery.all();
    logger.info(`Found ${memories.length} memories to process`);

    if (this.dryRun) {
      logger.info('DRY RUN: Would process memories for entity extraction', {
        memoryCount: memories.length,
        estimatedEntities: memories.length * 2.5, // Rough estimate
        batchSize: this.batchSize
      });
      this.migrationStats.phases.processMemories = Date.now() - phaseStart;
      return;
    }

    // Process in batches to avoid overwhelming system
    const batches = this.chunkArray(memories, this.batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`Processing batch ${i + 1}/${batches.length}`, {
        batchSize: batch.length,
        progress: ((i / batches.length) * 100).toFixed(1) + '%'
      });

      await this.processBatch(batch);
      
      // Small delay to prevent system overload
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.migrationStats.phases.processMemories = Date.now() - phaseStart;
  }

  /**
   * Process a batch of memories for entity extraction
   */
  async processBatch(memories) {
    const EntityExtractor = require('../src/services/EntityExtractor');
    const entityExtractor = new EntityExtractor();

    for (const memory of memories) {
      try {
        // Parse metadata to get original content
        const metadata = JSON.parse(memory.metadata || '{}');
        const content = metadata.originalContent || metadata.content;
        
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
          continue; // Skip memories without extractable content
        }

        // Extract entities from content
        const entities = await entityExtractor.extractEntities(content, memory.persona_id);
        
        // Store entities in database
        for (const entity of entities) {
          await this.createEntity(memory.persona_id, memory.id, entity);
        }

        // Create relationships between entities in same memory
        if (entities.length > 1) {
          await this.createCooccurrenceRelationships(memory.persona_id, entities);
        }

        this.migrationStats.memoriesProcessed++;

      } catch (error) {
        logger.warn('Error processing memory for entity extraction', {
          memoryId: memory.id,
          error: error.message
        });
        this.migrationStats.errors.push({
          memoryId: memory.id,
          error: error.message,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Create entity record in database
   */
  async createEntity(personaId, vectorId, entityData) {
    const entityId = uuidv4();
    const now = Date.now();

    const insertEntity = this.db.prepare(`
      INSERT INTO entities (
        id, persona_id, vector_id, type, name, properties, 
        confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      insertEntity.run(
        entityId,
        personaId,
        vectorId,
        entityData.type,
        entityData.name,
        JSON.stringify(entityData.properties || {}),
        entityData.confidence,
        now,
        now
      );

      this.migrationStats.entitiesCreated++;
      return entityId;

    } catch (error) {
      // Handle duplicate entities gracefully
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        logger.debug('Entity already exists', { name: entityData.name, type: entityData.type });
        return null;
      }
      throw error;
    }
  }

  /**
   * Create co-occurrence relationships between entities in same memory
   */
  async createCooccurrenceRelationships(personaId, entities) {
    const insertRelationship = this.db.prepare(`
      INSERT OR IGNORE INTO relationships (
        id, persona_id, source_entity_id, target_entity_id,
        relationship_type, strength, context, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const sourceEntity = entities[i];
        const targetEntity = entities[j];

        const relationshipId = uuidv4();
        const relationshipType = this.inferRelationshipType(sourceEntity, targetEntity);
        const strength = this.calculateCooccurrenceStrength(sourceEntity, targetEntity);

        try {
          insertRelationship.run(
            relationshipId,
            personaId,
            sourceEntity.id,
            targetEntity.id,
            relationshipType,
            strength,
            'Co-occurrence in memory',
            now,
            now
          );

          this.migrationStats.relationshipsCreated++;

        } catch (error) {
          if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
            logger.warn('Error creating relationship', {
              sourceEntity: sourceEntity.name,
              targetEntity: targetEntity.name,
              error: error.message
            });
          }
        }
      }
    }
  }

  /**
   * Infer relationship type between entities
   */
  inferRelationshipType(entity1, entity2) {
    // Simple rule-based relationship inference
    if (entity1.type === 'PERSON' && entity2.type === 'PERSON') {
      return 'KNOWS';
    }
    if (entity1.type === 'PERSON' && entity2.type === 'ORGANIZATION') {
      return 'WORKS_FOR';
    }
    if (entity1.type === 'PERSON' && entity2.type === 'CONCEPT') {
      return 'INTERESTED_IN';
    }
    return 'RELATES_TO';
  }

  /**
   * Calculate co-occurrence strength
   */
  calculateCooccurrenceStrength(entity1, entity2) {
    // Base strength for co-occurrence
    let strength = 0.5;
    
    // Boost for high-confidence entities
    if (entity1.confidence > 0.8 && entity2.confidence > 0.8) {
      strength += 0.2;
    }
    
    // Boost for person-person relationships
    if (entity1.type === 'PERSON' && entity2.type === 'PERSON') {
      strength += 0.1;
    }

    return Math.min(strength, 1.0);
  }

  /**
   * Validate migration results
   */
  async validatePostMigration() {
    const phaseStart = Date.now();
    
    logger.info('Validating migration results');

    // Check graph table integrity
    const entityCount = this.db.prepare('SELECT COUNT(*) as count FROM entities').get().count;
    const relationshipCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get().count;

    // Verify foreign key constraints
    const orphanedEntities = this.db.prepare(`
      SELECT COUNT(*) as count FROM entities e 
      WHERE e.vector_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM vector_metadata vm WHERE vm.id = e.vector_id)
    `).get().count;

    const orphanedRelationships = this.db.prepare(`
      SELECT COUNT(*) as count FROM relationships r
      WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = r.source_entity_id)
      OR NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = r.target_entity_id)
    `).get().count;

    if (orphanedEntities > 0 || orphanedRelationships > 0) {
      throw new Error(`Data integrity issues found: ${orphanedEntities} orphaned entities, ${orphanedRelationships} orphaned relationships`);
    }

    // Validate entity distribution
    const entityTypes = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM entities GROUP BY type
    `).all();

    const relationshipTypes = this.db.prepare(`
      SELECT relationship_type, COUNT(*) as count FROM relationships GROUP BY relationship_type
    `).all();

    logger.info('Migration validation passed', {
      entityCount,
      relationshipCount,
      entityTypes,
      relationshipTypes,
      orphanedEntities,
      orphanedRelationships
    });

    this.migrationStats.phases.validation = Date.now() - phaseStart;
    
    return {
      entityCount,
      relationshipCount,
      entityTypes,
      relationshipTypes
    };
  }

  /**
   * Optimize database after migration
   */
  async optimizeDatabase() {
    const phaseStart = Date.now();
    
    if (this.dryRun) {
      logger.info('DRY RUN: Would optimize database');
      this.migrationStats.phases.optimization = Date.now() - phaseStart;
      return;
    }

    logger.info('Optimizing database after migration');

    // Update statistics for query planner
    this.db.exec('ANALYZE');
    
    // Vacuum to reclaim space and optimize layout
    this.db.exec('VACUUM');

    // Enable WAL mode for better concurrent access
    this.db.exec('PRAGMA journal_mode = WAL');
    
    // Set optimal settings for hybrid workload
    this.db.exec('PRAGMA cache_size = -65536'); // 64MB cache
    this.db.exec('PRAGMA temp_store = MEMORY');
    this.db.exec('PRAGMA mmap_size = 134217728'); // 128MB mmap

    logger.info('Database optimization completed');
    this.migrationStats.phases.optimization = Date.now() - phaseStart;
  }

  /**
   * Handle migration failure with rollback
   */
  async handleMigrationFailure(error) {
    logger.error('Migration failed, attempting rollback', { error: error.message });

    try {
      if (fs.existsSync(this.backupPath)) {
        // Close current database connection
        if (this.db) {
          this.db.close();
        }

        // Restore from backup
        fs.copyFileSync(this.backupPath, this.dbPath);
        logger.info('Database restored from backup', { backupPath: this.backupPath });

        // Clean up failed migration artifacts
        await this.cleanupFailedMigration();

        return true;
      } else {
        logger.error('Backup file not found, cannot rollback', { backupPath: this.backupPath });
        return false;
      }
    } catch (rollbackError) {
      logger.error('Rollback failed', { 
        originalError: error.message,
        rollbackError: rollbackError.message 
      });
      return false;
    }
  }

  /**
   * Clean up artifacts from failed migration
   */
  async cleanupFailedMigration() {
    // Remove any temporary files or incomplete data
    // This would be customized based on specific failure scenarios
    logger.info('Cleaning up failed migration artifacts');
  }

  /**
   * Utility function to chunk array into batches
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--batch-size' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--db-path' && args[i + 1]) {
      options.dbPath = args[i + 1];
      i++;
    } else if (arg === '--backup-path' && args[i + 1]) {
      options.backupPath = args[i + 1];
      i++;
    }
  }

  // Execute migration
  const migrationManager = new HybridMigrationManager(options);
  
  migrationManager.performMigration()
    .then(stats => {
      console.log('\n✅ Migration completed successfully!');
      console.log(`📊 Processed ${stats.memoriesProcessed} memories`);
      console.log(`🏷️  Created ${stats.entitiesCreated} entities`);
      console.log(`🔗 Created ${stats.relationshipsCreated} relationships`);
      console.log(`⏱️  Total time: ${Date.now() - stats.startTime}ms`);
      
      if (stats.errors.length > 0) {
        console.log(`⚠️  ${stats.errors.length} errors occurred (check logs)`);
      }
      
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Migration failed:', error.message);
      console.error('Check logs for detailed error information');
      process.exit(1);
    });
}

module.exports = HybridMigrationManager;
