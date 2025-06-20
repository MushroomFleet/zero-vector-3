const { StateGraph } = require('@langchain/langgraph');
const { END } = require('@langchain/langgraph');
const { ZeroVectorStateManager } = require('../state/ZeroVectorState');
const { logger, logError } = require('../utils/logger');

/**
 * Zero-Vector-3 LangGraph Workflow
 * Main orchestration graph implementing the patterns from LangGraph-DEV-HANDOFF.md
 */
class ZeroVectorGraph {
  constructor(components) {
    this.hybridRetrievalAgent = components.hybridRetrievalAgent;
    this.personaMemoryAgent = components.personaMemoryAgent;
    this.reasoningAgent = components.reasoningAgent;
    this.approvalAgent = components.approvalAgent;
    this.checkpointer = components.checkpointer;
    this.config = components.config || {};
    
    logger.info('ZeroVectorGraph initialized', {
      components: Object.keys(components),
      checkpointerEnabled: !!this.checkpointer
    });
  }

  /**
   * Create the main LangGraph workflow
   */
  createGraph() {
    try {
      // Create state graph
      const graph = new StateGraph({
        stateSchema: this.getStateSchema()
      });

      // Add agent nodes
      graph.addNode("retrieve", this.retrieveNode.bind(this));
      graph.addNode("persona_process", this.personaProcessNode.bind(this));
      graph.addNode("reason", this.reasonNode.bind(this));
      graph.addNode("human_approval", this.humanApprovalNode.bind(this));
      graph.addNode("finalize", this.finalizeNode.bind(this));
      graph.addNode("error_handler", this.errorHandlerNode.bind(this));

      // Add conditional routing
      graph.addConditionalEdges(
        "retrieve",
        this.routeAfterRetrieval.bind(this),
        {
          "simple": "persona_process",
          "complex": "reason",
          "sensitive": "human_approval",
          "error": "error_handler"
        }
      );

      graph.addConditionalEdges(
        "reason",
        this.checkApprovalNeeded.bind(this),
        {
          "approve": "human_approval",
          "direct": "persona_process",
          "error": "error_handler"
        }
      );

      graph.addConditionalEdges(
        "persona_process",
        this.checkProcessingResult.bind(this),
        {
          "finalize": "finalize",
          "error": "error_handler"
        }
      );

      graph.addConditionalEdges(
        "human_approval",
        this.checkApprovalResult.bind(this),
        {
          "approved": "persona_process",
          "rejected": "finalize",
          "timeout": "error_handler",
          "error": "error_handler"
        }
      );

      // Set entry and terminal points
      graph.setEntryPoint("retrieve");
      graph.addEdge("finalize", END);
      graph.addEdge("error_handler", END);

      logger.info('LangGraph workflow created successfully', {
        nodeCount: 6,
        entryPoint: 'retrieve',
        hasCheckpointer: !!this.checkpointer
      });

      // Compile graph with optional checkpointing
      const compiledGraph = this.checkpointer 
        ? graph.compile({
            checkpointer: this.checkpointer,
            interruptBefore: ["human_approval"],
            interruptAfter: ["error_handler"]
          })
        : graph.compile();

      return compiledGraph;

    } catch (error) {
      logError(error, {
        operation: 'createZeroVectorGraph'
      });
      throw error;
    }
  }

  /**
   * Retrieve node - Hybrid vector-graph search
   */
  async retrieveNode(state) {
    try {
      logger.debug('Executing retrieve node', {
        messageCount: state.messages?.length || 0,
        activePersona: state.active_persona,
        userId: state.user_profile?.id
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        workflow_id: state.workflow_context?.workflow_id || `workflow_${Date.now()}`,
        workflow_type: 'zero_vector_conversation',
        current_step: 'retrieve',
        completed_steps: [],
        reasoning_path: ['Starting hybrid retrieval'],
        decision_points: [],
        branch_history: ['retrieve'],
        interrupt_points: [],
        resumable: true
      });

      // Execute hybrid retrieval agent
      updatedState = await this.hybridRetrievalAgent.__call__(updatedState);

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        execution_id: state.execution_metadata?.execution_id || `exec_${Date.now()}`,
        start_time: state.execution_metadata?.start_time || Date.now(),
        step_count: (state.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...state.execution_metadata?.agent_executions,
          hybrid_retrieval: (state.execution_metadata?.agent_executions?.hybrid_retrieval || 0) + 1
        }
      });

