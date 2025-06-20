const { logger, logError, logMemory, createTimer } = require('../utils/logger');
const { z } = require('zod');

/**
 * Memory Lifecycle Manager
 * Handles intelligent memory management with lifecycle policies
 * Implements patterns from LangGraph-DEV-HANDOFF.md Phase 3
 */

// Memory lifecycle schemas
const MemoryItemSchema = z.object({
  id: z.string(),
  namespace: z.array(z.string()),
  content: z.string(),
  metadata: z.object({
    timestamp: z.string(),
    confidence: z.number().min(0).max(1),
    access_count: z.number().default(0),
    last_accessed: z.string().optional(),
    importance_score: z.number().min(0).max(1).default(0.5),
    user_id: z.string(),
    persona_id: z.string().optional(),
    memory_type: z.enum(['conversation', 'fact', 'relationship', 'preference']).default('conversation')
  })
});

const ArchivalPolicySchema = z.object({
  max_age_days: z.number().default(30),
  min_confidence_threshold: z.number().min(0).max(1).default(0.3),
  max_memory_count_per_user: z.number().default(10000),
  compression_threshold_days: z.number().default(7),
  cleanup_interval_hours: z.number().default(24)
});

class MemoryLifecycleManager {
  constructor(memoryStore, config = {}) {
    this.memoryStore = memoryStore;
    this.config = ArchivalPolicySchema.parse(config);
    this.compressionStats = {
      items_compressed: 0,
      items_archived: 0,
      items_deleted: 0,
      last_cleanup: null
    };
    
    // Start cleanup interval if enabled
    if (config.autoCleanup !== false) {
      this.startCleanupInterval();
    }

    logger.info('MemoryLifecycleManager initialized', {
      config: this.config,
      autoCleanup: config.autoCleanup !== false
    });
  }

