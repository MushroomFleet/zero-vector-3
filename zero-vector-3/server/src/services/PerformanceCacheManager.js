const { logger, logError, logPerformance, createTimer } = require('../utils/logger');
const { z } = require('zod');
const crypto = require('crypto');

/**
 * Performance Cache Manager
 * Advanced caching strategies with Redis for high-performance operations
 * Implements patterns from LangGraph-DEV-HANDOFF.md Phase 3
 */

// Cache configuration schemas
const CacheConfigSchema = z.object({
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    db: z.number().default(1),
    password: z.string().optional(),
    keyPrefix: z.string().default('zv3:'),
    connectTimeout: z.number().default(10000),
    commandTimeout: z.number().default(5000)
  }),
  ttl: z.object({
    embeddings: z.number().default(86400), // 24 hours
    search_results: z.number().default(3600), // 1 hour
    persona_context: z.number().default(1800), // 30 minutes
    user_profile: z.number().default(3600), // 1 hour
    graph_relationships: z.number().default(7200), // 2 hours
    memory_queries: z.number().default(900) // 15 minutes
  }),
  limits: z.object({
    max_embedding_cache_size: z.number().default(10000),
    max_search_cache_size: z.number().default(5000),
    max_key_length: z.number().default(250),
    max_value_size: z.number().default(1048576) // 1MB
  }),
  strategies: z.object({
    lru_enabled: z.boolean().default(true),
    compression_enabled: z.boolean().default(true),
    batch_operations: z.boolean().default(true),
    background_refresh: z.boolean().default(true)
  })
});

const CacheEntrySchema = z.object({
  key: z.string(),
  value: z.any(),
  ttl: z.number(),
  tags: z.array(z.string()).default([]),
  metadata: z.object({
    created_at: z.number(),
    accessed_at: z.number(),
    access_count: z.number().default(1),
    size_bytes: z.number().optional(),
    compressed: z.boolean().default(false),
    cache_type: z.string()
  })
});

class PerformanceCacheManager {
  constructor(redisClient, config = {}) {
    this.redis = redisClient;
    this.config = CacheConfigSchema.parse(config);
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      total_size: 0,
      last_reset: Date.now()
    };
    this.lruCache = new Map(); // In-memory LRU for frequently accessed items
    this.maxLruSize = 1000;

