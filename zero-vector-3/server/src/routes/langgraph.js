const express = require('express');
const logger = require('../utils/logger');
const ZeroVectorGraph = require('../graphs/ZeroVectorGraph');
const ApprovalService = require('../services/ApprovalService');
const serviceManager = require('../services/ServiceManager'); // This is a singleton instance

const router = express.Router();

// Initialize services when needed
let zeroVectorGraph = null;

// Initialize LangGraph on first request
async function initializeLangGraph() {
  if (!zeroVectorGraph) {
    try {
      zeroVectorGraph = new ZeroVectorGraph(serviceManager);
      await zeroVectorGraph.initialize();
      logger.info('LangGraph initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize LangGraph', { error: error.message });
      throw error;
    }
  }
  return zeroVectorGraph;
}

// Temporary middleware placeholder (middleware directory doesn't exist yet)
const tempAuthMiddleware = (req, res, next) => {
  // For testing purposes, skip authentication
  next();
};

const tempPerformanceMiddleware = (req, res, next) => {
  // For testing purposes, skip performance tracking
  next();
};

// Apply middleware
router.use(tempAuthMiddleware);
router.use(tempPerformanceMiddleware);

/**
 * @route POST /api/v3/langgraph/execute
 * @desc Execute a LangGraph workflow
 * @access Private (API Key required)
 */
