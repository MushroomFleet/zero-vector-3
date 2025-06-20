const { logger, logError, createTimer } = require('../utils/logger');
const config = require('../config');

// Import all services
const RedisManager = require('./RedisManager');
const PostgreSQLManager = require('./PostgreSQLManager');
const ApprovalService = require('./ApprovalService');
const PerformanceCacheManager = require('./PerformanceCacheManager');
const HumanApprovalAgent = require('../agents/HumanApprovalAgent');

/**
 * Service Manager
 * Orchestrates initialization and lifecycle management of all zero-vector-3 services
 * Implements the complete integration from LangGraph-DEV-HANDOFF.md
 */

class ServiceManager {
  constructor() {
    this.services = new Map();
    this.initialized = false;
    this.shutdownHandlers = [];

    logger.info('ServiceManager created');
  }

  /**
   * Initialize all services in correct order
   */
  async initialize() {
    const timer = createTimer('service_manager_initialization');

    try {
      logger.info('Starting service initialization...');

      // 1. Initialize Redis Manager
      await this.initializeRedis();

      // 2. Initialize PostgreSQL Manager
      await this.initializePostgreSQL();

      // 3. Initialize Approval Service
      await this.initializeApprovalService();

      // 4. Initialize Performance Cache Manager
      await this.initializePerformanceCacheManager();

      // 5. Initialize Human Approval Agent
      await this.initializeHumanApprovalAgent();

      // 6. Setup shutdown handlers
      this.setupShutdownHandlers();

      // 7. Start background tasks
      await this.startBackgroundTasks();

      this.initialized = true;

      timer.end({ success: true });

      logger.info('All services initialized successfully', {
        serviceCount: this.services.size,
        services: Array.from(this.services.keys())
      });

      return this.services;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'service_manager_initialization',
        initializedServices: Array.from(this.services.keys())
      });

