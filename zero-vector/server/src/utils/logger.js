const winston = require('winston');
const path = require('path');
const config = require('../config');

/**
 * Enhanced logging system for Zero-Vector-3
 * Supports structured logging with performance metrics and LangGraph integration
 */

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  trace: 'magenta'
};

winston.addColors(logColors);

// Create formatters
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create transports
const transports = [];

// Console transport (development)
if (config.logging.enableConsole) {
  transports.push(
    new winston.transports.Console({
      level: config.logging.level,
      format: consoleFormat,
      handleExceptions: true,
      handleRejections: true
    })
  );
}

// File transports (production and development)
const logDir = path.join(__dirname, '../../logs');

transports.push(
  // Combined log file
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    level: config.logging.level,
    format: fileFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }),
  
  // Error log file
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: fileFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }),
  
  // Performance log file
  new winston.transports.File({
    filename: path.join(logDir, 'performance.log'),
    level: 'info',
    format: fileFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 3,
    tailable: true
  })
);

// Create logger instance
const logger = winston.createLogger({
  levels: logLevels,
  level: config.logging.level,
  format: fileFormat,
  transports,
  exitOnError: false
});

/**
 * Enhanced error logging with context
 */
function logError(error, context = {}) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
    ...context,
    timestamp: new Date().toISOString(),
    severity: 'error'
  };

  logger.error('Application error occurred', errorInfo);
  
  // Log to performance file for error tracking
  logger.info('Performance metric', {
    type: 'error',
    operation: context.operation || 'unknown',
    duration: context.duration || 0,
    errorCode: error.code || 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString()
  });

  return errorInfo;
}

/**
 * Performance logging for operations
 */
function logPerformance(operation, duration, metadata = {}) {
  const perfInfo = {
    type: 'performance',
    operation,
    duration,
    ...metadata,
    timestamp: new Date().toISOString()
  };

  logger.info('Performance metric', perfInfo);
  return perfInfo;
}

/**
 * LangGraph workflow logging
 */
function logWorkflow(workflowId, step, data = {}) {
  const workflowInfo = {
    type: 'workflow',
    workflowId,
    step,
    ...data,
    timestamp: new Date().toISOString()
  };

  logger.info('Workflow step', workflowInfo);
  return workflowInfo;
}

/**
 * Agent execution logging
 */
function logAgent(agentName, operation, data = {}) {
  const agentInfo = {
    type: 'agent',
    agent: agentName,
    operation,
    ...data,
    timestamp: new Date().toISOString()
  };

  logger.debug('Agent execution', agentInfo);
  return agentInfo;
}

/**
 * Memory operation logging
 */
function logMemory(operation, personaId, data = {}) {
  const memoryInfo = {
    type: 'memory',
    operation,
    personaId,
    ...data,
    timestamp: new Date().toISOString()
  };

  logger.debug('Memory operation', memoryInfo);
  return memoryInfo;
}

/**
 * Vector operation logging
 */
function logVector(operation, data = {}) {
  const vectorInfo = {
    type: 'vector',
    operation,
    ...data,
    timestamp: new Date().toISOString()
  };

  logger.debug('Vector operation', vectorInfo);
  return vectorInfo;
}

/**
 * API request logging middleware
 */
function createRequestLogger() {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.info('API request', {
      type: 'request',
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      requestId: req.id || `req_${Date.now()}`,
      timestamp: new Date().toISOString()
    });

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const duration = Date.now() - startTime;
      
      logger.info('API response', {
        type: 'response',
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        requestId: req.id || `req_${Date.now()}`,
        timestamp: new Date().toISOString()
      });

      // Log performance metric
      logPerformance('api_request', duration, {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        requestId: req.id
      });

      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
}

/**
 * Performance timer utility
 */
class PerformanceTimer {
  constructor(operation, metadata = {}) {
    this.operation = operation;
    this.metadata = metadata;
    this.startTime = Date.now();
    this.startMemory = process.memoryUsage();
  }

  end(additionalMetadata = {}) {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - this.startTime;
    
    const perfData = {
      ...this.metadata,
      ...additionalMetadata,
      duration,
      memoryDelta: {
        rss: endMemory.rss - this.startMemory.rss,
        heapUsed: endMemory.heapUsed - this.startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - this.startMemory.heapTotal
      },
      finalMemory: endMemory
    };

    return logPerformance(this.operation, duration, perfData);
  }

  checkpoint(label) {
    const checkpointTime = Date.now();
    const duration = checkpointTime - this.startTime;
    
    logger.debug('Performance checkpoint', {
      type: 'checkpoint',
      operation: this.operation,
      label,
      duration,
      timestamp: new Date().toISOString()
    });

    return duration;
  }
}

/**
 * Create performance timer
 */
function createTimer(operation, metadata = {}) {
  return new PerformanceTimer(operation, metadata);
}

/**
 * Log system metrics
 */
function logSystemMetrics() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  
  logger.info('System metrics', {
    type: 'system',
    memory: {
      rss: Math.round(memory.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024), // MB
      external: Math.round(memory.external / 1024 / 1024) // MB
    },
    cpu: {
      user: cpu.user,
      system: cpu.system
    },
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle uncaught exceptions and rejections
 */
process.on('uncaughtException', (error) => {
  logError(error, {
    operation: 'uncaughtException',
    fatal: true
  });
  
  // Give time for logs to write before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(new Error(`Unhandled Rejection: ${reason}`), {
    operation: 'unhandledRejection',
    promise: promise.toString()
  });
});

// Log system metrics periodically in production
if (config.server.nodeEnv === 'production') {
  setInterval(logSystemMetrics, 60000); // Every minute
}

// Export logger and utilities
module.exports = {
  logger,
  logError,
  logPerformance,
  logWorkflow,
  logAgent,
  logMemory,
  logVector,
  createRequestLogger,
  createTimer,
  logSystemMetrics,
  PerformanceTimer,
  
  // Convenience methods
  error: (message, meta) => logger.error(message, meta),
  warn: (message, meta) => logger.warn(message, meta),
  info: (message, meta) => logger.info(message, meta),
  debug: (message, meta) => logger.debug(message, meta),
  trace: (message, meta) => logger.trace(message, meta)
};