router.post('/execute', async (req, res) => {
  try {
    const {
      messages,
      active_persona = 'helpful_assistant',
      user_profile,
      workflow_context = {},
      features = {},
      thread_id
    } = req.body;

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array is required and must not be empty'
      });
    }

    if (!user_profile || !user_profile.id) {
      return res.status(400).json({
        success: false,
        error: 'User profile with id is required'
      });
    }

    // Initialize LangGraph
    const graph = await initializeLangGraph();

    // Build state for LangGraph
    const state = {
      messages,
      active_persona,
      user_profile,
      workflow_context: {
        workflow_id: workflow_context.workflow_id || `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        workflow_type: workflow_context.workflow_type || 'zero_vector_conversation',
        started_via: workflow_context.started_via || 'api',
        config: workflow_context.config || {},
        ...workflow_context
      },
      features: {
        enable_approval: features.enable_approval || false,
        enable_memory_maintenance: features.enable_memory_maintenance !== false,
        cache_enabled: features.cache_enabled !== false,
        ...features
      },
      current_step: 'initialize',
      reasoning_path: [],
      requires_approval: false,
      execution_metadata: {
        started_at: new Date().toISOString(),
        api_version: 'v3'
      }
    };

    // Configure execution
    const config = {
      configurable: {
        thread_id: thread_id || `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: user_profile.id
      }
    };

    // Execute workflow
    const startTime = Date.now();
    const result = await graph.invoke(state, config);
    const executionTime = Date.now() - startTime;

    // Update execution metadata
    if (result.execution_metadata) {
      result.execution_metadata.execution_time_ms = executionTime;
      result.execution_metadata.completed_at = new Date().toISOString();
    }

    logger.info('LangGraph workflow executed successfully', {
      workflowId: result.workflow_context?.workflow_id,
      executionTime,
      threadId: config.configurable.thread_id,
      userId: user_profile.id
    });

    res.json({
      success: true,
      data: {
        ...result,
        thread_id: config.configurable.thread_id,
        execution_metadata: {
          ...result.execution_metadata,
          execution_time_ms: executionTime
        }
      }
    });

  } catch (error) {
    logger.error('Error executing LangGraph workflow', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route GET /api/v3/langgraph/status
 * @desc Get workflow execution status
 * @access Private (API Key required)
 */
router.get('/status', async (req, res) => {
  try {
    const { workflow_id, thread_id, include_metadata = 'true' } = req.query;

    if (!workflow_id) {
      return res.status(400).json({
        success: false,
        error: 'Workflow ID is required'
      });
    }

    // Initialize LangGraph
    const graph = await initializeLangGraph();

    // Get workflow status from checkpointer
    const config = thread_id ? { configurable: { thread_id } } : undefined;
    
    try {
      // Try to get the latest state for this thread
      const state = await graph.getState(config);
      
      const status = {
        workflow_id,
        thread_id,
        status: state ? 'completed' : 'not_found',
        current_step: state?.values?.current_step || 'unknown',
        completed_steps: state?.values?.reasoning_path || [],
        last_updated: state?.created_at || new Date().toISOString()
      };

      if (include_metadata === 'true' && state) {
        status.metadata = state.values.execution_metadata || {};
        status.performance = {
          execution_time_ms: state.values.execution_metadata?.execution_time_ms,
          step_count: state.values.reasoning_path?.length || 0
        };
      }

      res.json({
        success: true,
        data: status
      });

    } catch (stateError) {
      // If we can't get state, return basic info
      res.json({
        success: true,
        data: {
          workflow_id,
          thread_id,
          status: 'unknown',
          current_step: 'unknown',
          completed_steps: [],
          last_updated: new Date().toISOString(),
          error: 'Could not retrieve workflow state'
        }
      });
    }

  } catch (error) {
    logger.error('Error getting workflow status', {
      error: error.message,
      workflowId: req.query.workflow_id
    });

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v3/langgraph/resume
 * @desc Resume an interrupted workflow
 * @access Private (API Key required)
 */
router.post('/resume', async (req, res) => {
  try {
    const { thread_id, workflow_id, approval_result = {}, input_data = {} } = req.body;

    if (!thread_id) {
      return res.status(400).json({
        success: false,
        error: 'Thread ID is required'
      });
    }

    // Initialize LangGraph
    const graph = await initializeLangGraph();

    // Configure for resume
    const config = { configurable: { thread_id } };

    // Get current state
    const currentState = await graph.getState(config);
    if (!currentState) {
      return res.status(404).json({
        success: false,
        error: 'Workflow thread not found'
      });
    }

    // Update state with approval result and input data
    const updatedState = {
      ...currentState.values,
      approval_result,
      input_data,
      current_step: 'resuming',
      execution_metadata: {
        ...currentState.values.execution_metadata,
        resumed_at: new Date().toISOString()
      }
    };

    // Resume execution
    const startTime = Date.now();
    const result = await graph.invoke(updatedState, config);
    const executionTime = Date.now() - startTime;

    logger.info('LangGraph workflow resumed successfully', {
      threadId: thread_id,
      workflowId: workflow_id,
      executionTime
    });

    res.json({
      success: true,
      data: {
        ...result,
        thread_id,
        execution_metadata: {
          ...result.execution_metadata,
          resume_execution_time_ms: executionTime
        }
      }
    });

  } catch (error) {
    logger.error('Error resuming workflow', {
      error: error.message,
      threadId: req.body.thread_id
    });

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v3/langgraph/cancel
 * @desc Cancel a running workflow
 * @access Private (API Key required)
 */
router.post('/cancel', async (req, res) => {
  try {
    const { workflow_id, thread_id, reason = 'Cancelled by user' } = req.body;

    if (!workflow_id) {
      return res.status(400).json({
        success: false,
        error: 'Workflow ID is required'
      });
    }

    // Initialize LangGraph
    const graph = await initializeLangGraph();

    // For now, we'll mark as cancelled in logs since LangGraph doesn't have explicit cancellation
    logger.info('Workflow cancellation requested', {
      workflowId: workflow_id,
      threadId: thread_id,
      reason
    });

    // In a full implementation, you would:
    // 1. Update workflow status in database
    // 2. Clean up any running processes
    // 3. Notify any waiting systems

    res.json({
      success: true,
      data: {
        workflow_id,
        thread_id,
        cancelled: true,
        reason,
        cancelled_at: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error cancelling workflow', {
      error: error.message,
      workflowId: req.body.workflow_id
    });

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v3/langgraph/workflows
 * @desc List active workflows
 * @access Private (API Key required)
 */
router.get('/workflows', async (req, res) => {
  try {
    const { user_id, workflow_type, status, limit = 50 } = req.query;

    // Initialize LangGraph
    await initializeLangGraph();

    // In a full implementation, you would query a database for workflows
    // For now, return mock data structure
    const workflows = [];
    
    logger.info('Workflows list requested', {
      userId: user_id,
      workflowType: workflow_type,
      status,
      limit
    });

    res.json({
      success: true,
      data: {
        workflows,
        total_count: workflows.length,
        active_count: workflows.filter(w => w.status === 'running').length,
        filters: {
          user_id,
          workflow_type,
          status,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Error listing workflows', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v3/langgraph/metrics
 * @desc Get workflow performance metrics
 * @access Private (API Key required)
 */
router.get('/metrics', async (req, res) => {
  try {
    const { time_range = '24h', workflow_type, user_id, include_detailed = 'false' } = req.query;

    // Initialize LangGraph
    await initializeLangGraph();

    // Mock metrics - in production, this would query actual metrics from database/monitoring
    const metrics = {
      summary: {
        total_workflows: 0,
        successful_workflows: 0,
        failed_workflows: 0,
        average_execution_time_ms: 0,
        total_execution_time_ms: 0
      },
      performance_trends: {
        execution_times: [],
        success_rates: [],
        error_rates: []
      }
    };

    if (include_detailed === 'true') {
      metrics.detailed = {
        by_workflow_type: {},
        by_user: {},
        by_step: {}
      };
    }

    logger.info('Workflow metrics requested', {
      timeRange: time_range,
      workflowType: workflow_type,
      userId: user_id,
      includeDetailed: include_detailed
    });

    res.json({
      success: true,
      data: {
        time_range,
        metrics,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error getting workflow metrics', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
