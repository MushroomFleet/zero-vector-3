const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

// Import configuration and utilities
const config = require('./config');
const { logger, logError, createRequestLogger, createTimer } = require('./utils/logger');

// Import core services (these would be implemented to work with existing zero-vector-2 components)
const { ZeroVectorStateManager } = require('./state/ZeroVectorState');

// Import LangGraph components
const ZeroVectorGraph = require('./graphs/ZeroVectorGraph');
const HybridRetrievalAgent = require('./agents/HybridRetrievalAgent');
const PersonaMemoryAgent = require('./agents/PersonaMemoryAgent');
const LangChainVectorStoreAdapter = require('./services/LangChainVectorStoreAdapter');

/**
 * Zero-Vector-3 Server
 * Enhanced AI persona memory system with LangGraph integration
 */
class ZeroVector3Server {
  constructor() {
    this.app = express();
    this.server = null;
    this.graph = null;
    this.components = {};
    this.isInitialized = false;
  }

  /**
   * Initialize the server and all components
   */
  async initialize() {
    try {
      logger.info('Initializing Zero-Vector-3 server...', {
        nodeEnv: config.server.nodeEnv,
        port: config.server.port,
        langGraphEnabled: config.langGraph.tracingEnabled
      });

      // Setup Express middleware
      this.setupMiddleware();

      // Initialize core services (placeholder - would integrate with existing zero-vector-2)
      await this.initializeCoreServices();

      // Initialize LangGraph components
      await this.initializeLangGraphComponents();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      this.isInitialized = true;
      logger.info('Zero-Vector-3 server initialized successfully');

    } catch (error) {
      logError(error, {
        operation: 'serverInitialization',
        stage: 'initialization'
      });
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Request ID middleware
    this.app.use((req, res, next) => {
      req.id = uuidv4();
      next();
    });

    // Security middleware
    if (config.security.helmet.enabled) {
      this.app.use(helmet({
        contentSecurityPolicy: config.security.helmet.contentSecurityPolicy,
        crossOriginEmbedderPolicy: config.security.helmet.crossOriginEmbedderPolicy
      }));
    }

    // CORS
    this.app.use(cors({
      origin: config.security.corsOrigin,
      credentials: true
    }));

    // Compression
    this.app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.security.rateLimiting.windowMs,
      max: config.security.rateLimiting.maxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: config.security.rateLimiting.skipSuccessfulRequests,
      skipFailedRequests: config.security.rateLimiting.skipFailedRequests
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use(createRequestLogger());

    logger.info('Express middleware configured');
  }

  /**
   * Initialize core services (placeholder for zero-vector-2 integration)
   */
  async initializeCoreServices() {
    try {
      // Note: These would be actual implementations that integrate with zero-vector-2
      // For now, creating placeholder implementations
      
      logger.info('Initializing core services...');

      // Initialize hybrid vector store (would use existing zero-vector-2 implementation)
      this.components.hybridVectorStore = await this.createMockHybridVectorStore();

      // Initialize embedding service (would use existing zero-vector-2 implementation)
      this.components.embeddingService = await this.createMockEmbeddingService();

      // Initialize memory manager (would use existing zero-vector-2 implementation)
      this.components.hybridMemoryManager = await this.createMockMemoryManager();

      // Initialize graph service (would use existing zero-vector-2 implementation)
      this.components.graphService = await this.createMockGraphService();

      // Initialize LLM service (optional)
      this.components.llmService = await this.createMockLLMService();

      logger.info('Core services initialized successfully');

    } catch (error) {
      logError(error, {
        operation: 'initializeCoreServices'
      });
      throw error;
    }
  }

  /**
   * Initialize LangGraph components
   */
  async initializeLangGraphComponents() {
    try {
      logger.info('Initializing LangGraph components...');

      // Create LangChain vector store adapter
      this.components.langChainAdapter = new LangChainVectorStoreAdapter(
        this.components.hybridVectorStore,
        this.components.embeddingService
      );

      // Create agents
      this.components.hybridRetrievalAgent = new HybridRetrievalAgent(
        this.components.hybridVectorStore,
        this.components.embeddingService,
        this.components.graphService
      );

      this.components.personaMemoryAgent = new PersonaMemoryAgent(
        this.components.hybridMemoryManager,
        this.components.embeddingService,
        this.components.llmService
      );

      // Create checkpointer (would use PostgreSQL in production)
      this.components.checkpointer = await this.createMockCheckpointer();

      // Create main workflow graph
      this.components.zeroVectorGraph = new ZeroVectorGraph({
        hybridRetrievalAgent: this.components.hybridRetrievalAgent,
        personaMemoryAgent: this.components.personaMemoryAgent,
        reasoningAgent: null, // Optional - could be added later
        approvalAgent: null, // Optional - could be added later
        checkpointer: this.components.checkpointer,
        config: config
      });

      // Compile the graph
      this.graph = this.components.zeroVectorGraph.createGraph();

      logger.info('LangGraph components initialized successfully', {
        graphCompiled: !!this.graph,
        agentCount: 2,
        checkpointerEnabled: !!this.components.checkpointer
      });

    } catch (error) {
      logError(error, {
        operation: 'initializeLangGraphComponents'
      });
      throw error;
    }
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Import route modules
    const langGraphRoutes = require('./routes/langgraph');

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        services: {
          langGraph: !!this.graph,
          vectorStore: !!this.components.hybridVectorStore,
          embeddingService: !!this.components.embeddingService,
          memoryManager: !!this.components.hybridMemoryManager
        }
      });
    });

    // Register LangGraph workflow routes
    this.app.use('/api/v3/langgraph', langGraphRoutes);

    // Main chat endpoint with LangGraph workflow
    this.app.post('/api/chat', async (req, res) => {
      const timer = createTimer('chat_request', { requestId: req.id });
      
      try {
        const { message, persona, userId, conversationId } = req.body;

        if (!message) {
          return res.status(400).json({
            error: 'Message is required',
            code: 'MISSING_MESSAGE'
          });
        }

        if (!userId) {
          return res.status(400).json({
            error: 'User ID is required',
            code: 'MISSING_USER_ID'
          });
        }

        logger.info('Processing chat request', {
          requestId: req.id,
          userId,
          persona: persona || 'default',
          messageLength: message.length,
          conversationId
        });

        // Create initial state
        const initialState = ZeroVectorStateManager.createState({
          messages: [{
            type: 'human',
            content: message,
            id: uuidv4(),
            timestamp: Date.now()
          }],
          user_profile: {
            id: userId,
            authenticated: true
          },
          active_persona: persona || 'helpful_assistant',
          session_id: req.id,
          conversation_id: conversationId || uuidv4(),
          request_id: req.id
        });

        // Execute workflow
        const result = await this.graph.invoke(initialState, {
          configurable: {
            thread_id: conversationId || uuidv4(),
            user_id: userId
          }
        });

        // Extract response
        const aiMessages = result.messages?.filter(m => m.type === 'ai') || [];
        const latestResponse = aiMessages[aiMessages.length - 1];

        if (!latestResponse) {
          throw new Error('No response generated from workflow');
        }

        const perfData = timer.end({
          messageCount: result.messages?.length || 0,
          vectorResults: result.vector_results?.length || 0,
          workflowSteps: result.execution_metadata?.step_count || 0
        });

        res.json({
          response: latestResponse.content,
          metadata: {
            persona: result.active_persona,
            processingTime: perfData.duration,
            vectorResults: result.vector_results?.length || 0,
            memoryContext: result.memory_context,
            workflowContext: {
              steps: result.workflow_context?.completed_steps || [],
              executionTime: result.execution_metadata?.execution_time_ms
            }
          },
          conversationId: result.conversation_id,
          requestId: req.id
        });

      } catch (error) {
        timer.end({ error: true });
        logError(error, {
          operation: 'chatRequest',
          requestId: req.id,
          userId: req.body?.userId
        });

        res.status(500).json({
          error: 'Failed to process chat request',
          code: 'CHAT_PROCESSING_ERROR',
          requestId: req.id
        });
      }
    });

    // Get conversation history
    this.app.get('/api/conversations/:conversationId', async (req, res) => {
      try {
        const { conversationId } = req.params;
        
        // This would retrieve from checkpointer/database
        // For now, returning placeholder
        res.json({
          conversationId,
          messages: [],
          metadata: {
            created: new Date().toISOString(),
            lastUpdate: new Date().toISOString()
          }
        });

      } catch (error) {
        logError(error, {
          operation: 'getConversation',
          conversationId: req.params.conversationId
        });

        res.status(500).json({
          error: 'Failed to retrieve conversation',
          code: 'CONVERSATION_RETRIEVAL_ERROR'
        });
      }
    });

    // Get system statistics
    this.app.get('/api/stats', async (req, res) => {
      try {
        const stats = {
          system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version
          },
          agents: {
            hybridRetrieval: this.components.hybridRetrievalAgent?.getPerformanceStats?.() || {},
            personaMemory: this.components.personaMemoryAgent?.getPerformanceStats?.() || {}
          },
          services: {
            vectorStore: this.components.hybridVectorStore?.getStats?.() || {},
            langChain: this.components.langChainAdapter?.getStats?.() || {}
          }
        };

        res.json(stats);

      } catch (error) {
        logError(error, {
          operation: 'getStats'
        });

        res.status(500).json({
          error: 'Failed to retrieve statistics',
          code: 'STATS_RETRIEVAL_ERROR'
        });
      }
    });

    logger.info('API routes configured');
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: req.path
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      logError(error, {
        operation: 'expressErrorHandler',
        requestId: req.id,
        url: req.url,
        method: req.method
      });

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId: req.id
      });
    });

    logger.info('Error handling configured');
  }

  /**
   * Start the server
   */
  async start() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      this.server = this.app.listen(config.server.port, config.server.host, () => {
        logger.info('Zero-Vector-3 server started successfully', {
          host: config.server.host,
          port: config.server.port,
          nodeEnv: config.server.nodeEnv,
          pid: process.pid
        });
      });

      // Graceful shutdown handling
      this.setupGracefulShutdown();

    } catch (error) {
      logError(error, {
        operation: 'serverStart'
      });
      throw error;
    }
  }

  /**
   * Setup graceful shutdown
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
          process.exit(0);
        });

        // Force close after 30 seconds
        setTimeout(() => {
          logger.error('Forcing server close after timeout');
          process.exit(1);
        }, 30000);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Mock implementations (would be replaced with actual zero-vector-2 integrations)
   */
  async createMockHybridVectorStore() {
    return {
      search: async (embedding, options) => {
        logger.debug('Mock hybrid vector store search', { optionsLimit: options.limit });
        return [];
      },
      addVector: async (content, embedding, metadata) => {
        logger.debug('Mock add vector', { contentLength: content.length });
        return { id: uuidv4() };
      },
      deleteVector: async (id) => {
        logger.debug('Mock delete vector', { id });
        return true;
      },
      hybridSearch: async (embedding, options) => {
        logger.debug('Mock hybrid search', { optionsLimit: options.limit });
        return [];
      },
      findRelatedEntities: async (entityId, options) => {
        logger.debug('Mock find related entities', { entityId });
        return [];
      },
      getStats: () => ({
        vectorCount: 0,
        indexedCount: 0,
        graphEnabled: true
      }),
      graphEnabled: true,
      entityExtractionEnabled: true
    };
  }

  async createMockEmbeddingService() {
    return {
      generateEmbedding: async (text, options) => {
        logger.debug('Mock generate embedding', { textLength: text.length });
        return {
          vector: new Array(1536).fill(0).map(() => Math.random()),
          cached: false
        };
      },
      defaultProvider: 'openai'
    };
  }

  async createMockMemoryManager() {
    return {
      retrieveRelevantMemories: async (personaId, query, options) => {
        logger.debug('Mock retrieve memories', { personaId, queryLength: query.length });
        return [];
      },
      addMemory: async (personaId, content, metadata) => {
        logger.debug('Mock add memory', { personaId, contentLength: content.length });
        return { id: uuidv4() };
      },
      database: null
    };
  }

  async createMockGraphService() {
    return {
      query: async (cypher, params) => {
        logger.debug('Mock graph query', { cypher: cypher.substring(0, 50) });
        return [];
      }
    };
  }

  async createMockLLMService() {
    return {
      generateResponse: async (prompt, options) => {
        logger.debug('Mock LLM generation', { promptLength: prompt.length });
        return "I'm a mock response. In a real implementation, this would use an actual LLM service.";
      }
    };
  }

  async createMockCheckpointer() {
    // In production, this would be a PostgreSQL or Redis checkpointer
    return {
      put: async (config, checkpoint) => {
        logger.debug('Mock checkpointer put', { config });
      },
      get: async (config) => {
        logger.debug('Mock checkpointer get', { config });
        return null;
      },
      list: async (config) => {
        logger.debug('Mock checkpointer list', { config });
        return [];
      }
    };
  }
}

// Create and export server instance
const server = new ZeroVector3Server();

// Start server if this file is run directly
if (require.main === module) {
  server.start().catch((error) => {
    logger.error('Failed to start server', error);
    process.exit(1);
  });
}

module.exports = server;