    logger.info('PerformanceCacheManager initialized', {
      redisHost: this.config.redis.host,
      redisDb: this.config.redis.db,
      compressionEnabled: this.config.strategies.compression_enabled,
      lruEnabled: this.config.strategies.lru_enabled
    });
  }

  /**
   * Cache embedding vectors with optimized storage
   */
  async cacheEmbedding(text, embedding, options = {}) {
    const timer = createTimer('cache_embedding', { textLength: text.length });
    
    try {
      const cacheKey = this.generateEmbeddingKey(text, options);
      
      // Check size limits
      const embeddingSize = this.calculateEmbeddingSize(embedding);
      if (embeddingSize > this.config.limits.max_value_size) {
        logger.warn('Embedding too large for cache', {
          textLength: text.length,
          embeddingSize,
          limit: this.config.limits.max_value_size
        });
        return false;
      }

      // Prepare cache entry
      const cacheEntry = {
        embedding: embedding,
        text_hash: this.hashText(text),
        cached_at: Date.now(),
        access_count: 0,
        provider: options.provider || 'default',
        model: options.model || 'default'
      };

      // Compress if enabled
      if (this.config.strategies.compression_enabled) {
        cacheEntry.embedding = this.compressEmbedding(embedding);
        cacheEntry.compressed = true;
      }

      // Store in Redis
      const success = await this.setWithTTL(
        cacheKey,
        cacheEntry,
        this.config.ttl.embeddings,
        ['embeddings', options.provider, options.model].filter(Boolean)
      );

      // Update LRU cache
      if (success && this.config.strategies.lru_enabled) {
        this.updateLRU(cacheKey, cacheEntry);
      }

      const perfData = timer.end({
        cached: success,
        embeddingSize,
        compressed: cacheEntry.compressed
      });

      logPerformance('embedding_cached', perfData.duration, {
        textLength: text.length,
        embeddingSize,
        cacheKey: cacheKey.substring(0, 50)
      });

      return success;

    } catch (error) {
      timer.end({ error: true });
      this.stats.errors++;
      logError(error, {
        operation: 'cacheEmbedding',
        textLength: text.length
      });
      return false;
    }
  }

  /**
   * Retrieve cached embedding
   */
  async getCachedEmbedding(text, options = {}) {
    const timer = createTimer('get_cached_embedding', { textLength: text.length });
    
    try {
      const cacheKey = this.generateEmbeddingKey(text, options);
      
      // Check LRU cache first
      if (this.config.strategies.lru_enabled && this.lruCache.has(cacheKey)) {
        const lruEntry = this.lruCache.get(cacheKey);
        this.stats.hits++;
        
        timer.end({ source: 'lru', hit: true });
        
        return {
          vector: lruEntry.compressed ? this.decompressEmbedding(lruEntry.embedding) : lruEntry.embedding,
          cached: true,
          source: 'lru'
        };
      }

      // Check Redis cache
      const cacheEntry = await this.get(cacheKey);
      
      if (cacheEntry) {
        this.stats.hits++;
        
        // Update access statistics
        await this.updateAccessStats(cacheKey, cacheEntry);
        
        // Update LRU cache
        if (this.config.strategies.lru_enabled) {
          this.updateLRU(cacheKey, cacheEntry);
        }

        const embedding = cacheEntry.compressed ? 
          this.decompressEmbedding(cacheEntry.embedding) : 
          cacheEntry.embedding;

        timer.end({ source: 'redis', hit: true });
        
        return {
          vector: embedding,
          cached: true,
          source: 'redis',
          metadata: cacheEntry
        };
      }

      this.stats.misses++;
      timer.end({ hit: false });
      
      return null;

    } catch (error) {
      timer.end({ error: true });
      this.stats.errors++;
      logError(error, {
        operation: 'getCachedEmbedding',
        textLength: text.length
      });
      return null;
    }
  }

  /**
   * Cache search results with metadata
   */
  async cacheSearchResults(query, results, searchParams = {}) {
    const timer = createTimer('cache_search_results', { 
      queryLength: query.length,
      resultCount: results.length 
    });
    
    try {
      const cacheKey = this.generateSearchKey(query, searchParams);
      
      // Prepare cache entry
      const cacheEntry = {
        query_hash: this.hashText(query),
        results: results,
        search_params: searchParams,
        result_count: results.length,
        cached_at: Date.now(),
        access_count: 0
      };

      // Compress results if enabled
      if (this.config.strategies.compression_enabled) {
        cacheEntry.results = this.compressResults(results);
        cacheEntry.compressed = true;
      }

      const success = await this.setWithTTL(
        cacheKey,
        cacheEntry,
        this.config.ttl.search_results,
        ['search_results', searchParams.type, searchParams.persona].filter(Boolean)
      );

      const perfData = timer.end({
        cached: success,
        resultCount: results.length
      });

      logPerformance('search_results_cached', perfData.duration, {
        queryLength: query.length,
        resultCount: results.length,
        searchType: searchParams.type
      });

      return success;

    } catch (error) {
      timer.end({ error: true });
      this.stats.errors++;
      logError(error, {
        operation: 'cacheSearchResults',
        queryLength: query.length,
        resultCount: results.length
      });
      return false;
    }
  }

  /**
   * Retrieve cached search results
   */
  async getCachedSearchResults(query, searchParams = {}) {
    const timer = createTimer('get_cached_search_results', { 
      queryLength: query.length 
    });
    
    try {
      const cacheKey = this.generateSearchKey(query, searchParams);
      const cacheEntry = await this.get(cacheKey);
      
      if (cacheEntry) {
        this.stats.hits++;
        
        // Update access statistics
        await this.updateAccessStats(cacheKey, cacheEntry);

        const results = cacheEntry.compressed ? 
          this.decompressResults(cacheEntry.results) : 
          cacheEntry.results;

        timer.end({ hit: true, resultCount: results.length });
        
        return {
          results: results,
          cached: true,
          metadata: {
            cached_at: cacheEntry.cached_at,
            result_count: cacheEntry.result_count,
            access_count: cacheEntry.access_count + 1
          }
        };
      }

      this.stats.misses++;
      timer.end({ hit: false });
      
      return null;

    } catch (error) {
      timer.end({ error: true });
      this.stats.errors++;
      logError(error, {
        operation: 'getCachedSearchResults',
        queryLength: query.length
      });
      return null;
    }
  }

  /**
   * Cache persona context
   */
  async cachePersonaContext(personaId, userId, context) {
    const timer = createTimer('cache_persona_context', { personaId, userId });
    
    try {
      const cacheKey = this.generatePersonaKey(personaId, userId);
      
      const cacheEntry = {
        persona_id: personaId,
        user_id: userId,
        context: context,
        cached_at: Date.now(),
        context_hash: this.hashObject(context)
      };

      const success = await this.setWithTTL(
        cacheKey,
        cacheEntry,
        this.config.ttl.persona_context,
        ['persona_context', personaId, userId]
      );

      timer.end({ cached: success });
      
      return success;

    } catch (error) {
      timer.end({ error: true });
      this.stats.errors++;
      logError(error, {
        operation: 'cachePersonaContext',
        personaId,
        userId
      });
      return false;
    }
  }

  /**
   * Batch cache operations for efficiency
   */
  async batchCache(operations) {
    if (!this.config.strategies.batch_operations || operations.length === 0) {
      return await Promise.allSettled(operations.map(op => this.executeOperation(op)));
    }

    const timer = createTimer('batch_cache_operations', { 
      operationCount: operations.length 
    });
    
    try {
      // Group operations by type
      const groupedOps = this.groupOperations(operations);
      
      // Execute batched operations
      const results = [];
      
      for (const [opType, ops] of Object.entries(groupedOps)) {
        const batchResult = await this.executeBatchOperation(opType, ops);
        results.push(...batchResult);
      }

      timer.end({ operationCount: operations.length, successCount: results.filter(r => r.status === 'fulfilled').length });
      
      return results;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'batchCache',
        operationCount: operations.length
      });
      throw error;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags) {
    const timer = createTimer('cache_invalidation', { tagCount: tags.length });
    
    try {
      let deletedCount = 0;
      
      for (const tag of tags) {
        const keys = await this.getKeysByTag(tag);
        
        if (keys.length > 0) {
          await this.deleteMultiple(keys);
          deletedCount += keys.length;
        }
      }

      this.stats.deletes += deletedCount;

      timer.end({ deletedCount, tagCount: tags.length });
      
      logPerformance('cache_invalidated', timer.duration, {
        tags,
        deletedCount
      });

      return deletedCount;

    } catch (error) {
      timer.end({ error: true });
      this.stats.errors++;
      logError(error, {
        operation: 'invalidateByTags',
        tags
      });
      return 0;
    }
  }

  /**
   * Get cache performance statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 ? 
      this.stats.hits / (this.stats.hits + this.stats.misses) : 0;

    return {
      ...this.stats,
      hit_rate: hitRate,
      lru_cache_size: this.lruCache.size,
      uptime: Date.now() - this.stats.last_reset,
      config: this.config
    };
  }

  /**
   * Clear all cache data
   */
  async clearAll() {
    try {
      await this.redis.flushdb();
      this.lruCache.clear();
      
      this.stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        errors: 0,
        total_size: 0,
        last_reset: Date.now()
      };

      logger.info('Cache cleared successfully');
      return true;

    } catch (error) {
      logError(error, { operation: 'clearAll' });
      return false;
    }
  }

  // Private helper methods

  generateEmbeddingKey(text, options = {}) {
    const textHash = this.hashText(text);
    const provider = options.provider || 'default';
    const model = options.model || 'default';
    return `${this.config.redis.keyPrefix}emb:${provider}:${model}:${textHash}`;
  }

  generateSearchKey(query, params = {}) {
    const queryHash = this.hashText(query);
    const paramsHash = this.hashObject(params);
    return `${this.config.redis.keyPrefix}search:${queryHash}:${paramsHash}`;
  }

  generatePersonaKey(personaId, userId) {
    return `${this.config.redis.keyPrefix}persona:${personaId}:${userId}`;
  }

  hashText(text) {
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 32);
  }

  hashObject(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  calculateEmbeddingSize(embedding) {
    return Array.isArray(embedding) ? embedding.length * 8 : JSON.stringify(embedding).length;
  }

  compressEmbedding(embedding) {
    // Simple compression - in production use zlib or similar
    if (Array.isArray(embedding)) {
      return embedding.map(x => Math.round(x * 10000) / 10000); // Reduce precision
    }
    return embedding;
  }

  decompressEmbedding(compressed) {
    return compressed; // Simple passthrough - in production implement proper decompression
  }

  compressResults(results) {
    // Simple result compression - remove unnecessary metadata
    return results.map(result => ({
      content: result.content,
      score: Math.round(result.score * 1000) / 1000,
      metadata: {
        id: result.metadata?.id,
        timestamp: result.metadata?.timestamp
      }
    }));
  }

  decompressResults(compressed) {
    return compressed; // Simple passthrough
  }

  async setWithTTL(key, value, ttl, tags = []) {
    try {
      const serialized = JSON.stringify(value);
      
      // Set main key
      const result = await this.redis.setex(key, ttl, serialized);
      
      // Set tag mappings if provided
      if (tags.length > 0) {
        await this.setTagMappings(key, tags, ttl);
      }

      this.stats.sets++;
      this.stats.total_size += serialized.length;
      
      return result === 'OK';

    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async get(key) {
    try {
      const value = await this.redis.get(key);
      
      if (value) {
        return JSON.parse(value);
      }
      
      return null;

    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async setTagMappings(key, tags, ttl) {
    const pipeline = this.redis.pipeline();
    
    for (const tag of tags) {
      const tagKey = `${this.config.redis.keyPrefix}tag:${tag}`;
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, ttl + 300); // Slightly longer TTL for tag keys
    }
    
    await pipeline.exec();
  }

  async getKeysByTag(tag) {
    const tagKey = `${this.config.redis.keyPrefix}tag:${tag}`;
    return await this.redis.smembers(tagKey);
  }

  async deleteMultiple(keys) {
    if (keys.length === 0) return 0;
    
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.del(key));
    
    const results = await pipeline.exec();
    return results.reduce((count, [error, result]) => count + (error ? 0 : result), 0);
  }

  async updateAccessStats(key, entry) {
    try {
      const updatedEntry = {
        ...entry,
        access_count: (entry.access_count || 0) + 1,
        last_accessed: Date.now()
      };

      // Update with short TTL to avoid constant writes
      await this.redis.setex(key, 300, JSON.stringify(updatedEntry));

    } catch (error) {
      // Don't throw on stats update failure
      logger.debug('Failed to update access stats', { error: error.message });
    }
  }

  updateLRU(key, value) {
    // Implement simple LRU
    if (this.lruCache.size >= this.maxLruSize) {
      const firstKey = this.lruCache.keys().next().value;
      this.lruCache.delete(firstKey);
    }
    
    this.lruCache.set(key, value);
  }

  groupOperations(operations) {
    const grouped = {};
    
    for (const op of operations) {
      if (!grouped[op.type]) {
        grouped[op.type] = [];
      }
      grouped[op.type].push(op);
    }
    
    return grouped;
  }

  async executeBatchOperation(type, operations) {
    switch (type) {
      case 'set':
        return await this.batchSet(operations);
      case 'get':
        return await this.batchGet(operations);
      case 'delete':
        return await this.batchDelete(operations);
      default:
        return operations.map(op => ({ status: 'rejected', reason: 'Unknown operation type' }));
    }
  }

  async batchSet(operations) {
    const pipeline = this.redis.pipeline();
    
    for (const op of operations) {
      const serialized = JSON.stringify(op.value);
      pipeline.setex(op.key, op.ttl || 3600, serialized);
    }
    
    const results = await pipeline.exec();
    this.stats.sets += operations.length;
    
    return results.map(([error, result]) => 
      error ? { status: 'rejected', reason: error.message } : { status: 'fulfilled', value: result }
    );
  }

  async batchGet(operations) {
    const pipeline = this.redis.pipeline();
    
    for (const op of operations) {
      pipeline.get(op.key);
    }
    
    const results = await pipeline.exec();
    
    return results.map(([error, result]) => {
      if (error) {
        this.stats.errors++;
        return { status: 'rejected', reason: error.message };
      }
      
      if (result) {
        this.stats.hits++;
        return { status: 'fulfilled', value: JSON.parse(result) };
      } else {
        this.stats.misses++;
        return { status: 'fulfilled', value: null };
      }
    });
  }

  async batchDelete(operations) {
    const keys = operations.map(op => op.key);
    const deletedCount = await this.deleteMultiple(keys);
    this.stats.deletes += deletedCount;
    
    return operations.map(() => ({ status: 'fulfilled', value: true }));
  }

  async executeOperation(operation) {
    switch (operation.type) {
      case 'set':
        return await this.setWithTTL(operation.key, operation.value, operation.ttl, operation.tags);
      case 'get':
        return await this.get(operation.key);
      case 'delete':
        return await this.redis.del(operation.key);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }
}

module.exports = PerformanceCacheManager;
