import config from '../config.js';
import { makeRequest } from '../apiClient.js';
import { validateRequired, sanitizeInput, validateInput } from '../utils/validation.js';

/**
 * LangGraph Workflow Tools for Zero-Vector-3
 * Enables external systems to trigger and monitor LangGraph workflows
 * Based on the LangGraph-DEV-HANDOFF.md implementation
 */

/**
 * Execute a zero-vector-3 LangGraph workflow
 */
const executeWorkflow = {
  name: 'execute_workflow',
  description: 'Execute a LangGraph workflow in zero-vector-3 with specified configuration',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The user query to process through the workflow'
      },
      persona: {
        type: 'string',
        description: 'Active persona for the workflow (e.g., helpful_assistant, technical_expert)',
        default: 'helpful_assistant'
      },
      user_id: {
        type: 'string',
        description: 'User ID for personalized processing'
      },
      workflow_type: {
        type: 'string',
        description: 'Type of workflow to execute',
        enum: ['zero_vector_conversation', 'multi_step_reasoning', 'human_approval', 'memory_maintenance'],
        default: 'zero_vector_conversation'
      },
      config: {
        type: 'object',
        description: 'Workflow configuration options',
        properties: {
          enable_approval: {
            type: 'boolean',
            description: 'Enable human-in-the-loop approval',
            default: false
          },
          max_reasoning_steps: {
            type: 'number',
            description: 'Maximum reasoning steps for complex queries',
            default: 5
          },
          enable_memory_maintenance: {
            type: 'boolean',
            description: 'Enable automatic memory maintenance',
            default: true
          },
          cache_enabled: {
            type: 'boolean',
            description: 'Enable performance caching',
            default: true
          },
          confidence_threshold: {
            type: 'number',
            description: 'Minimum confidence threshold for responses',
            default: 0.7
          }
        }
      },
      thread_id: {
        type: 'string',
        description: 'Optional thread ID for conversation continuity'
      }
    },
    required: ['query', 'user_id']
  }
};

/**
 * Get workflow execution status
 */
const getWorkflowStatus = {
  name: 'get_workflow_status',
  description: 'Get the status of a running or completed LangGraph workflow',
  inputSchema: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The workflow ID to check status for'
      },
      thread_id: {
        type: 'string',
        description: 'The thread ID for conversation workflows'
      },
      include_metadata: {
        type: 'boolean',
        description: 'Include detailed execution metadata',
        default: true
      }
    },
    required: ['workflow_id']
  }
};

/**
 * Resume an interrupted workflow
 */
const resumeWorkflow = {
  name: 'resume_workflow',
  description: 'Resume a workflow that was interrupted for human approval or error handling',
  inputSchema: {
    type: 'object',
    properties: {
      thread_id: {
        type: 'string',
        description: 'Thread ID of the interrupted workflow'
      },
      workflow_id: {
        type: 'string',
        description: 'Workflow ID to resume'
      },
      approval_result: {
        type: 'object',
        description: 'Approval result for human-in-the-loop workflows',
        properties: {
          approved: {
            type: 'boolean',
            description: 'Whether the request was approved'
          },
          feedback: {
            type: 'string',
            description: 'Optional feedback from the approver'
          },
          modifications: {
            type: 'object',
            description: 'Any modifications to apply before resuming'
          }
        }
      },
      input_data: {
        type: 'object',
        description: 'Additional input data for resuming the workflow'
      }
    },
    required: ['thread_id']
  }
};

/**
 * Cancel a running workflow
 */
const cancelWorkflow = {
  name: 'cancel_workflow',
  description: 'Cancel a running LangGraph workflow',
  inputSchema: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The workflow ID to cancel'
      },
      thread_id: {
        type: 'string',
        description: 'The thread ID for conversation workflows'
      },
      reason: {
        type: 'string',
        description: 'Reason for cancellation'
      }
    },
    required: ['workflow_id']
  }
};

/**
 * List active workflows
 */
const listActiveWorkflows = {
  name: 'list_active_workflows',
  description: 'List all currently active LangGraph workflows',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: {
        type: 'string',
        description: 'Filter by user ID'
      },
      workflow_type: {
        type: 'string',
        description: 'Filter by workflow type'
      },
      status: {
        type: 'string',
        description: 'Filter by workflow status',
        enum: ['running', 'interrupted', 'completed', 'failed', 'cancelled']
      },
      limit: {
        type: 'number',
        description: 'Maximum number of workflows to return',
        default: 50
      }
    }
  }
};

