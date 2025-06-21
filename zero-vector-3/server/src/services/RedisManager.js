const Redis = require('ioredis');
const { logger, logError, logPerformance, createTimer } = require('../utils/logger');
const { z } = require('zod');

/**
 * Redis Manager
 * Manages Redis connections, health checks, and connection recovery
 * Integrates with PerformanceCacheManager for zero-vector-3
 */

const RedisConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  keyPrefix: z.string().default('zv3:'),
  connectTimeout: z.number().default(10000),
  commandTimeout: z.number().default(5000),
  lazyConnect: z.boolean().default(true),
  maxRetriesPerRequest: z.number().default(3),
  retryDelayOnFailover: z.number().default(100),
  enableOfflineQueue: z.boolean().default(false),
  maxMemoryPolicy: z.string().default('allkeys-lru'),
  keepAlive: z.number().default(30000)
});

class RedisManager {
  constructor(config = {}) {
    this.config = RedisConfigSchema.parse(config);
    this.client = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.healthCheckInterval = null;
    this.connectionStats = {
      totalConnections: 0,
      totalDisconnections: 0,
      totalErrors: 0,
      lastConnected: null,
      lastDisconnected: null,
      uptime: 0
    };

    logger.info('RedisManager initialized', {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      keyPrefix: this.config.keyPrefix
    });
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    const timer = createTimer('redis_initialization');

    try {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix,
        connectTimeout: this.config.connectTimeout,
        commandTimeout: this.config.commandTimeout,
        lazyConnect: this.config.lazyConnect,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        retryDelayOnFailover: this.config.retryDelayOnFailover,
        enableOfflineQueue: this.config.enableOfflineQueue,
        keepAlive: this.config.keepAlive,
        family: 4, // Force IPv4
        retryDelayOnClusterDown: 300,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Connect if not lazy connecting
      if (!this.config.lazyConnect) {
        // Wait for automatic connection to complete
        await new Promise((resolve, reject) => {
          if (this.client.status === 'ready') {
            resolve();
          } else {
            this.client.once('ready', resolve);
            this.client.once('error', reject);
          }
        });
      }

      // Start health checking
      this.startHealthChecking();

      timer.end({ success: true });

      logger.info('Redis client initialized successfully', {
        lazyConnect: this.config.lazyConnect,
        host: this.config.host,
        port: this.config.port
      });

      return this.client;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'redis_initialization',
        config: { ...this.config, password: '[REDACTED]' }
      });
      throw error;
    }
  }

  /**
   * Explicit connection method
   */
  async connect() {
    const timer = createTimer('redis_connect');

    try {
      if (this.connected) {
        logger.debug('Redis already connected');
        return this.client;
      }

      await this.client.connect();
      
      timer.end({ success: true });
      
      return this.client;

    } catch (error) {
      timer.end({ error: true });
      this.connectionStats.totalErrors++;
      logError(error, {
        operation: 'redis_connect',
        reconnectAttempts: this.reconnectAttempts
      });
      throw error;
    }
  }

  /**
   * Setup Redis event handlers
   */
  setupEventHandlers() {
    this.client.on('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.connectionStats.totalConnections++;
      this.connectionStats.lastConnected = new Date().toISOString();
      
      logger.info('Redis connected successfully', {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db
      });
    });

    this.client.on('ready', () => {
      logger.info('Redis ready for commands', {
        host: this.config.host,
        db: this.config.db
      });
      
      // Configure Redis settings
      this.configureRedisSettings();
    });

    this.client.on('error', (error) => {
      this.connectionStats.totalErrors++;
      logError(error, {
        operation: 'redis_error',
        connected: this.connected,
        reconnectAttempts: this.reconnectAttempts
      });
    });

    this.client.on('close', () => {
      this.connected = false;
      this.connectionStats.totalDisconnections++;
      this.connectionStats.lastDisconnected = new Date().toISOString();
      
      logger.warn('Redis connection closed', {
        host: this.config.host,
        reconnectAttempts: this.reconnectAttempts
      });
    });

    this.client.on('reconnecting', (delay) => {
      this.reconnectAttempts++;
      logger.info('Redis reconnecting', {
        attempt: this.reconnectAttempts,
        delay,
        maxAttempts: this.maxReconnectAttempts
      });
    });

    this.client.on('end', () => {
      this.connected = false;
      logger.info('Redis connection ended');
    });
  }

  /**
   * Configure Redis runtime settings
   */
  async configureRedisSettings() {
    try {
      // Set maxmemory policy if needed
      const currentPolicy = await this.client.config('GET', 'maxmemory-policy');
      if (currentPolicy[1] !== this.config.maxMemoryPolicy) {
        await this.client.config('SET', 'maxmemory-policy', this.config.maxMemoryPolicy);
        logger.info('Redis maxmemory policy set', {
          policy: this.config.maxMemoryPolicy
        });
      }

      // Enable keyspace notifications for cache invalidation
      await this.client.config('SET', 'notify-keyspace-events', 'Ex');
      
    } catch (error) {
      logError(error, {
        operation: 'configureRedisSettings'
      });
    }
  }

  /**
   * Start health checking
   */
  startHealthChecking() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 30000); // Check every 30 seconds

    logger.debug('Redis health checking started');
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    const timer = createTimer('redis_health_check');

    try {
      const start = Date.now();
      const result = await this.client.ping();
      const latency = Date.now() - start;

      if (result === 'PONG') {
        this.connectionStats.uptime = Date.now() - (this.connectionStats.lastConnected ? 
          new Date(this.connectionStats.lastConnected).getTime() : Date.now());

        timer.end({ 
          healthy: true, 
          latency,
          uptime: this.connectionStats.uptime 
        });

        // Log slow health checks
        if (latency > 1000) {
          logger.warn('Slow Redis health check', { latency });
        }

        return true;
      } else {
        timer.end({ healthy: false });
        logger.error('Redis health check failed', { result });
        return false;
      }

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'redis_health_check',
        connected: this.connected
      });
      return false;
    }
  }

  /**
   * Get Redis client
   */
  getClient() {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      reconnectAttempts: this.reconnectAttempts,
      stats: this.connectionStats
    };
  }

  /**
   * Get Redis server info
   */
  async getServerInfo() {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const info = await this.client.info();
      const memory = await this.client.info('memory');
      const stats = await this.client.info('stats');

      return {
        server: this.parseInfo(info),
        memory: this.parseInfo(memory),
        stats: this.parseInfo(stats),
        connected_clients: await this.client.info('clients')
      };

    } catch (error) {
      logError(error, { operation: 'getServerInfo' });
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const keyCount = await this.client.dbsize();
      
      // Use INFO memory instead of MEMORY USAGE for compatibility
      let memoryUsage = 0;
      try {
        const memoryInfo = await this.client.info('memory');
        const parsedMemory = this.parseInfo(memoryInfo);
        memoryUsage = parsedMemory.used_memory || 0;
      } catch (memoryError) {
        logger.debug('Could not get memory usage info', { error: memoryError.message });
      }
      
      // Get key distribution by prefix
      const keys = await this.client.keys(`${this.config.keyPrefix}*`);
      const keysByType = {};
      
      for (const key of keys.slice(0, 1000)) { // Limit to first 1000 keys
        const type = key.split(':')[1] || 'unknown';
        keysByType[type] = (keysByType[type] || 0) + 1;
      }

      return {
        total_keys: keyCount,
        memory_usage: memoryUsage,
        keys_by_type: keysByType,
        sample_size: Math.min(keys.length, 1000),
        total_sampled: keys.length
      };

    } catch (error) {
      logError(error, { operation: 'getCacheStats' });
      return {
        total_keys: 0,
        memory_usage: 0,
        keys_by_type: {},
        error: error.message
      };
    }
  }

  /**
   * Flush cache by pattern
   */
  async flushByPattern(pattern) {
    const timer = createTimer('redis_flush_pattern', { pattern });

    try {
      if (!this.connected) {
        await this.connect();
      }

      const keys = await this.client.keys(pattern);
      
      if (keys.length === 0) {
        timer.end({ deletedKeys: 0 });
        return 0;
      }

      // Delete in batches to avoid blocking
      const batchSize = 1000;
      let deletedCount = 0;

      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const pipeline = this.client.pipeline();
        
        batch.forEach(key => pipeline.del(key));
        const results = await pipeline.exec();
        
        deletedCount += results.reduce((count, [error, result]) => 
          count + (error ? 0 : result), 0);
      }

      timer.end({ deletedKeys: deletedCount });

      logger.info('Redis cache flushed by pattern', {
        pattern,
        deletedKeys: deletedCount,
        totalKeys: keys.length
      });

      return deletedCount;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'flushByPattern',
        pattern
      });
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    const timer = createTimer('redis_shutdown');

    try {
      // Stop health checking
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Close Redis connection
      if (this.client) {
        await this.client.quit();
        this.client = null;
        this.connected = false;
      }

      timer.end({ success: true });

      logger.info('Redis manager shutdown completed');

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'redis_shutdown' });
    }
  }

  // Helper methods

  parseInfo(infoString) {
    const info = {};
    const lines = infoString.split('\r\n');
    
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value !== undefined) {
          // Try to parse as number
          const numValue = parseFloat(value);
          info[key] = isNaN(numValue) ? value : numValue;
        }
      }
    }
    
    return info;
  }

  /**
   * Create performance monitoring metrics
   */
  async getPerformanceMetrics() {
    try {
      const serverInfo = await this.getServerInfo();
      const cacheStats = await this.getCacheStats();
      const status = this.getStatus();

      return {
        connection: {
          connected: status.connected,
          uptime: status.stats.uptime,
          total_connections: status.stats.totalConnections,
          total_errors: status.stats.totalErrors,
          reconnect_attempts: status.reconnectAttempts
        },
        performance: {
          keys: cacheStats.total_keys,
          memory_usage: cacheStats.memory_usage,
          hit_rate: serverInfo?.stats?.keyspace_hits / 
            (serverInfo?.stats?.keyspace_hits + serverInfo?.stats?.keyspace_misses) || 0
        },
        server: {
          version: serverInfo?.server?.redis_version,
          uptime_seconds: serverInfo?.server?.uptime_in_seconds,
          connected_clients: serverInfo?.server?.connected_clients,
          used_memory: serverInfo?.memory?.used_memory,
          used_memory_human: serverInfo?.memory?.used_memory_human
        }
      };

    } catch (error) {
      logError(error, { operation: 'getPerformanceMetrics' });
      return {
        connection: { connected: false, error: error.message },
        performance: {},
        server: {}
      };
    }
  }
}

module.exports = RedisManager;
