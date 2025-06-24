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
        enum: ['zero_vector_conversation', 'multi_step_reasoning', 'human_approval', 'memory_maintenance', 'cross_persona_coordination'],
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
      return {
        content: [{
          type: 'text',
          text: `❌ Missing required fields: ${validation.missing.join(', ')}`
        }],
        isError: true
      };
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
      workflow_type: sanitizedArgs.workflow_type, // Add at top level for route handler
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
    console.log('=== MCP TOOL: Making API request ===');
    const response = await makeRequest('/api/v3/langgraph/execute', {
      method: 'POST',
      body: JSON.stringify(requestPayload),
      headers: {
        'Content-Type': 'application/json'
      }
    }, 'zeroVectorV3');

    console.log('=== MCP TOOL: Got response ===', {
      success: response.success,
      hasData: !!response.data,
      responseType: typeof response
    });

    if (!response.success) {
      console.log('=== MCP TOOL: Response failed ===', response);
      return {
        content: [{
          type: 'text',
          text: `❌ Workflow execution failed: ${response.error}`
        }],
        isError: true
      };
    }

    // CRITICAL FIX: Extract workflow data from the correct path
    // API client wraps the response, so actual data is at response.data.data
    const workflowData = response.data?.data || response.data || {};
    
    console.log('=== MCP TOOL: Data extraction ===', {
      hasResponseData: !!response.data,
      hasNestedData: !!response.data?.data,
      hasMessages: !!workflowData.messages,
      messageCount: workflowData.messages?.length || 0,
      messageTypes: workflowData.messages?.map(m => m.type) || []
    });

    // Extract workflow metadata
    const workflowId = workflowData.workflow_context?.workflow_id || 
                      requestPayload.workflow_context?.workflow_id ||
                      'N/A';
    
    const threadId = workflowData.thread_id || 
                    sanitizedArgs.thread_id ||
                    'N/A';

    // Format successful response header
    let resultText = `✅ **LangGraph Workflow Executed Successfully**\n\n`;
    resultText += `🆔 **Workflow ID:** ${workflowId}\n`;
    resultText += `🧵 **Thread ID:** ${threadId}\n`;
    resultText += `📊 **Status:** ${workflowData.workflow_context?.current_step || workflowData.current_step || 'completed'}\n`;
    resultText += `🤖 **Active Persona:** ${workflowData.active_persona || sanitizedArgs.persona}\n`;
    resultText += `🔧 **Workflow Type:** ${workflowData.workflow_context?.workflow_type || sanitizedArgs.workflow_type}\n\n`;

    // Process and display messages
    if (workflowData.messages && workflowData.messages.length > 0) {
      const messages = workflowData.messages;
      const humanMessages = messages.filter(msg => msg.type === 'human');
      const aiMessages = messages.filter(msg => msg.type === 'ai');

      console.log('=== MCP TOOL: Message analysis ===', {
        totalMessages: messages.length,
        humanCount: humanMessages.length,
        aiCount: aiMessages.length,
        workflowType: sanitizedArgs.workflow_type
      });

      // Check if this is cross-persona coordination based on multiple AI messages
      const isCrossPersonaCoordination = aiMessages.length > 1 && 
                                        sanitizedArgs.workflow_type === 'cross_persona_coordination';

      if (isCrossPersonaCoordination) {
        resultText += `🎯 **Cross-Persona Expert Collaboration Result:**\n\n`;
        resultText += `Multiple experts have collaborated to provide comprehensive guidance:\n\n`;
        
        aiMessages.forEach((msg, index) => {
          if (msg && msg.content) {
            // Extract persona from message metadata if available
            const persona = msg.additional_kwargs?.active_persona || 
                           msg.additional_kwargs?.from_persona ||
                           `Expert ${index + 1}`;
            
            resultText += `## ${persona.toUpperCase().replace('_', ' ')} CONTRIBUTION:\n`;
            resultText += `${msg.content}\n\n`;
            resultText += `---\n\n`;
          }
        });
        
        resultText += `**Collaboration Summary:**\n`;
        resultText += `${aiMessages.length} experts provided specialized insights to address your query comprehensively.\n`;
      } else {
        // Single persona or other workflow types
        resultText += `🎯 **Workflow Response:**\n\n`;
        
        aiMessages.forEach((msg, index) => {
          if (msg && msg.content) {
            resultText += `${msg.content}\n\n`;
          }
        });
      }
    } else {
      resultText += `⚠️ **No response messages found in workflow result.**\n`;
      resultText += `🔍 **Available Data:** ${Object.keys(workflowData).join(', ')}\n`;
      
      // Provide debug information only when no messages are found
      console.log('=== MCP TOOL: No messages found - Debug info ===', {
        responseStructure: Object.keys(response),
        dataStructure: Object.keys(workflowData),
        fullResponse: JSON.stringify(workflowData, null, 2).substring(0, 500)
      });
    }

    // Add performance info if available
    if (workflowData.execution_metadata) {
      const meta = workflowData.execution_metadata;
      resultText += `\n⚡ **Performance:**\n`;
      resultText += `• Execution Time: ${meta.execution_time_ms || 'N/A'}ms\n`;
      resultText += `• Step Count: ${meta.step_count || 'N/A'}\n`;
      if (meta.cache_hits) {
        resultText += `• Cache Hits: ${meta.cache_hits}\n`;
      }
      if (meta.persona_coordination) {
        resultText += `• Persona Switches: ${meta.persona_coordination.switches_performed || 0}\n`;
        resultText += `• Coordination Type: ${meta.persona_coordination.analysis?.type || 'N/A'}\n`;
      }
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Unexpected error: ${error.message}\n\n💡 Check the Zero-Vector v3 server connection and configuration.`
      }],
      isError: true
    };
  }
}

async function getWorkflowStatusTool(args) {
  try {
    const validation = validateRequired(args, ['workflow_id']);
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: `❌ Missing required fields: ${validation.missing.join(', ')}`
        }],
        isError: true
      };
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
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to get workflow status: ${response.error}`
        }],
        isError: true
      };
    }

    // Format successful response
    let resultText = `📊 **Workflow Status Report**\n\n`;
    resultText += `🆔 **Workflow ID:** ${workflowId}\n`;
    resultText += `📈 **Status:** ${response.data.status}\n`;
    resultText += `🔄 **Current Step:** ${response.data.current_step || 'N/A'}\n`;
    
    if (threadId) {
      resultText += `🧵 **Thread ID:** ${threadId}\n`;
    }
    
    if (response.data.completed_steps) {
      resultText += `✅ **Completed Steps:** ${response.data.completed_steps}\n`;
    }
    
    if (response.data.last_updated) {
      resultText += `⏰ **Last Updated:** ${response.data.last_updated}\n`;
    }

    if (response.data.errors && response.data.errors.length > 0) {
      resultText += `\n❌ **Errors:**\n`;
      response.data.errors.forEach((error, index) => {
        resultText += `${index + 1}. ${error}\n`;
      });
    }

    if (includeMetadata && response.data.metadata) {
      resultText += `\n📋 **Metadata:**\n`;
      Object.entries(response.data.metadata).forEach(([key, value]) => {
        resultText += `• ${key}: ${JSON.stringify(value)}\n`;
      });
    }

    if (response.data.performance) {
      const perf = response.data.performance;
      resultText += `\n⚡ **Performance:**\n`;
      Object.entries(perf).forEach(([key, value]) => {
        resultText += `• ${key}: ${value}\n`;
      });
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Unexpected error: ${error.message}`
      }],
      isError: true
    };
  }
}

async function resumeWorkflowTool(args) {
  try {
    const validation = validateRequired(args, ['thread_id']);
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: `❌ Missing required fields: ${validation.missing.join(', ')}`
        }],
        isError: true
      };
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
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to resume workflow: ${response.error}`
        }],
        isError: true
      };
    }

    // Format successful response
    let resultText = `🔄 **Workflow Resumed Successfully**\n\n`;
    resultText += `🆔 **Workflow ID:** ${response.data.workflow_context?.workflow_id}\n`;
    resultText += `🧵 **Thread ID:** ${args.thread_id}\n`;
    resultText += `📊 **Status:** ${response.data.workflow_context?.current_step || 'completed'}\n`;
    resultText += `⏰ **Resumed At:** ${new Date().toISOString()}\n`;

    if (args.workflow_id) {
      resultText += `🔗 **Original Workflow ID:** ${args.workflow_id}\n`;
    }

    if (args.approval_result && Object.keys(args.approval_result).length > 0) {
      resultText += `\n✅ **Approval Result:**\n`;
      Object.entries(args.approval_result).forEach(([key, value]) => {
        resultText += `• ${key}: ${JSON.stringify(value)}\n`;
      });
    }

    if (args.input_data && Object.keys(args.input_data).length > 0) {
      resultText += `\n📝 **Input Data:**\n`;
      Object.entries(args.input_data).forEach(([key, value]) => {
        resultText += `• ${key}: ${JSON.stringify(value)}\n`;
      });
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Unexpected error: ${error.message}`
      }],
      isError: true
    };
  }
}

async function cancelWorkflowTool(args) {
  try {
    const validation = validateRequired(args, ['workflow_id']);
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: `❌ Missing required fields: ${validation.missing.join(', ')}`
        }],
        isError: true
      };
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
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to cancel workflow: ${response.error}`
        }],
        isError: true
      };
    }

    // Format successful response
    let resultText = `🛑 **Workflow Cancelled Successfully**\n\n`;
    resultText += `🆔 **Workflow ID:** ${args.workflow_id}\n`;
    resultText += `📝 **Reason:** ${args.reason || 'Cancelled via MCP server'}\n`;
    resultText += `⏰ **Cancelled At:** ${new Date().toISOString()}\n`;

    if (args.thread_id) {
      resultText += `🧵 **Thread ID:** ${args.thread_id}\n`;
    }

    resultText += `\n✅ **Status:** Cancellation successful`;

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Unexpected error: ${error.message}`
      }],
      isError: true
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
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to list workflows: ${response.error}`
        }],
        isError: true
      };
    }

    // Format successful response
    let resultText = `📋 **Active Workflows List**\n\n`;
    resultText += `📊 **Summary:**\n`;
    resultText += `• Total Count: ${response.data.total_count || 0}\n`;
    resultText += `• Active Count: ${response.data.active_count || 0}\n`;
    resultText += `• Limit: ${args.limit || 50}\n\n`;

    if (args.user_id || args.workflow_type || args.status) {
      resultText += `🔍 **Filters Applied:**\n`;
      if (args.user_id) resultText += `• User ID: ${args.user_id}\n`;
      if (args.workflow_type) resultText += `• Workflow Type: ${args.workflow_type}\n`;
      if (args.status) resultText += `• Status: ${args.status}\n`;
      resultText += `\n`;
    }

    if (response.data.workflows && response.data.workflows.length > 0) {
      resultText += `🔄 **Workflows:**\n`;
      response.data.workflows.forEach((workflow, index) => {
        resultText += `${index + 1}. **${workflow.workflow_id || workflow.id}**\n`;
        resultText += `   • Type: ${workflow.workflow_type || 'Unknown'}\n`;
        resultText += `   • Status: ${workflow.status || 'Unknown'}\n`;
        if (workflow.user_id) resultText += `   • User: ${workflow.user_id}\n`;
        if (workflow.created_at) resultText += `   • Created: ${workflow.created_at}\n`;
        if (workflow.last_updated) resultText += `   • Updated: ${workflow.last_updated}\n`;
        resultText += `\n`;
      });
    } else {
      resultText += `📭 **No workflows found** matching the specified criteria.\n`;
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Unexpected error: ${error.message}`
      }],
      isError: true
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
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to get workflow metrics: ${response.error}`
        }],
        isError: true
      };
    }

    // Format successful response
    let resultText = `📊 **Workflow Performance Metrics**\n\n`;
    resultText += `⏰ **Time Range:** ${args.time_range || '24h'}\n`;
    resultText += `📅 **Generated At:** ${new Date().toISOString()}\n\n`;

    if (args.workflow_type || args.user_id) {
      resultText += `🔍 **Filters Applied:**\n`;
      if (args.workflow_type) resultText += `• Workflow Type: ${args.workflow_type}\n`;
      if (args.user_id) resultText += `• User ID: ${args.user_id}\n`;
      resultText += `\n`;
    }

    if (response.data.summary) {
      const summary = response.data.summary;
      resultText += `📋 **Summary:**\n`;
      Object.entries(summary).forEach(([key, value]) => {
        resultText += `• ${key}: ${value}\n`;
      });
      resultText += `\n`;
    }

    if (response.data.metrics) {
      const metrics = response.data.metrics;
      resultText += `📈 **Metrics:**\n`;
      Object.entries(metrics).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          resultText += `• **${key}:**\n`;
          Object.entries(value).forEach(([subKey, subValue]) => {
            resultText += `  - ${subKey}: ${subValue}\n`;
          });
        } else {
          resultText += `• ${key}: ${value}\n`;
        }
      });
      resultText += `\n`;
    }

    if (args.include_detailed && response.data.performance_trends) {
      const trends = response.data.performance_trends;
      resultText += `📊 **Performance Trends:**\n`;
      Object.entries(trends).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          resultText += `• **${key}:** ${value.length} data points\n`;
        } else {
          resultText += `• ${key}: ${JSON.stringify(value)}\n`;
        }
      });
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Unexpected error: ${error.message}`
      }],
      isError: true
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