  /**
   * Archive old conversations based on age policy
   */
  async archiveOldConversations(userId, options = {}) {
    const timer = createTimer('memory_archival', { userId });
    
    try {
      logMemory('archive_old_conversations', userId, { 
        maxAgeDays: this.config.max_age_days 
      });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.max_age_days);
      const cutoffTimestamp = cutoffDate.toISOString();

      // Query old conversations
      const oldConversations = await this.findOldMemories(userId, cutoffTimestamp, 'conversation');
      
      if (oldConversations.length === 0) {
        logger.debug('No old conversations found for archival', { userId });
        return { archived: 0, compressed: 0 };
      }

      // Separate conversations by importance
      const { important, unimportant } = this.categorizeByImportance(oldConversations);
      
      // Archive unimportant conversations
      let archivedCount = 0;
      for (const conversation of unimportant) {
        await this.archiveMemory(conversation);
        archivedCount++;
      }

      // Compress important conversations
      let compressedCount = 0;
      for (const conversation of important) {
        await this.compressMemory(conversation);
        compressedCount++;
      }

      this.compressionStats.items_archived += archivedCount;
      this.compressionStats.items_compressed += compressedCount;
      this.compressionStats.last_cleanup = new Date().toISOString();

      const perfData = timer.end({
        archivedCount,
        compressedCount,
        totalProcessed: oldConversations.length
      });

      logMemory('archive_completed', userId, {
        archived: archivedCount,
        compressed: compressedCount,
        duration: perfData.duration
      });

      return { archived: archivedCount, compressed: compressedCount };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'archiveOldConversations',
        userId
      });
      throw error;
    }
  }

  /**
   * Compress frequently accessed memories
   */
  async compressFrequentMemories(userId, options = {}) {
    const timer = createTimer('memory_compression', { userId });
    
    try {
      logMemory('compress_frequent_memories', userId);

      // Find memories accessed multiple times
      const frequentMemories = await this.findFrequentlyAccessedMemories(userId);
      
      if (frequentMemories.length === 0) {
        logger.debug('No frequent memories found for compression', { userId });
        return { compressed: 0 };
      }

      let compressedCount = 0;
      for (const memory of frequentMemories) {
        const compressed = await this.compressMemory(memory);
        if (compressed) {
          compressedCount++;
        }
      }

      this.compressionStats.items_compressed += compressedCount;

      const perfData = timer.end({
        compressedCount,
        totalProcessed: frequentMemories.length
      });

      logMemory('compression_completed', userId, {
        compressed: compressedCount,
        duration: perfData.duration
      });

      return { compressed: compressedCount };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'compressFrequentMemories',
        userId
      });
      throw error;
    }
  }

  /**
   * Clean up low-confidence facts and relationships
   */
  async cleanupLowConfidenceFacts(userId, options = {}) {
    const timer = createTimer('fact_cleanup', { userId });
    
    try {
      const threshold = options.threshold || this.config.min_confidence_threshold;
      
      logMemory('cleanup_low_confidence_facts', userId, { threshold });

      // Find low-confidence facts
      const lowConfidenceFacts = await this.findLowConfidenceMemories(userId, threshold);
      
      if (lowConfidenceFacts.length === 0) {
        logger.debug('No low-confidence facts found for cleanup', { userId });
        return { deleted: 0, verified: 0 };
      }

      let deletedCount = 0;
      let verifiedCount = 0;

      for (const fact of lowConfidenceFacts) {
        // Attempt to verify fact against other sources
        const isVerified = await this.verifyFact(fact);
        
        if (isVerified) {
          // Update confidence if verified
          await this.updateMemoryConfidence(fact, 0.8);
          verifiedCount++;
        } else {
          // Delete if cannot be verified
          await this.deleteMemory(fact);
          deletedCount++;
        }
      }

      this.compressionStats.items_deleted += deletedCount;

      const perfData = timer.end({
        deletedCount,
        verifiedCount,
        totalProcessed: lowConfidenceFacts.length
      });

      logMemory('fact_cleanup_completed', userId, {
        deleted: deletedCount,
        verified: verifiedCount,
        duration: perfData.duration
      });

      return { deleted: deletedCount, verified: verifiedCount };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'cleanupLowConfidenceFacts',
        userId
      });
      throw error;
    }
  }

  /**
   * Resolve conflicting memories
   */
  async resolveMemoryConflicts(userId, options = {}) {
    const timer = createTimer('conflict_resolution', { userId });
    
    try {
      logMemory('resolve_memory_conflicts', userId);

      // Find potentially conflicting memories
      const conflicts = await this.findConflictingMemories(userId);
      
      if (conflicts.length === 0) {
        logger.debug('No memory conflicts found', { userId });
        return { resolved: 0, flagged: 0 };
      }

      let resolvedCount = 0;
      let flaggedCount = 0;

      for (const conflict of conflicts) {
        const resolution = await this.resolveConflict(conflict);
        
        if (resolution.resolved) {
          resolvedCount++;
        } else {
          flaggedCount++;
        }
      }

      const perfData = timer.end({
        resolvedCount,
        flaggedCount,
        totalConflicts: conflicts.length
      });

      logMemory('conflict_resolution_completed', userId, {
        resolved: resolvedCount,
        flagged: flaggedCount,
        duration: perfData.duration
      });

      return { resolved: resolvedCount, flagged: flaggedCount };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'resolveMemoryConflicts',
        userId
      });
      throw error;
    }
  }

  /**
   * Perform complete memory maintenance for a user
   */
  async performMaintenanceForUser(userId, options = {}) {
    const timer = createTimer('memory_maintenance', { userId });
    
    try {
      logger.info('Starting memory maintenance', { userId });

      const results = {
        archival: await this.archiveOldConversations(userId, options),
        compression: await this.compressFrequentMemories(userId, options),
        cleanup: await this.cleanupLowConfidenceFacts(userId, options),
        conflicts: await this.resolveMemoryConflicts(userId, options)
      };

      // Update user memory stats
      await this.updateUserMemoryStats(userId, results);

      const perfData = timer.end({
        totalArchived: results.archival.archived,
        totalCompressed: results.compression.compressed + results.archival.compressed,
        totalDeleted: results.cleanup.deleted,
        totalResolved: results.conflicts.resolved
      });

      logger.info('Memory maintenance completed', {
        userId,
        results,
        duration: perfData.duration
      });

      return results;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'performMaintenanceForUser',
        userId
      });
      throw error;
    }
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanupInterval() {
    const intervalMs = this.config.cleanup_interval_hours * 60 * 60 * 1000;
    
    this.cleanupInterval = setInterval(async () => {
      try {
        logger.info('Starting scheduled memory cleanup');
        await this.performScheduledCleanup();
      } catch (error) {
        logError(error, {
          operation: 'scheduledCleanup'
        });
      }
    }, intervalMs);

    logger.info('Memory cleanup interval started', {
      intervalHours: this.config.cleanup_interval_hours
    });
  }

  /**
   * Stop automatic cleanup interval
   */
  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Memory cleanup interval stopped');
    }
  }

  /**
   * Get memory lifecycle statistics
   */
  getStats() {
    return {
      ...this.compressionStats,
      config: this.config,
      uptime: process.uptime()
    };
  }

  // Private helper methods

  async findOldMemories(userId, cutoffTimestamp, memoryType = null) {
    // Implementation would depend on memory store interface
    // For now, returning mock data structure
    return [];
  }

  async findFrequentlyAccessedMemories(userId) {
    // Find memories with high access_count
    return [];
  }

  async findLowConfidenceMemories(userId, threshold) {
    // Find memories below confidence threshold
    return [];
  }

  async findConflictingMemories(userId) {
    // Find memories that might conflict with each other
    return [];
  }

  categorizeByImportance(memories) {
    const important = memories.filter(m => 
      m.metadata.importance_score > 0.7 || 
      m.metadata.access_count > 5
    );
    const unimportant = memories.filter(m => 
      m.metadata.importance_score <= 0.7 && 
      m.metadata.access_count <= 5
    );
    
    return { important, unimportant };
  }

  async archiveMemory(memory) {
    // Move memory to archive namespace
    const archiveNamespace = ['archived', ...memory.namespace];
    
    // Create archived version
    const archivedMemory = {
      ...memory,
      namespace: archiveNamespace,
      metadata: {
        ...memory.metadata,
        archived_at: new Date().toISOString(),
        original_namespace: memory.namespace
      }
    };

    // Store in archive and remove from active
    await this.memoryStore.add(archiveNamespace, archivedMemory.content, archivedMemory.metadata);
    await this.memoryStore.delete(memory.namespace, memory.id);

    logMemory('memory_archived', memory.metadata.user_id, {
      memoryId: memory.id,
      originalNamespace: memory.namespace
    });

    return true;
  }

  async compressMemory(memory) {
    // Compress memory content while preserving key information
    const compressed = this.compressContent(memory.content);
    
    if (compressed.length < memory.content.length * 0.8) {
      const compressedMemory = {
        ...memory,
        content: compressed,
        metadata: {
          ...memory.metadata,
          compressed: true,
          compression_ratio: compressed.length / memory.content.length,
          original_length: memory.content.length,
          compressed_at: new Date().toISOString()
        }
      };

      await this.memoryStore.update(memory.namespace, memory.id, compressedMemory);

      logMemory('memory_compressed', memory.metadata.user_id, {
        memoryId: memory.id,
        originalLength: memory.content.length,
        compressedLength: compressed.length,
        ratio: compressedMemory.metadata.compression_ratio
      });

      return true;
    }

    return false;
  }

  async deleteMemory(memory) {
    await this.memoryStore.delete(memory.namespace, memory.id);
    
    logMemory('memory_deleted', memory.metadata.user_id, {
      memoryId: memory.id,
      reason: 'low_confidence',
      confidence: memory.metadata.confidence
    });

    return true;
  }

  async verifyFact(fact) {
    // Simple verification logic - in production this would be more sophisticated
    // Check against other high-confidence memories, external sources, etc.
    
    // For now, randomly verify some facts to simulate the process
    return Math.random() > 0.3;
  }

  async updateMemoryConfidence(memory, newConfidence) {
    const updatedMemory = {
      ...memory,
      metadata: {
        ...memory.metadata,
        confidence: newConfidence,
        confidence_updated_at: new Date().toISOString()
      }
    };

    await this.memoryStore.update(memory.namespace, memory.id, updatedMemory);

    logMemory('confidence_updated', memory.metadata.user_id, {
      memoryId: memory.id,
      oldConfidence: memory.metadata.confidence,
      newConfidence
    });

    return true;
  }

  async resolveConflict(conflict) {
    // Conflict resolution logic
    // This would analyze conflicting memories and determine resolution
    
    logMemory('conflict_analyzed', null, {
      conflictType: conflict.type,
      memoryCount: conflict.memories.length
    });

    // Simple resolution: prefer higher confidence memory
    const highestConfidence = Math.max(...conflict.memories.map(m => m.metadata.confidence));
    
    if (highestConfidence > 0.8) {
      // Auto-resolve if we have high confidence
      return { resolved: true, action: 'prefer_high_confidence' };
    } else {
      // Flag for manual review
      return { resolved: false, action: 'flag_for_review' };
    }
  }

  compressContent(content) {
    // Simple content compression - extract key points
    // In production, this would use more sophisticated NLP techniques
    
    const sentences = content.split('. ');
    const keyPoints = sentences.filter(s => s.length > 20).slice(0, 3);
    
    return keyPoints.join('. ') + '.';
  }

  async updateUserMemoryStats(userId, results) {
    // Update user-specific memory statistics
    const stats = {
      user_id: userId,
      last_maintenance: new Date().toISOString(),
      total_archived: results.archival.archived,
      total_compressed: results.compression.compressed + results.archival.compressed,
      total_deleted: results.cleanup.deleted,
      total_conflicts_resolved: results.conflicts.resolved
    };

    // Store stats (implementation depends on storage system)
    logger.debug('User memory stats updated', stats);
  }

  async performScheduledCleanup() {
    // Get list of active users (implementation depends on user management)
    const activeUsers = []; // Would be populated from user service
    
    let totalMaintained = 0;
    
    for (const userId of activeUsers) {
      try {
        await this.performMaintenanceForUser(userId, { 
          scheduled: true 
        });
        totalMaintained++;
      } catch (error) {
        logError(error, {
          operation: 'scheduledUserMaintenance',
          userId
        });
      }
    }

    logger.info('Scheduled cleanup completed', {
      usersProcessed: totalMaintained,
      totalUsers: activeUsers.length
    });
  }
}

module.exports = MemoryLifecycleManager;