      logger.info('Retrieve node completed', {
        vectorResultCount: updatedState.vector_results?.length || 0,
        graphRelationshipCount: updatedState.graph_relationships?.length || 0,
        memoryContext: updatedState.memory_context?.query_complexity
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'retrieveNode',
        userId: state.user_profile?.id,
        messageCount: state.messages?.length
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'RETRIEVE_NODE_ERROR',
        message: error.message,
        step: 'retrieve',
        recoverable: true
      });
    }
  }

  /**
   * Persona processing node - Generate persona-aware response
   */
  async personaProcessNode(state) {
    try {
      logger.debug('Executing persona process node', {
        activePersona: state.active_persona,
        vectorResultCount: state.vector_results?.length || 0,
        userId: state.user_profile?.id
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'persona_process',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Processing with persona memory agent'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'persona_process']
      });

      // Execute persona memory agent
      updatedState = await this.personaMemoryAgent.__call__(updatedState);

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...updatedState.execution_metadata?.agent_executions,
          persona_memory: (updatedState.execution_metadata?.agent_executions?.persona_memory || 0) + 1
        }
      });

      logger.info('Persona process node completed', {
        activePersona: state.active_persona,
        messageCount: updatedState.messages?.length || 0,
        hasResponse: updatedState.messages?.some(m => m.type === 'ai') || false
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'personaProcessNode',
        activePersona: state.active_persona,
        userId: state.user_profile?.id
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'PERSONA_PROCESS_ERROR',
        message: error.message,
        step: 'persona_process',
        recoverable: true
      });
    }
  }

  /**
   * Reasoning node - Multi-step reasoning for complex queries
   */
  async reasonNode(state) {
    try {
      logger.debug('Executing reason node', {
        queryComplexity: state.memory_context?.query_complexity,
        vectorResultCount: state.vector_results?.length || 0
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'reason',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Applying multi-step reasoning'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'reason']
      });

      // Execute reasoning agent if available
      if (this.reasoningAgent) {
        updatedState = await this.reasoningAgent.__call__(updatedState);
      } else {
        // Fallback: simple reasoning enhancement
        updatedState = await this.performSimpleReasoning(updatedState);
      }

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...updatedState.execution_metadata?.agent_executions,
          reasoning: (updatedState.execution_metadata?.agent_executions?.reasoning || 0) + 1
        }
      });

      logger.info('Reason node completed', {
        queryComplexity: state.memory_context?.query_complexity,
        reasoningApplied: true
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'reasonNode',
        queryComplexity: state.memory_context?.query_complexity
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'REASON_NODE_ERROR',
        message: error.message,
        step: 'reason',
        recoverable: true
      });
    }
  }

  /**
   * Human approval node - Handle sensitive content
   */
  async humanApprovalNode(state) {
    try {
      logger.debug('Executing human approval node', {
        requiresApproval: state.requires_approval,
        approvalContext: !!state.approval_context
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'human_approval',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Requesting human approval'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'human_approval'],
        interrupt_points: [...(state.workflow_context?.interrupt_points || []), 'human_approval']
      });

      // Execute approval agent if available
      if (this.approvalAgent) {
        updatedState = await this.approvalAgent.__call__(updatedState);
      } else {
        // Fallback: simple approval handling
        updatedState = await this.handleSimpleApproval(updatedState);
      }

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...updatedState.execution_metadata?.agent_executions,
          approval: (updatedState.execution_metadata?.agent_executions?.approval || 0) + 1
        }
      });

      logger.info('Human approval node completed', {
        approvalRequired: state.requires_approval,
        approvalStatus: updatedState.approval_context?.approval_status
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'humanApprovalNode',
        requiresApproval: state.requires_approval
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'APPROVAL_NODE_ERROR',
        message: error.message,
        step: 'human_approval',
        recoverable: true
      });
    }
  }

  /**
   * Finalize node - Complete the workflow
   */
  async finalizeNode(state) {
    try {
      logger.debug('Executing finalize node', {
        messageCount: state.messages?.length || 0,
        hasErrors: state.errors?.length > 0
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'finalize',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'finalized'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Workflow completed'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'finalize'],
        resumable: false
      });

      // Update execution metadata with final timing
      const endTime = Date.now();
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        end_time: endTime,
        execution_time_ms: endTime - (updatedState.execution_metadata?.start_time || endTime),
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1
      });

      // Add success message if no AI response was generated
      if (!updatedState.messages?.some(m => m.type === 'ai')) {
        updatedState = ZeroVectorStateManager.addMessage(updatedState, {
          type: 'ai',
          content: 'I apologize, but I encountered an issue processing your request. Please try again or rephrase your question.',
          additional_kwargs: {
            fallback_response: true,
            workflow_completed: true
          }
        });
      }

      logger.info('Finalize node completed', {
        totalMessages: updatedState.messages?.length || 0,
        totalSteps: updatedState.execution_metadata?.step_count || 0,
        executionTimeMs: updatedState.execution_metadata?.execution_time_ms || 0,
        hasErrors: updatedState.errors?.length > 0
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'finalizeNode',
        messageCount: state.messages?.length
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'FINALIZE_NODE_ERROR',
        message: error.message,
        step: 'finalize',
        recoverable: false
      });
    }
  }

  /**
   * Error handler node - Handle and recover from errors
   */
  async errorHandlerNode(state) {
    try {
      logger.debug('Executing error handler node', {
        errorCount: state.errors?.length || 0,
        lastError: state.errors?.[state.errors.length - 1]?.code
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'error_handler',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'error_handling'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Handling errors'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'error_handler'],
        resumable: false
      });

      // Generate error response
      const errorMessage = this.generateErrorResponse(state.errors || []);
      updatedState = ZeroVectorStateManager.addMessage(updatedState, {
        type: 'ai',
        content: errorMessage,
        additional_kwargs: {
          error_response: true,
          error_count: state.errors?.length || 0
        }
      });

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        end_time: Date.now(),
        error_count: state.errors?.length || 0,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1
      });

      logger.warn('Error handler node completed', {
        errorCount: state.errors?.length || 0,
        errorResponse: errorMessage.substring(0, 100)
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'errorHandlerNode',
        originalErrorCount: state.errors?.length
      });

      // Return minimal error state
      return {
        ...state,
        messages: [...(state.messages || []), {
          type: 'ai',
          content: 'I apologize, but I encountered a critical error. Please try again later.',
          additional_kwargs: { critical_error: true }
        }]
      };
    }
  }

  /**
   * Routing functions
   */
  routeAfterRetrieval(state) {
    try {
      // Check for errors first
      if (state.errors && state.errors.length > 0) {
        logger.debug('Routing to error handler due to errors');
        return "error";
      }

      // Check query complexity
      const complexity = state.memory_context?.query_complexity || 'simple';
      
      // Check for sensitive content
      if (this.isSensitiveContent(state)) {
        logger.debug('Routing to human approval due to sensitive content');
        return "sensitive";
      }

      // Route based on complexity
      if (complexity === 'complex') {
        logger.debug('Routing to reasoning due to complex query');
        return "complex";
      }

      logger.debug('Routing to persona processing for simple/moderate query');
      return "simple";

    } catch (error) {
      logger.warn('Error in routing after retrieval', { error: error.message });
      return "error";
    }
  }

  checkApprovalNeeded(state) {
    try {
      if (state.errors && state.errors.length > 0) {
        return "error";
      }

      if (state.requires_approval || this.isSensitiveContent(state)) {
        logger.debug('Approval required for processing');
        return "approve";
      }

      logger.debug('No approval required, proceeding directly');
      return "direct";

    } catch (error) {
      logger.warn('Error checking approval needed', { error: error.message });
      return "error";
    }
  }

  checkProcessingResult(state) {
    try {
      if (state.errors && state.errors.length > 0) {
        return "error";
      }

      logger.debug('Processing completed successfully');
      return "finalize";

    } catch (error) {
      logger.warn('Error checking processing result', { error: error.message });
      return "error";
    }
  }

  checkApprovalResult(state) {
    try {
      if (state.errors && state.errors.length > 0) {
        return "error";
      }

      const approvalStatus = state.approval_context?.approval_status;
      
      if (approvalStatus === 'approved') {
        logger.debug('Request approved, proceeding');
        return "approved";
      } else if (approvalStatus === 'rejected') {
        logger.debug('Request rejected, finalizing');
        return "rejected";
      } else if (approvalStatus === 'timeout') {
        logger.debug('Approval timeout, handling as error');
        return "timeout";
      }

      logger.debug('Unknown approval status, handling as error');
      return "error";

    } catch (error) {
      logger.warn('Error checking approval result', { error: error.message });
      return "error";
    }
  }

  /**
   * Helper functions
   */
  isSensitiveContent(state) {
    if (!this.config.humanInTheLoop?.riskAssessmentEnabled) {
      return false;
    }

    const query = state.messages?.[state.messages.length - 1]?.content || '';
    const sensitiveTopics = this.config.humanInTheLoop?.sensitiveTopics || [];
    
    return sensitiveTopics.some(topic => 
      query.toLowerCase().includes(topic.toLowerCase())
    );
  }

  async performSimpleReasoning(state) {
    // Simple reasoning fallback
    logger.debug('Applying simple reasoning enhancement');
    
    // Add reasoning context to workflow
    return ZeroVectorStateManager.updateWorkflowContext(state, {
      ...state.workflow_context,
      reasoning_path: [...(state.workflow_context?.reasoning_path || []), 
        'Applied simple reasoning enhancement'],
      decision_points: [...(state.workflow_context?.decision_points || []), {
        step: 'simple_reasoning',
        enhancement: 'basic_logic_check',
        timestamp: new Date().toISOString()
      }]
    });
  }

  async handleSimpleApproval(state) {
    // Simple approval handling fallback
    logger.debug('Handling approval with simple approval logic');
    
    const approvalContext = {
      approval_id: `approval_${Date.now()}`,
      risk_level: 'medium',
      risk_score: 0.5,
      sensitive_topics: [],
      requires_human_approval: true,
      approval_timeout_ms: this.config.humanInTheLoop?.approvalTimeout || 300000,
      submitted_at: new Date().toISOString(),
      approval_status: 'pending'
    };

    return ZeroVectorStateManager.setApprovalRequired(state, approvalContext);
  }

  generateErrorResponse(errors) {
    if (errors.length === 0) {
      return 'I encountered an unexpected issue. Please try again.';
    }

    const lastError = errors[errors.length - 1];
    
    if (lastError.code === 'HYBRID_RETRIEVAL_ERROR') {
      return 'I had trouble searching for relevant information. Please rephrase your question and try again.';
    } else if (lastError.code === 'PERSONA_MEMORY_ERROR') {
      return 'I encountered an issue accessing my memory system. Your question is important to me, so please try again.';
    } else if (lastError.recoverable) {
      return 'I encountered a temporary issue but can try again. Please rephrase your question or try a different approach.';
    } else {
      return 'I apologize, but I encountered a critical error. Please contact support if this issue persists.';
    }
  }

  getStateSchema() {
    // Return the state schema for LangGraph
    // This would typically be converted from Zod to LangGraph's expected format
    return {
      messages: { type: 'array', default: [] },
      active_persona: { type: 'string', optional: true },
      user_profile: { type: 'object' },
      vector_results: { type: 'array', default: [] },
      graph_relationships: { type: 'array', default: [] },
      memory_context: { type: 'object', optional: true },
      workflow_context: { type: 'object', optional: true },
      approval_context: { type: 'object', optional: true },
      requires_approval: { type: 'boolean', default: false },
      execution_metadata: { type: 'object', optional: true },
      features: { type: 'object', default: {} },
      errors: { type: 'array', default: [] }
    };
  }
}

module.exports = ZeroVectorGraph;