/**
 * Get workflow performance metrics
 */
const getWorkflowMetrics = {
  name: 'get_workflow_metrics',
  description: 'Get performance metrics for LangGraph workflows',
  inputSchema: {
    type: 'object',
    properties: {
      time_range: {
        type: 'string',
        description: 'Time range for metrics',
        enum: ['1h', '24h', '7d', '30d'],
        default: '24h'
      },
      workflow_type: {
        type: 'string',
        description: 'Filter by workflow type'
      },
      user_id: {
        type: 'string',
        description: 'Filter by user ID'
      },
      include_detailed: {
        type: 'boolean',
        description: 'Include detailed performance breakdown',
        default: false
      }
    }
  }
};

/**
 * Tool implementations
 */
async function executeWorkflowTool(args) {
  try {
    // Validate required arguments
    const validation = validateRequired(args, ['query', 'user_id']);
    if (!validation.valid) {
      throw new Error(`Missing required fields: ${validation.missing.join(', ')}`);
    }

    // Sanitize inputs
    const sanitizedArgs = {
      query: sanitizeInput(args.query),
      persona: sanitizeInput(args.persona) || 'helpful_assistant',
      user_id: sanitizeInput(args.user_id),
      workflow_type: args.workflow_type || 'zero_vector_conversation',
      config: args.config || {},
      thread_id: args.thread_id ? sanitizeInput(args.thread_id) : undefined
    };

    // Build request payload
    const requestPayload = {
      messages: [
        {
          type: 'human',
          content: sanitizedArgs.query
        }
      ],
      active_persona: sanitizedArgs.persona,
      user_profile: {
        id: sanitizedArgs.user_id,
        preferences: sanitizedArgs.config
      },
      workflow_context: {
        workflow_type: sanitizedArgs.workflow_type,
        workflow_id: `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        started_via: 'mcp_server',
        config: sanitizedArgs.config
      },
      features: {
        enable_approval: sanitizedArgs.config.enable_approval || false,
        enable_memory_maintenance: sanitizedArgs.config.enable_memory_maintenance !== false,
        cache_enabled: sanitizedArgs.config.cache_enabled !== false
      }
    };

    // Add thread ID if provided for conversation continuity
    if (sanitizedArgs.thread_id) {
      requestPayload.thread_id = sanitizedArgs.thread_id;
    }

    // Execute workflow via API (use V3 endpoint)
    const response = await makeRequest('/api/v3/langgraph/execute', {
      method: 'POST',
      body: JSON.stringify(requestPayload),
      headers: {
        'Content-Type': 'application/json'
      }
    }, 'zeroVectorV3');

    if (!response.success) {
      throw new Error(`Workflow execution failed: ${response.error}`);
    }

    return {
      success: true,
      workflow_id: response.data.workflow_context?.workflow_id,
      thread_id: response.data.thread_id || sanitizedArgs.thread_id,
      status: response.data.workflow_context?.current_step || 'completed',
      result: {
        messages: response.data.messages,
        execution_metadata: response.data.execution_metadata,
        workflow_context: response.data.workflow_context,
        persona_context: response.data.persona_context
      },
      performance: {
        execution_time_ms: response.data.execution_metadata?.execution_time_ms,
        step_count: response.data.execution_metadata?.step_count,
        cache_hits: response.data.execution_metadata?.cache_hits || 0
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.stack
    };
  }
}

async function getWorkflowStatusTool(args) {
  try {
    const validation = validateRequired(args, ['workflow_id']);
    if (!validation.valid) {
      throw new Error(`Missing required fields: ${validation.missing.join(', ')}`);
    }

    const workflowId = sanitizeInput(args.workflow_id);
    const threadId = args.thread_id ? sanitizeInput(args.thread_id) : undefined;
    const includeMetadata = args.include_metadata !== false;

    const queryParams = new URLSearchParams({
      workflow_id: workflowId,
      include_metadata: includeMetadata.toString()
    });

    if (threadId) {
      queryParams.append('thread_id', threadId);
    }

    const response = await makeRequest(`/api/v3/langgraph/status?${queryParams}`);

    if (!response.success) {
      throw new Error(`Failed to get workflow status: ${response.error}`);
    }

    return {
      success: true,
      workflow_id: workflowId,
      status: response.data.status,
      current_step: response.data.current_step,
      completed_steps: response.data.completed_steps,
      metadata: includeMetadata ? response.data.metadata : undefined,
      performance: response.data.performance,
      errors: response.data.errors || [],
      last_updated: response.data.last_updated
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function resumeWorkflowTool(args) {
  try {
    const validation = validateRequired(args, ['thread_id']);
    if (!validation.valid) {
      throw new Error(`Missing required fields: ${validation.missing.join(', ')}`);
    }

    const requestPayload = {
      thread_id: sanitizeInput(args.thread_id),
      workflow_id: args.workflow_id ? sanitizeInput(args.workflow_id) : undefined,
      approval_result: args.approval_result || {},
      input_data: args.input_data || {}
    };

    const response = await makeRequest('/api/v3/langgraph/resume', {
      method: 'POST',
      body: JSON.stringify(requestPayload),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.success) {
      throw new Error(`Failed to resume workflow: ${response.error}`);
    }

    return {
      success: true,
      workflow_id: response.data.workflow_context?.workflow_id,
      thread_id: args.thread_id,
      status: response.data.workflow_context?.current_step || 'completed',
      result: response.data,
      resumed_at: new Date().toISOString()
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function cancelWorkflowTool(args) {
  try {
    const validation = validateRequired(args, ['workflow_id']);
    if (!validation.valid) {
      throw new Error(`Missing required fields: ${validation.missing.join(', ')}`);
    }

    const requestPayload = {
      workflow_id: sanitizeInput(args.workflow_id),
      thread_id: args.thread_id ? sanitizeInput(args.thread_id) : undefined,
      reason: args.reason || 'Cancelled via MCP server'
    };

    const response = await makeRequest('/api/v3/langgraph/cancel', {
      method: 'POST',
      body: JSON.stringify(requestPayload),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.success) {
      throw new Error(`Failed to cancel workflow: ${response.error}`);
    }

    return {
      success: true,
      workflow_id: args.workflow_id,
      cancelled: true,
      reason: args.reason,
      cancelled_at: new Date().toISOString()
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function listActiveWorkflowsTool(args) {
  try {
    const queryParams = new URLSearchParams();
    
    if (args.user_id) queryParams.append('user_id', sanitizeInput(args.user_id));
    if (args.workflow_type) queryParams.append('workflow_type', args.workflow_type);
    if (args.status) queryParams.append('status', args.status);
    queryParams.append('limit', (args.limit || 50).toString());

    const response = await makeRequest(`/api/v3/langgraph/workflows?${queryParams}`);

    if (!response.success) {
      throw new Error(`Failed to list workflows: ${response.error}`);
    }

    return {
      success: true,
      workflows: response.data.workflows,
      total_count: response.data.total_count,
      active_count: response.data.active_count,
      filters: {
        user_id: args.user_id,
        workflow_type: args.workflow_type,
        status: args.status,
        limit: args.limit || 50
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function getWorkflowMetricsTool(args) {
  try {
    const queryParams = new URLSearchParams({
      time_range: args.time_range || '24h',
      include_detailed: (args.include_detailed || false).toString()
    });

    if (args.workflow_type) queryParams.append('workflow_type', args.workflow_type);
    if (args.user_id) queryParams.append('user_id', sanitizeInput(args.user_id));

    const response = await makeRequest(`/api/v3/langgraph/metrics?${queryParams}`);

    if (!response.success) {
      throw new Error(`Failed to get workflow metrics: ${response.error}`);
    }

    return {
      success: true,
      time_range: args.time_range || '24h',
      metrics: response.data.metrics,
      summary: response.data.summary,
      performance_trends: response.data.performance_trends,
      generated_at: new Date().toISOString()
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Create tool objects with handlers
const workflowTools = [
  { ...executeWorkflow, handler: executeWorkflowTool },
  { ...getWorkflowStatus, handler: getWorkflowStatusTool },
  { ...resumeWorkflow, handler: resumeWorkflowTool },
  { ...cancelWorkflow, handler: cancelWorkflowTool },
  { ...listActiveWorkflows, handler: listActiveWorkflowsTool },
  { ...getWorkflowMetrics, handler: getWorkflowMetricsTool }
];

export { workflowTools };