      // Cleanup on failure
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Initialize Redis Manager
   */
  async initializeRedis() {
    const timer = createTimer('redis_manager_init');

    try {
      const redisManager = new RedisManager(config.redis);
      await redisManager.initialize();

      this.services.set('redis', redisManager);

      timer.end({ success: true });

      logger.info('Redis Manager initialized', {
        host: config.redis.host,
        port: config.redis.port,
        db: config.redis.db
      });

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'redis_manager_init' });
      throw new Error(`Failed to initialize Redis: ${error.message}`);
    }
  }

  /**
   * Initialize PostgreSQL Manager
   */
  async initializePostgreSQL() {
    const timer = createTimer('postgresql_manager_init');

    try {
      const postgresManager = new PostgreSQLManager(config.database.postgres);
      await postgresManager.initialize();

      this.services.set('postgres', postgresManager);

      timer.end({ success: true });

      logger.info('PostgreSQL Manager initialized', {
        host: config.database.postgres.host,
        port: config.database.postgres.port,
        database: config.database.postgres.database
      });

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'postgresql_manager_init' });
      throw new Error(`Failed to initialize PostgreSQL: ${error.message}`);
    }
  }

  /**
   * Initialize Approval Service
   */
  async initializeApprovalService() {
    const timer = createTimer('approval_service_init');

    try {
      const postgresManager = this.services.get('postgres');
      if (!postgresManager) {
        throw new Error('PostgreSQL Manager must be initialized before Approval Service');
      }

      const approvalService = new ApprovalService(
        postgresManager,
        config.humanInTheLoop
      );

      this.services.set('approval', approvalService);

      timer.end({ success: true });

      logger.info('Approval Service initialized', {
        defaultTimeout: config.humanInTheLoop.approvalTimeout,
        escalationEnabled: config.humanInTheLoop.approvalRequiredForSensitive
      });

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'approval_service_init' });
      throw new Error(`Failed to initialize Approval Service: ${error.message}`);
    }
  }

  /**
   * Initialize Performance Cache Manager
   */
  async initializePerformanceCacheManager() {
    const timer = createTimer('cache_manager_init');

    try {
      const redisManager = this.services.get('redis');
      if (!redisManager) {
        throw new Error('Redis Manager must be initialized before Performance Cache Manager');
      }

      const redisClient = redisManager.getClient();
      const cacheManager = new PerformanceCacheManager(redisClient, {
        redis: config.redis,
        ttl: {
          embeddings: 86400, // 24 hours
          search_results: 3600, // 1 hour
          persona_context: 1800, // 30 minutes
          user_profile: 3600, // 1 hour
          graph_relationships: 7200, // 2 hours
          memory_queries: 900 // 15 minutes
        },
        limits: {
          max_embedding_cache_size: 10000,
          max_search_cache_size: 5000,
          max_key_length: 250,
          max_value_size: 1048576 // 1MB
        },
        strategies: {
          lru_enabled: true,
          compression_enabled: true,
          batch_operations: true,
          background_refresh: true
        }
      });

      this.services.set('cache', cacheManager);

      timer.end({ success: true });

      logger.info('Performance Cache Manager initialized', {
        compressionEnabled: true,
        lruEnabled: true,
        batchOperations: true
      });

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'cache_manager_init' });
      throw new Error(`Failed to initialize Performance Cache Manager: ${error.message}`);
    }
  }

  /**
   * Initialize Human Approval Agent
   */
  async initializeHumanApprovalAgent() {
    const timer = createTimer('approval_agent_init');

    try {
      const approvalService = this.services.get('approval');
      if (!approvalService) {
        throw new Error('Approval Service must be initialized before Human Approval Agent');
      }

      const humanApprovalAgent = new HumanApprovalAgent(
        approvalService,
        config.humanInTheLoop
      );

      this.services.set('approvalAgent', humanApprovalAgent);

      timer.end({ success: true });

      logger.info('Human Approval Agent initialized', {
        riskAssessmentEnabled: config.humanInTheLoop.riskAssessmentEnabled,
        sensitiveTopics: config.humanInTheLoop.sensitive_topics.length
      });

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'approval_agent_init' });
      throw new Error(`Failed to initialize Human Approval Agent: ${error.message}`);
    }
  }

  /**
   * Start background tasks
   */
  async startBackgroundTasks() {
    const timer = createTimer('background_tasks_start');

    try {
      // Start approval service cleanup task
      const approvalService = this.services.get('approval');
      if (approvalService) {
        setInterval(async () => {
          try {
            await approvalService.performCleanup();
          } catch (error) {
            logError(error, { operation: 'approval_cleanup_task' });
          }
        }, 5 * 60 * 1000); // Every 5 minutes

        logger.debug('Approval cleanup task started');
      }

      // Start PostgreSQL maintenance task
      const postgresManager = this.services.get('postgres');
      if (postgresManager) {
        setInterval(async () => {
          try {
            await postgresManager.performMaintenance({
              checkpointRetentionDays: 30,
              approvalHistoryRetentionDays: 90,
              inactiveThreadDays: 7
            });
          } catch (error) {
            logError(error, { operation: 'postgres_maintenance_task' });
          }
        }, 24 * 60 * 60 * 1000); // Every 24 hours

        logger.debug('PostgreSQL maintenance task started');
      }

      timer.end({ success: true });

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'background_tasks_start' });
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const shutdownHandler = async (signal) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);
    process.on('SIGQUIT', shutdownHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logError(error, { operation: 'uncaught_exception' });
      await this.shutdown();
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      logError(new Error(`Unhandled promise rejection: ${reason}`), {
        operation: 'unhandled_rejection',
        promise: promise.toString()
      });
      await this.shutdown();
      process.exit(1);
    });

    logger.debug('Shutdown handlers registered');
  }

  /**
   * Get service instance
   */
  getService(serviceName) {
    if (!this.initialized) {
      throw new Error('ServiceManager not initialized. Call initialize() first.');
    }

    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found. Available services: ${Array.from(this.services.keys()).join(', ')}`);
    }

    return service;
  }

  /**
   * Get all services
   */
  getAllServices() {
    if (!this.initialized) {
      throw new Error('ServiceManager not initialized. Call initialize() first.');
    }

    return Object.fromEntries(this.services);
  }

  /**
   * Get health status of all services
   */
  async getHealthStatus() {
    const timer = createTimer('service_health_check');

    try {
      const health = {
        initialized: this.initialized,
        serviceCount: this.services.size,
        services: {},
        overall: 'healthy',
        timestamp: new Date().toISOString()
      };

      // Check Redis
      const redisManager = this.services.get('redis');
      if (redisManager) {
        try {
          const redisHealth = await redisManager.performHealthCheck();
          const redisMetrics = await redisManager.getPerformanceMetrics();
          health.services.redis = {
            status: redisHealth ? 'healthy' : 'unhealthy',
            metrics: redisMetrics
          };
        } catch (error) {
          health.services.redis = {
            status: 'unhealthy',
            error: error.message
          };
          health.overall = 'degraded';
        }
      }

      // Check PostgreSQL
      const postgresManager = this.services.get('postgres');
      if (postgresManager) {
        try {
          const postgresHealth = await postgresManager.getHealthInfo();
          health.services.postgres = {
            status: postgresHealth.healthy ? 'healthy' : 'unhealthy',
            metrics: postgresHealth
          };
        } catch (error) {
          health.services.postgres = {
            status: 'unhealthy',
            error: error.message
          };
          health.overall = 'degraded';
        }
      }

      // Check Approval Service
      const approvalService = this.services.get('approval');
      if (approvalService) {
        try {
          const approvalStats = approvalService.getStats();
          health.services.approval = {
            status: 'healthy',
            stats: approvalStats
          };
        } catch (error) {
          health.services.approval = {
            status: 'unhealthy',
            error: error.message
          };
          health.overall = 'degraded';
        }
      }

      // Check Cache Manager
      const cacheManager = this.services.get('cache');
      if (cacheManager) {
        try {
          const cacheStats = cacheManager.getStats();
          health.services.cache = {
            status: 'healthy',
            stats: cacheStats
          };
        } catch (error) {
          health.services.cache = {
            status: 'unhealthy',
            error: error.message
          };
          health.overall = 'degraded';
        }
      }

      // Check Human Approval Agent
      const approvalAgent = this.services.get('approvalAgent');
      if (approvalAgent) {
        try {
          const agentStats = approvalAgent.getStats();
          health.services.approvalAgent = {
            status: 'healthy',
            stats: agentStats
          };
        } catch (error) {
          health.services.approvalAgent = {
            status: 'unhealthy',
            error: error.message
          };
          health.overall = 'degraded';
        }
      }

      // Determine overall health
      const unhealthyServices = Object.values(health.services)
        .filter(service => service.status === 'unhealthy');

      if (unhealthyServices.length > 0) {
        health.overall = unhealthyServices.length === Object.keys(health.services).length ? 
          'unhealthy' : 'degraded';
      }

      timer.end({ 
        success: true, 
        overall: health.overall,
        serviceCount: Object.keys(health.services).length 
      });

      return health;

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'service_health_check' });
      
      return {
        initialized: this.initialized,
        serviceCount: this.services.size,
        services: {},
        overall: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get performance metrics from all services
   */
  async getPerformanceMetrics() {
    const timer = createTimer('service_performance_metrics');

    try {
      const metrics = {
        timestamp: new Date().toISOString(),
        services: {}
      };

      // Redis metrics
      const redisManager = this.services.get('redis');
      if (redisManager) {
        metrics.services.redis = await redisManager.getPerformanceMetrics();
      }

      // PostgreSQL metrics
      const postgresManager = this.services.get('postgres');
      if (postgresManager) {
        const healthInfo = await postgresManager.getHealthInfo();
        metrics.services.postgres = {
          pool_stats: postgresManager.getPoolStats(),
          health_info: healthInfo
        };
      }

      // Cache metrics
      const cacheManager = this.services.get('cache');
      if (cacheManager) {
        metrics.services.cache = cacheManager.getStats();
      }

      // Approval metrics
      const approvalService = this.services.get('approval');
      if (approvalService) {
        metrics.services.approval = approvalService.getStats();
      }

      timer.end({ success: true });

      return metrics;

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'service_performance_metrics' });
      throw error;
    }
  }

  /**
   * Graceful shutdown of all services
   */
  async shutdown() {
    const timer = createTimer('service_manager_shutdown');

    try {
      logger.info('Starting graceful shutdown of all services...');

      const shutdownPromises = [];

      // Shutdown services in reverse order of initialization
      const shutdownOrder = ['approvalAgent', 'cache', 'approval', 'postgres', 'redis'];

      for (const serviceName of shutdownOrder) {
        const service = this.services.get(serviceName);
        if (service && typeof service.shutdown === 'function') {
          shutdownPromises.push(
            service.shutdown().catch(error => {
              logError(error, {
                operation: 'service_shutdown',
                service: serviceName
              });
            })
          );
        }
      }

      // Wait for all shutdowns to complete
      await Promise.allSettled(shutdownPromises);

      this.services.clear();
      this.initialized = false;

      timer.end({ success: true });

      logger.info('All services shutdown completed');

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'service_manager_shutdown' });
    }
  }
}

// Export singleton instance
const serviceManager = new ServiceManager();

module.exports = serviceManager;
