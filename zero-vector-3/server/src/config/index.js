const path = require('path');
require('dotenv').config();

/**
 * Zero-Vector-3 Configuration
 * Enhanced configuration with LangChain and LangGraph integration
 */
const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT) || 3001,
    host: process.env.HOST || 'localhost',
    nodeEnv: process.env.NODE_ENV || 'development'
  },

  // Database configuration (SQLite for vectors, PostgreSQL for LangGraph)
  database: {
    path: process.env.DATABASE_PATH || path.join(__dirname, '../../data/vectordb.sqlite'),
    postgres: {
      url: process.env.POSTGRES_URL || 'postgresql://localhost:5432/zerovector3',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT) || 5432,
      user: process.env.POSTGRES_USER || 'zerovector',
      password: process.env.POSTGRES_PASSWORD || '',
      database: process.env.POSTGRES_DATABASE || 'zerovector3',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
  },

  // Redis configuration for high-performance caching
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379/0',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0,
    keyPrefix: 'zv3:',
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: true,
    connectTimeout: 10000,
    commandTimeout: 5000
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },

  // API Key configuration
  apiKey: {
    secret: process.env.API_KEY_SECRET || 'your-api-key-secret-change-this-in-production'
  },

  // Embedding configuration
  embeddings: {
    provider: process.env.EMBEDDING_PROVIDER || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY,
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS) || 1536,
    localModel: process.env.LOCAL_EMBEDDING_MODEL || 'all-MiniLM-L6-v2',
    cacheEnabled: true,
    maxCacheSize: 10000
  },

  // Vector database configuration
  vectorDb: {
    maxMemoryMB: parseInt(process.env.VECTOR_DB_MAX_MEMORY_MB) || 2048,
    defaultDimensions: parseInt(process.env.VECTOR_DB_DEFAULT_DIMENSIONS) || 1536,
    indexType: process.env.VECTOR_DB_INDEX_TYPE || 'hnsw',
    distanceMetric: process.env.VECTOR_DB_DISTANCE_METRIC || 'cosine',
    // HNSW parameters
    hnsw: {
      M: 16,
      efConstruction: 200,
      efSearch: 50,
      indexThreshold: 100
    }
  },

  // LangChain/LangGraph configuration
  langGraph: {
    checkpointBackend: process.env.LANGGRAPH_CHECKPOINT_BACKEND || 'postgres',
    tracingEnabled: process.env.LANGGRAPH_TRACING === 'true',
    langsmithApiKey: process.env.LANGSMITH_API_KEY,
    langsmithProject: process.env.LANGSMITH_PROJECT || 'zero-vector-3',
    maxExecutionTime: 300000, // 5 minutes
    maxStateSize: 10485760, // 10MB
    interruptTimeout: 300000, // 5 minutes
    enableCheckpointing: true
  },

  // Graph database configuration
  graphDb: {
    enabled: process.env.GRAPH_DB_ENABLED !== 'false',
    entityExtractionEnabled: process.env.ENTITY_EXTRACTION_ENABLED !== 'false',
    relationshipExtractionEnabled: process.env.RELATIONSHIP_EXTRACTION_ENABLED !== 'false',
    maxEntityLength: 100,
    maxRelationshipLength: 200,
    confidenceThreshold: 0.7,
    maxEntitiesPerDocument: 50,
    maxRelationshipsPerDocument: 100
  },

  // Performance monitoring
  performance: {
    enabled: process.env.PERFORMANCE_MONITORING !== 'false',
    metricsCollection: process.env.METRICS_COLLECTION !== 'false',
    slowQueryThreshold: 1000, // ms
    memoryWarningThreshold: 80, // percentage
    cpuWarningThreshold: 80 // percentage
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.NODE_ENV === 'production' ? 'json' : 'simple',
    maxFiles: 5,
    maxSize: '10m',
    enableConsole: process.env.NODE_ENV !== 'production'
  },

  // Security configuration
  security: {
    corsOrigin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : true),
    rateLimiting: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
      skipSuccessfulRequests: false,
      skipFailedRequests: false
    },
    helmet: {
      enabled: process.env.ENABLE_HELMET !== 'false',
      contentSecurityPolicy: process.env.NODE_ENV === 'production',
      crossOriginEmbedderPolicy: false
    }
  },

  // Memory management configuration
  memory: {
    cleanupInterval: parseInt(process.env.MEMORY_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000, // 1 hour
    maxAge: parseInt(process.env.MEMORY_MAX_AGE_MS) || 30 * 24 * 60 * 60 * 1000, // 30 days
    compressionEnabled: process.env.MEMORY_COMPRESSION_ENABLED !== 'false',
    archiveOldMemories: true,
    maxMemoriesPerPersona: 10000
  },

  // Human-in-the-loop configuration
  humanInTheLoop: {
    // ApprovalService configuration
    defaultTimeout: parseInt(process.env.APPROVAL_TIMEOUT_MS) || 5 * 60 * 1000, // 5 minutes
    escalationTimeout: parseInt(process.env.ESCALATION_TIMEOUT_MS) || 10 * 60 * 1000, // 10 minutes
    maxPendingRequests: 1000,
    notificationEnabled: true,
    emailNotifications: false,
    slackNotifications: false,
    autoEscalationEnabled: true,
    escalationThresholds: {
      highRiskTimeout: parseInt(process.env.HIGH_RISK_TIMEOUT_MS) || 3 * 60 * 1000, // 3 minutes
      criticalRiskTimeout: parseInt(process.env.CRITICAL_RISK_TIMEOUT_MS) || 1 * 60 * 1000, // 1 minute
      pendingCountThreshold: parseInt(process.env.PENDING_COUNT_THRESHOLD) || 50
    },
    
    // HumanApprovalAgent configuration
    enabled: process.env.RISK_ASSESSMENT_ENABLED !== 'false',
    approvalRequiredForSensitive: process.env.APPROVAL_REQUIRED_FOR_SENSITIVE !== 'false',
    approvalTimeout: parseInt(process.env.APPROVAL_TIMEOUT_MS) || 5 * 60 * 1000, // 5 minutes
    riskAssessmentEnabled: process.env.RISK_ASSESSMENT_ENABLED !== 'false',
    sensitive_topics: [
      'personal information',
      'financial data',
      'health records',
      'legal advice',
      'security credentials',
      'medical information',
      'political content',
      'controversial topics'
    ],
    risk_thresholds: {
      low: 0.3,
      medium: 0.6,
      high: 0.8,
      critical: 0.9
    },
    auto_approval_threshold: 0.2,
    escalation_threshold: 0.9,
    default_timeout_ms: parseInt(process.env.APPROVAL_TIMEOUT_MS) || 5 * 60 * 1000 // 5 minutes
  },

  // Agent configuration
  agents: {
    maxConcurrentExecutions: 10,
    defaultTimeout: 60000, // 1 minute
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
    enableParallelExecution: true,
    trackExecutionMetrics: true
  },

  // Workflow configuration
  workflows: {
    maxStepsPerWorkflow: 50,
    maxWorkflowDepth: 10,
    enableWorkflowCaching: true,
    workflowCacheTtl: 3600, // 1 hour
    enableWorkflowMetrics: true,
    maxConcurrentWorkflows: 100
  },

  // Performance cache configuration
  cache: {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      db: parseInt(process.env.REDIS_CACHE_DB) || 1,
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'zv3:',
      connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 10000,
      commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT) || 5000
    },
    ttl: {
      embeddings: parseInt(process.env.CACHE_TTL_EMBEDDINGS) || 86400, // 24 hours
      search_results: parseInt(process.env.CACHE_TTL_SEARCH_RESULTS) || 3600, // 1 hour
      persona_context: parseInt(process.env.CACHE_TTL_PERSONA_CONTEXT) || 1800, // 30 minutes
      user_profile: parseInt(process.env.CACHE_TTL_USER_PROFILE) || 3600, // 1 hour
      graph_relationships: parseInt(process.env.CACHE_TTL_GRAPH_RELATIONSHIPS) || 7200, // 2 hours
      memory_queries: parseInt(process.env.CACHE_TTL_MEMORY_QUERIES) || 900 // 15 minutes
    },
    limits: {
      max_embedding_cache_size: parseInt(process.env.CACHE_MAX_EMBEDDING_SIZE) || 10000,
      max_search_cache_size: parseInt(process.env.CACHE_MAX_SEARCH_SIZE) || 5000,
      max_key_length: parseInt(process.env.CACHE_MAX_KEY_LENGTH) || 250,
      max_value_size: parseInt(process.env.CACHE_MAX_VALUE_SIZE) || 1048576 // 1MB
    },
    strategies: {
      lru_enabled: process.env.CACHE_LRU_ENABLED !== 'false',
      compression_enabled: process.env.CACHE_COMPRESSION_ENABLED !== 'false',
      batch_operations: process.env.CACHE_BATCH_OPERATIONS !== 'false',
      background_refresh: process.env.CACHE_BACKGROUND_REFRESH !== 'false'
    }
  }
};

/**
 * Validate configuration
 */
function validateConfig() {
  const errors = [];

  // Check required environment variables
  if (!config.embeddings.openaiApiKey && config.embeddings.provider === 'openai') {
    errors.push('OPENAI_API_KEY is required when using OpenAI embedding provider');
  }

  if (config.langGraph.tracingEnabled && !config.langGraph.langsmithApiKey) {
    console.warn('LangGraph tracing enabled but LANGSMITH_API_KEY not provided');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Validate configuration on load
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

module.exports = config;
