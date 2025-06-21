const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const config = {
  // Server Configuration
  server: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || 'localhost'
  },

  // Database Configuration
  database: {
    path: process.env.DB_PATH || './data/vectordb.sqlite'
  },

  // Vector Database Settings
  vectorDb: {
    maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB, 10) || 2048,
    defaultDimensions: parseInt(process.env.DEFAULT_DIMENSIONS, 10) || 1536,
    indexType: process.env.INDEX_TYPE || 'hnsw',
    distanceMetric: process.env.DISTANCE_METRIC || 'cosine',
    maxVectors: parseInt(process.env.MAX_VECTORS, 10) || 1000000
  },

  // Security Configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    apiKeySaltRounds: parseInt(process.env.API_KEY_SALT_ROUNDS, 10) || 12,
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 1000
  },

  // Embedding Services
  embeddings: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    provider: process.env.EMBEDDING_PROVIDER || 'openai',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
  },

  // Monitoring
  monitoring: {
    logLevel: process.env.LOG_LEVEL || 'info',
    metricsEnabled: process.env.METRICS_ENABLED === 'true'
  },

  // WebSocket Configuration
  websocket: {
    enabled: process.env.WEBSOCKET_ENABLED === 'true',
    port: parseInt(process.env.WEBSOCKET_PORT, 10) || 4000
  },

  // Redis Configuration (for rate limiting and sessions)
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    enabled: process.env.REDIS_ENABLED === 'true'
  },

  // Authentication Configuration
  auth: {
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || '15m',
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5,
    lockoutTimeMinutes: parseInt(process.env.LOCKOUT_TIME_MINUTES, 10) || 15,
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12
  },

  // Hybrid Vector-Graph Configuration (Zero Vector 2.0)
  hybrid: {
    // Main feature toggle
    graphEnabled: process.env.GRAPH_ENABLED !== 'false',
    
    // Entity extraction settings
    entityExtraction: {
      enabled: process.env.ENTITY_EXTRACTION_ENABLED !== 'false',
      provider: process.env.ENTITY_PROVIDER || 'pattern', // 'pattern' or 'nlp' (future)
      confidenceThreshold: parseFloat(process.env.ENTITY_CONFIDENCE_THRESHOLD) || 0.7,
      maxEntitiesPerMemory: parseInt(process.env.MAX_ENTITIES_PER_MEMORY, 10) || 10,
      batchSize: parseInt(process.env.ENTITY_BATCH_SIZE, 10) || 100
    },

    // Graph traversal settings
    graphTraversal: {
      defaultDepth: parseInt(process.env.GRAPH_DEFAULT_DEPTH, 10) || 2,
      maxDepth: parseInt(process.env.GRAPH_MAX_DEPTH, 10) || 5,
      maxRelationshipsPerQuery: parseInt(process.env.MAX_RELATIONSHIPS_PER_QUERY, 10) || 1000,
      relationshipStrengthThreshold: parseFloat(process.env.RELATIONSHIP_STRENGTH_THRESHOLD) || 0.1
    },

    // Hybrid search settings
    hybridSearch: {
      defaultGraphWeight: parseFloat(process.env.DEFAULT_GRAPH_WEIGHT) || 0.3,
      maxGraphWeight: parseFloat(process.env.MAX_GRAPH_WEIGHT) || 0.8,
      graphExpansionEnabled: process.env.GRAPH_EXPANSION_ENABLED !== 'false',
      vectorThreshold: parseFloat(process.env.VECTOR_THRESHOLD) || 0.7,
      graphBoostFactor: parseFloat(process.env.GRAPH_BOOST_FACTOR) || 1.2
    },

    // Performance and limits
    performance: {
      maxGraphProcessingTimeMs: parseInt(process.env.MAX_GRAPH_PROCESSING_TIME_MS, 10) || 5000,
      graphCacheEnabled: process.env.GRAPH_CACHE_ENABLED !== 'false',
      graphCacheTtlMs: parseInt(process.env.GRAPH_CACHE_TTL_MS, 10) || 300000, // 5 minutes
      enableGraphMetrics: process.env.ENABLE_GRAPH_METRICS !== 'false'
    }
  },

  // Feature Flags (Zero Vector 2.0)
  features: {
    // Hybrid search features
    hybridSearch: process.env.FEATURE_HYBRID_SEARCH !== 'false',
    entityExtraction: process.env.FEATURE_ENTITY_EXTRACTION !== 'false',
    graphExpansion: process.env.FEATURE_GRAPH_EXPANSION !== 'false',
    
    // Advanced graph features
    relationshipInference: process.env.FEATURE_RELATIONSHIP_INFERENCE === 'true',
    crossPersonaSharing: process.env.FEATURE_CROSS_PERSONA_SHARING === 'true',
    temporalRelationships: process.env.FEATURE_TEMPORAL_RELATIONSHIPS === 'true',
    
    // Performance features
    adaptiveIndexing: process.env.FEATURE_ADAPTIVE_INDEXING === 'true',
    vectorCompression: process.env.FEATURE_VECTOR_COMPRESSION === 'true',
    intelligentCaching: process.env.FEATURE_INTELLIGENT_CACHING === 'true'
  }
};

// Validation
const validateConfig = () => {
  const errors = [];

  // Check required values
  if (config.vectorDb.maxMemoryMB < 64) {
    errors.push('MAX_MEMORY_MB must be at least 64MB');
  }

  if (config.vectorDb.defaultDimensions < 1 || config.vectorDb.defaultDimensions > 20000) {
    errors.push('DEFAULT_DIMENSIONS must be between 1 and 20000');
  }

  if (!['hnsw', 'lsh', 'flat'].includes(config.vectorDb.indexType)) {
    errors.push('INDEX_TYPE must be one of: hnsw, lsh, flat');
  }

  if (!['cosine', 'euclidean', 'dot'].includes(config.vectorDb.distanceMetric)) {
    errors.push('DISTANCE_METRIC must be one of: cosine, euclidean, dot');
  }

  if (config.server.nodeEnv === 'production' && config.security.jwtSecret === 'fallback-secret-change-in-production') {
    errors.push('JWT_SECRET must be set in production environment');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
};

// Validate configuration on load
validateConfig();

module.exports = config;
