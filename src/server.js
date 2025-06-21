const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const { logger, logApiRequest, logError } = require('./utils/logger');
const DatabaseRepository = require('./repositories/database');
const HybridVectorStore = require('./services/HybridVectorStore');

// Import services
const UserService = require('./services/userService');
const ApiKeyService = require('./services/apiKeyService');
const JwtService = require('./services/jwtService');

// Import middleware
const performanceMiddleware = require('./middleware/performance');
const { errorHandler } = require('./middleware/errorHandler');
const { globalRateLimiter } = require('./middleware/rateLimiting');
const authenticateApiKey = require('./middleware/authenticateApiKey');
const authenticateJWT = require('./middleware/authenticateJWT');

// Import routes
const vectorRoutes = require('./routes/vectors');
const embeddingRoutes = require('./routes/embeddings');
const personaRoutes = require('./routes/personas');
const healthRoutes = require('./routes/health');
const createAuthRoutes = require('./routes/auth');

// Import memory management services
const EmbeddingService = require('./services/embedding/EmbeddingService');
const LocalTransformersProvider = require('./services/embedding/LocalTransformersProvider');
const OpenAIProvider = require('./services/embedding/OpenAIProvider');
const HybridPersonaMemoryManager = require('./services/HybridPersonaMemoryManager');

/**
 * Zero-Vector Server
 * Main application entry point
 */
class ZeroVectorServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.database = null;
    this.vectorStore = null;
    this.userService = null;
    this.apiKeyService = null;
    this.jwtService = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the server
   */
  async initialize() {
    try {
      logger.info('Initializing Zero-Vector Server...');

      // Initialize database
      await this.initializeDatabase();

      // Initialize authentication services
      await this.initializeAuthServices();

      // Initialize vector store
      await this.initializeVectorStore();

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      logger.info('Zero-Vector Server initialized successfully');

    } catch (error) {
      logError(error, { operation: 'server_initialization' });
      throw error;
    }
  }

  /**
   * Initialize database connection
   */
  async initializeDatabase() {
    this.database = new DatabaseRepository();
    await this.database.initialize();
    
    // Make database available to routes via app context
    this.app.set('database', this.database);
    
    logger.info('Database initialized successfully');
  }

  /**
   * Initialize authentication services
   */
  async initializeAuthServices() {
    // Initialize JWT service
    this.jwtService = new JwtService();

    // Initialize user service
    this.userService = new UserService(this.database);

    // Initialize API key service
    this.apiKeyService = new ApiKeyService(this.database);

    // Make auth services available to routes via app context
    this.app.set('userService', this.userService);
    this.app.set('apiKeyService', this.apiKeyService);
    this.app.set('jwtService', this.jwtService);

    logger.info('Authentication services initialized successfully');
  }

  /**
   * Initialize vector store
   */
  async initializeVectorStore() {
    // Initialize embedding service first
    const embeddingService = new EmbeddingService();
    
    // Register the local transformer provider
    const localProvider = new LocalTransformersProvider();
    embeddingService.registerProvider('local', localProvider);
    
    // Register the OpenAI provider if API key is available
    if (config.embeddings.openaiApiKey) {
      try {
        const openaiProvider = new OpenAIProvider({
          apiKey: config.embeddings.openaiApiKey,
          model: config.embeddings.model
        });
        embeddingService.registerProvider('openai', openaiProvider);
        logger.info('OpenAI provider registered successfully');
      } catch (error) {
        logger.warn('Failed to register OpenAI provider', { error: error.message });
      }
    } else {
      logger.info('OpenAI API key not found, skipping OpenAI provider registration');
    }
    
    // Set default provider based on configuration
    const defaultProvider = config.embeddings.provider || 'local';
    embeddingService.setDefaultProvider(defaultProvider);
    
    // Store embedding service for use in other parts of the app
    this.embeddingService = embeddingService;
    this.app.set('embeddingService', embeddingService);

    // Initialize hybrid vector store
    this.vectorStore = new HybridVectorStore(
      config.vectorDb.maxMemoryMB,
      config.vectorDb.defaultDimensions,
      {
        M: 16,
        efConstruction: 200,
        efSearch: 50,
        distanceFunction: 'cosine',
        indexThreshold: 100
      },
      this.database,
      embeddingService
    );

    // Make vector store available to routes via app context
    this.app.set('vectorStore', this.vectorStore);

    logger.info('Hybrid vector store initialized successfully', {
      graphEnabled: this.vectorStore.graphEnabled,
      entityExtractionEnabled: this.vectorStore.entityExtractionEnabled
    });

    // Reload existing memories from database
    await this.reloadExistingMemories();
  }

  /**
   * Reload existing memories from database into vector store
   * This ensures memories persist across server restarts
   */
  async reloadExistingMemories() {
    try {
      logger.info('Checking for existing memories to reload...');

      // Initialize embedding service with proper providers
      const embeddingService = new EmbeddingService();
      
      // Register the local transformer provider
      const localProvider = new LocalTransformersProvider();
      embeddingService.registerProvider('local', localProvider);
      
      // Register the OpenAI provider if API key is available
      if (config.embeddings.openaiApiKey) {
        try {
          const openaiProvider = new OpenAIProvider({
            apiKey: config.embeddings.openaiApiKey,
            model: config.embeddings.model
          });
          embeddingService.registerProvider('openai', openaiProvider);
          logger.info('OpenAI provider registered for memory reload');
        } catch (error) {
          logger.warn('Failed to register OpenAI provider for reload', { error: error.message });
        }
      }
      
      // Set default provider based on configuration
      const defaultProvider = config.embeddings.provider || 'local';
      embeddingService.setDefaultProvider(defaultProvider);
      
      // Initialize hybrid persona memory manager for reload functionality
      const memoryManager = new HybridPersonaMemoryManager(
        this.database,
        this.vectorStore,
        embeddingService
      );

      // Reload memories from database
      const reloadResult = await memoryManager.reloadMemoriesFromDatabase();

      if (reloadResult.reloaded > 0) {
        logger.info('Memory reload completed successfully', {
          reloaded: reloadResult.reloaded,
          errors: reloadResult.errors,
          vectorStoreCount: this.vectorStore.vectorCount
        });
      } else {
        logger.info('No existing memories found to reload');
      }

    } catch (error) {
      // Log error but don't fail server startup
      logError(error, { operation: 'reloadExistingMemories' });
      logger.warn('Memory reload failed, but server will continue with empty vector store');
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      },
      crossOriginEmbedderPolicy: false
    }));

    // CORS middleware
    this.app.use(cors({
      origin: config.server.nodeEnv === 'production' 
        ? ['https://yourdomain.com'] // Update in production
        : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Body parsing middleware
    this.app.use(express.json({ 
      limit: '50mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Performance monitoring middleware
    this.app.use(performanceMiddleware);

    // Request logging middleware
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logApiRequest(req, res, duration);
      });
      
      next();
    });

    // Add server context to requests
    this.app.use((req, res, next) => {
      req.vectorStore = this.vectorStore;
      req.database = this.database;
      req.userService = this.userService;
      req.apiKeyService = this.apiKeyService;
      req.jwtService = this.jwtService;
      next();
    });

    logger.info('Middleware setup completed');
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Apply global rate limiting to all routes except health
    this.app.use('/api', globalRateLimiter);

    // Health check routes (no auth required)
    this.app.use('/health', healthRoutes);

    // Authentication routes
    const authRoutes = createAuthRoutes(this.userService, this.jwtService, this.apiKeyService);
    this.app.use('/auth', authRoutes);

    // Protected API routes
    this.app.use('/api/vectors', vectorRoutes);
    this.app.use('/api/embeddings', embeddingRoutes);
    this.app.use('/api/personas', authenticateApiKey(this.apiKeyService), personaRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Zero-Vector Server',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          auth: '/auth',
          vectors: '/api/vectors'
        }
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        availableEndpoints: [
          'GET /',
          'GET /health',
          'POST /auth/register',
          'POST /auth/login',
          'POST /api/vectors',
          'GET /api/vectors/search'
        ]
      });
    });

    logger.info('Routes setup completed');
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Global error handler
    this.app.use(errorHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logError(error, { event: 'uncaught_exception' });
      
      if (!this.isShuttingDown) {
        this.gracefulShutdown('UNCAUGHT_EXCEPTION');
      }
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logError(new Error(`Unhandled Rejection: ${reason}`), { 
        event: 'unhandled_rejection',
        promise: promise.toString()
      });
    });

    logger.info('Error handling setup completed');
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      this.gracefulShutdown(signal);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
  }

  /**
   * Start the server
   */
  async start() {
    try {
      await this.initialize();

      this.server = this.app.listen(config.server.port, config.server.host, () => {
        logger.info(`Zero-Vector Server running on ${config.server.host}:${config.server.port}`);
        logger.info(`Environment: ${config.server.nodeEnv}`);
        logger.info(`Vector Store: ${config.vectorDb.maxMemoryMB}MB, ${config.vectorDb.defaultDimensions}D`);
        logger.info(`Database: ${config.database.path}`);
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.syscall !== 'listen') {
          throw error;
        }

        const bind = typeof config.server.port === 'string'
          ? 'Pipe ' + config.server.port
          : 'Port ' + config.server.port;

        switch (error.code) {
          case 'EACCES':
            logError(new Error(`${bind} requires elevated privileges`));
            process.exit(1);
            break;
          case 'EADDRINUSE':
            logError(new Error(`${bind} is already in use`));
            process.exit(1);
            break;
          default:
            throw error;
        }
      });

      return this.server;

    } catch (error) {
      logError(error, { operation: 'server_start' });
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Graceful shutdown initiated by ${signal}`);

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Close database connection
      if (this.database) {
        await this.database.close();
        logger.info('Database connection closed');
      }

      // Cleanup vector store
      if (this.vectorStore) {
        this.vectorStore.cleanup();
        logger.info('Vector store cleaned up');
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logError(error, { operation: 'graceful_shutdown' });
      process.exit(1);
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      server: {
        uptime: uptime,
        memoryUsage: {
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024) // MB
        },
        platform: process.platform,
        nodeVersion: process.version
      },
      vectorStore: this.vectorStore ? this.vectorStore.getStats() : null,
      config: {
        maxMemoryMB: config.vectorDb.maxMemoryMB,
        defaultDimensions: config.vectorDb.defaultDimensions,
        indexType: config.vectorDb.indexType,
        distanceMetric: config.vectorDb.distanceMetric
      }
    };
  }
}

// Create and export server instance
const server = new ZeroVectorServer();

// Start server if this file is run directly
if (require.main === module) {
  server.start().catch((error) => {
    logError(error, { operation: 'server_startup' });
    process.exit(1);
  });
}

module.exports = server;
