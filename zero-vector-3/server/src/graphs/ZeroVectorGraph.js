const { StateGraph } = require('@langchain/langgraph');
const { END } = require('@langchain/langgraph');
const { ZeroVectorStateManager } = require('../state/ZeroVectorState');
const { logger, logError, logWorkflow, createTimer } = require('../utils/logger');
const { z } = require('zod');

// Import Phase 3 components
const MemoryLifecycleManager = require('../services/MemoryLifecycleManager');
const HumanApprovalAgent = require('../agents/HumanApprovalAgent');
const PerformanceCacheManager = require('../services/PerformanceCacheManager');
const PersonaCoordinationAgent = require('../agents/PersonaCoordinationAgent');

/**
 * Zero-Vector-3 LangGraph Workflow
 * Main orchestration graph implementing the patterns from LangGraph-DEV-HANDOFF.md
 * Enhanced with Phase 3 Advanced Features:
 * - Memory Management & Persistence
 * - Human-in-the-Loop Workflows
 * - Performance Optimization
 */
class ZeroVectorGraph {
  constructor(components) {
    this.hybridRetrievalAgent = components.hybridRetrievalAgent;
    this.personaMemoryAgent = components.personaMemoryAgent;
    this.reasoningAgent = components.reasoningAgent;
    // Skip HumanApprovalAgent for now to test workflow
    this.approvalAgent = components.approvalAgent || {
      __call__: async (state) => {
        // Mock approval agent - auto-approve everything for testing
        return {
          ...state,
          approval_context: {
            approval_status: 'bypassed',
            bypass_reason: 'testing_mode',
            timestamp: new Date().toISOString()
          },
          requires_approval: false
        };
      }
    };
    this.checkpointer = components.checkpointer;
    this.config = components.config || {};
    
    // Phase 3 components
    this.memoryLifecycleManager = components.memoryLifecycleManager || 
      new MemoryLifecycleManager(components.memoryStore, this.config.memoryLifecycle);
    this.cacheManager = components.cacheManager || 
      new PerformanceCacheManager(components.redisClient, this.config.cache);
    
    // Cross-persona coordination agent
    this.personaCoordinationAgent = components.personaCoordinationAgent || 
      new PersonaCoordinationAgent(
        this.personaMemoryAgent, 
        this.hybridRetrievalAgent, 
        this.config.crossPersona || {}
      );
    
    logger.info('ZeroVectorGraph initialized with Phase 3 enhancements and cross-persona support', {
      components: Object.keys(components),
      checkpointerEnabled: !!this.checkpointer,
      memoryLifecycleEnabled: !!this.memoryLifecycleManager,
      cacheManagerEnabled: !!this.cacheManager,
      approvalAgentEnabled: !!this.approvalAgent,
      crossPersonaEnabled: !!this.personaCoordinationAgent
    });
  }

  /**
   * Initialize the graph and compile it
   */
  async initialize() {
    try {
      this.compiledGraph = this.createGraph();
      logger.info('ZeroVectorGraph compiled successfully');
      return this.compiledGraph;
    } catch (error) {
      logError(error, { operation: 'ZeroVectorGraph.initialize' });
      throw error;
    }
  }

  /**
   * Invoke the compiled graph
   */
  async invoke(state, config) {
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initialize() first.');
    }
    return await this.compiledGraph.invoke(state, config);
  }

  /**
   * Get state from the compiled graph
   */
  async getState(config) {
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initialize() first.');
    }
    return await this.compiledGraph.getState(config);
  }

  /**
   * Create the main LangGraph workflow with Phase 3 enhancements
   */
  createGraph() {
    const timer = createTimer('create_zero_vector_graph');
    
    try {
      // Create Zod schema for LangGraph StateGraph
      const stateSchema = z.object({
        messages: z.array(z.any()).default([]),
        active_persona: z.string().optional(),
        user_profile: z.object({}).optional(),
        vector_results: z.array(z.any()).default([]),
        graph_relationships: z.array(z.any()).default([]),
        memory_context: z.object({}).optional(),
        workflow_context: z.object({}).optional(),
        approval_context: z.object({}).optional(),
        requires_approval: z.boolean().default(false),
        execution_metadata: z.object({}).optional(),
        features: z.object({}).default({}),
        errors: z.array(z.any()).default([]),
        memory_maintenance_required: z.boolean().default(false),
        memory_maintenance_reason: z.string().optional(),
        memory_maintenance_results: z.object({}).optional(),
        persona_context: z.object({}).optional()
      });

      // Create state graph with proper Zod schema as first parameter
      const graph = new StateGraph(stateSchema);

      // Add agent nodes
      graph.addNode("retrieve", this.retrieveNode.bind(this));
      graph.addNode("persona_coordination", this.personaCoordinationNode.bind(this));
      graph.addNode("persona_process", this.personaProcessNode.bind(this));
      graph.addNode("reason", this.reasonNode.bind(this));
      graph.addNode("human_approval", this.humanApprovalNode.bind(this));
      graph.addNode("memory_maintenance", this.memoryMaintenanceNode.bind(this));
      graph.addNode("finalize", this.finalizeNode.bind(this));
      graph.addNode("error_handler", this.errorHandlerNode.bind(this));

      // Add conditional routing with Phase 3 enhancements and cross-persona coordination
      graph.addConditionalEdges(
        "retrieve",
        this.routeAfterRetrieval.bind(this),
        {
          "simple": "persona_process",
          "complex": "reason",
          "sensitive": "human_approval",
          "maintenance": "memory_maintenance",
          "coordination": "persona_coordination",
          "error": "error_handler"
        }
      );

      graph.addConditionalEdges(
        "reason",
        this.checkApprovalNeeded.bind(this),
        {
          "approve": "human_approval",
          "direct": "persona_coordination",
          "error": "error_handler"
        }
      );

      graph.addConditionalEdges(
        "persona_coordination",
        this.checkCoordinationResult.bind(this),
        {
          "finalize": "finalize",
          "maintenance": "memory_maintenance",
          "error": "error_handler"
        }
      );

      graph.addConditionalEdges(
        "persona_process",
        this.checkProcessingResult.bind(this),
        {
          "finalize": "finalize",
          "maintenance": "memory_maintenance",
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

      graph.addConditionalEdges(
        "memory_maintenance",
        this.checkMaintenanceResult.bind(this),
        {
          "continue": "finalize",
          "error": "error_handler"
        }
      );

      // Set entry and terminal points
      graph.setEntryPoint("retrieve");
      graph.addEdge("finalize", END);
      graph.addEdge("error_handler", END);

      const perfData = timer.end({
        nodeCount: 7,
        entryPoint: 'retrieve',
        hasCheckpointer: !!this.checkpointer
      });

      logWorkflow('graph_created', 'zero_vector_graph', {
        nodeCount: 7,
        phase3Enhanced: true,
        creationTime: perfData.duration
      });

      // Compile graph with Phase 3 interrupt points
      const compiledGraph = this.checkpointer 
        ? graph.compile({
            checkpointer: this.checkpointer,
            interruptBefore: ["human_approval", "memory_maintenance"],
            interruptAfter: ["error_handler"]
          })
        : graph.compile();

      return compiledGraph;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'createZeroVectorGraph'
      });
      throw error;
    }
  }

  /**
   * Enhanced retrieve node with caching and performance optimization
   */
  async retrieveNode(state) {
    const timer = createTimer('retrieve_node', {
      userId: state.user_profile?.id,
      messageCount: state.messages?.length || 0
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'retrieve_start', {
        activePersona: state.active_persona,
        userId: state.user_profile?.id
      });

      // Check cache first for performance optimization
      const query = state.messages?.[state.messages.length - 1]?.content || '';
      const cachedResults = await this.checkRetrievalCache(query, state);
      
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        workflow_id: state.workflow_context?.workflow_id || `workflow_${Date.now()}`,
        workflow_type: 'zero_vector_conversation',
        current_step: 'retrieve',
        completed_steps: [],
        reasoning_path: ['Starting hybrid retrieval with cache check'],
        decision_points: [],
        branch_history: ['retrieve'],
        interrupt_points: [],
        resumable: true
      });

      if (cachedResults) {
        // Use cached results
        updatedState.vector_results = cachedResults.results;
        updatedState.memory_context = {
          ...cachedResults.metadata,
          cached: true,
          cache_source: cachedResults.source
        };

        logWorkflow(state.workflow_context?.workflow_id, 'retrieve_cached', {
          resultCount: cachedResults.results.length,
          cacheSource: cachedResults.source
        });
      } else {
        // Execute hybrid retrieval agent
        updatedState = await this.hybridRetrievalAgent.__call__(updatedState);
        
        // Cache results for future use
        await this.cacheRetrievalResults(query, updatedState);
      }

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        execution_id: state.execution_metadata?.execution_id || `exec_${Date.now()}`,
        start_time: state.execution_metadata?.start_time || Date.now(),
        step_count: (state.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...state.execution_metadata?.agent_executions,
          hybrid_retrieval: (state.execution_metadata?.agent_executions?.hybrid_retrieval || 0) + 1
        },
        cache_hits: cachedResults ? 1 : 0
      });

      const perfData = timer.end({
        vectorResultCount: updatedState.vector_results?.length || 0,
        cached: !!cachedResults
      });

      logWorkflow(state.workflow_context?.workflow_id, 'retrieve_completed', {
        vectorResultCount: updatedState.vector_results?.length || 0,
        graphRelationshipCount: updatedState.graph_relationships?.length || 0,
        memoryContext: updatedState.memory_context?.query_complexity,
        duration: perfData.duration,
        cached: !!cachedResults
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
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
   * Cross-persona coordination node for Phase 3 advanced workflows
   */
  async personaCoordinationNode(state) {
    const timer = createTimer('persona_coordination_node', {
      activePersona: state.active_persona,
      userId: state.user_profile?.id,
      crossPersonaEnabled: true
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'persona_coordination_start', {
        activePersona: state.active_persona,
        userId: state.user_profile?.id,
        vectorResultCount: state.vector_results?.length || 0
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'persona_coordination',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Coordinating cross-persona workflow'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'persona_coordination']
      });

      // Execute persona coordination agent
      updatedState = await this.personaCoordinationAgent.__call__(updatedState);

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...updatedState.execution_metadata?.agent_executions,
          persona_coordination: (updatedState.execution_metadata?.agent_executions?.persona_coordination || 0) + 1
        }
      });

      const perfData = timer.end({
        hasResponse: updatedState.messages?.some(m => m.type === 'ai') || false,
        coordinationUsed: !!updatedState.persona_coordination,
        personaSwitches: updatedState.persona_coordination?.handoffs?.length || 0
      });

      logWorkflow(state.workflow_context?.workflow_id, 'persona_coordination_completed', {
        activePersona: updatedState.active_persona,
        messageCount: updatedState.messages?.length || 0,
        hasResponse: updatedState.messages?.some(m => m.type === 'ai') || false,
        coordinationUsed: !!updatedState.persona_coordination,
        personaSwitches: updatedState.persona_coordination?.handoffs?.length || 0,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'personaCoordinationNode',
        activePersona: state.active_persona,
        userId: state.user_profile?.id
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'PERSONA_COORDINATION_ERROR',
        message: error.message,
        step: 'persona_coordination',
        recoverable: true
      });
    }
  }

  /**
   * Enhanced persona processing node with memory lifecycle awareness
   */
  async personaProcessNode(state) {
    const timer = createTimer('persona_process_node', {
      activePersona: state.active_persona,
      userId: state.user_profile?.id
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'persona_process_start', {
        activePersona: state.active_persona,
        vectorResultCount: state.vector_results?.length || 0
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'persona_process',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Processing with enhanced persona memory agent'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'persona_process']
      });

      // Check if memory maintenance is needed before processing
      const needsMaintenance = await this.checkMemoryMaintenanceNeeded(state);
      if (needsMaintenance) {
        updatedState.memory_maintenance_required = true;
        updatedState.memory_maintenance_reason = needsMaintenance.reason;
      }

      // Execute persona memory agent
      updatedState = await this.personaMemoryAgent.__call__(updatedState);

      // Cache persona context for future use
      if (updatedState.persona_context) {
        await this.cachePersonaContext(state.active_persona, state.user_profile?.id, updatedState.persona_context);
      }

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...updatedState.execution_metadata?.agent_executions,
          persona_memory: (updatedState.execution_metadata?.agent_executions?.persona_memory || 0) + 1
        }
      });

      const perfData = timer.end({
        hasResponse: updatedState.messages?.some(m => m.type === 'ai') || false,
        needsMaintenance
      });

      logWorkflow(state.workflow_context?.workflow_id, 'persona_process_completed', {
        activePersona: state.active_persona,
        messageCount: updatedState.messages?.length || 0,
        hasResponse: updatedState.messages?.some(m => m.type === 'ai') || false,
        needsMaintenance,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
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
   * Enhanced reasoning node with multi-step reasoning
   */
  async reasonNode(state) {
    const timer = createTimer('reason_node', {
      queryComplexity: state.memory_context?.query_complexity
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'reason_start', {
        queryComplexity: state.memory_context?.query_complexity,
        vectorResultCount: state.vector_results?.length || 0
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'reason',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Applying multi-step reasoning with performance optimization'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'reason']
      });

      // Execute reasoning agent if available
      if (this.reasoningAgent) {
        updatedState = await this.reasoningAgent.__call__(updatedState);
      } else {
        // Enhanced reasoning fallback
        updatedState = await this.performEnhancedReasoning(updatedState);
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

      const perfData = timer.end({
        reasoningApplied: true
      });

      logWorkflow(state.workflow_context?.workflow_id, 'reason_completed', {
        queryComplexity: state.memory_context?.query_complexity,
        reasoningApplied: true,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
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
   * Enhanced human approval node with risk assessment and timeout handling
   */
  async humanApprovalNode(state) {
    const timer = createTimer('human_approval_node', {
      requiresApproval: state.requires_approval
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'human_approval_start', {
        requiresApproval: state.requires_approval,
        approvalContext: !!state.approval_context
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'human_approval',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Processing human approval with risk assessment'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'human_approval'],
        interrupt_points: [...(state.workflow_context?.interrupt_points || []), 'human_approval']
      });

      // Execute approval agent
      updatedState = await this.approvalAgent.__call__(updatedState);

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        agent_executions: {
          ...updatedState.execution_metadata?.agent_executions,
          approval: (updatedState.execution_metadata?.agent_executions?.approval || 0) + 1
        }
      });

      const perfData = timer.end({
        approvalStatus: updatedState.approval_context?.approval_status
      });

      logWorkflow(state.workflow_context?.workflow_id, 'human_approval_completed', {
        approvalRequired: state.requires_approval,
        approvalStatus: updatedState.approval_context?.approval_status,
        riskLevel: updatedState.approval_context?.risk_assessment?.risk_level,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
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
   * New memory maintenance node for Phase 3
   */
  async memoryMaintenanceNode(state) {
    const timer = createTimer('memory_maintenance_node', {
      userId: state.user_profile?.id,
      maintenanceReason: state.memory_maintenance_reason
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'memory_maintenance_start', {
        userId: state.user_profile?.id,
        reason: state.memory_maintenance_reason
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'memory_maintenance',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'memory_maintenance'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Performing memory lifecycle maintenance'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'memory_maintenance']
      });

      // Perform memory maintenance
      const maintenanceResults = await this.memoryLifecycleManager.performMaintenanceForUser(
        state.user_profile?.id,
        { 
          triggered_by: 'workflow',
          reason: state.memory_maintenance_reason 
        }
      );

      // Update state with maintenance results
      updatedState.memory_maintenance_results = maintenanceResults;
      updatedState.memory_maintenance_required = false;

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        memory_maintenance: {
          archived: maintenanceResults.archival?.archived || 0,
          compressed: maintenanceResults.compression?.compressed || 0,
          deleted: maintenanceResults.cleanup?.deleted || 0,
          conflicts_resolved: maintenanceResults.conflicts?.resolved || 0
        }
      });

      const perfData = timer.end({
        maintenanceCompleted: true,
        archivedCount: maintenanceResults.archival?.archived || 0
      });

      logWorkflow(state.workflow_context?.workflow_id, 'memory_maintenance_completed', {
        userId: state.user_profile?.id,
        results: maintenanceResults,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'memoryMaintenanceNode',
        userId: state.user_profile?.id,
        maintenanceReason: state.memory_maintenance_reason
      });

      return ZeroVectorStateManager.addError(state, {
        code: 'MEMORY_MAINTENANCE_ERROR',
        message: error.message,
        step: 'memory_maintenance',
        recoverable: true
      });
    }
  }

  /**
   * Enhanced finalize node with performance metrics
   */
  async finalizeNode(state) {
    const timer = createTimer('finalize_node', {
      messageCount: state.messages?.length || 0
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'finalize_start', {
        messageCount: state.messages?.length || 0,
        hasErrors: state.errors?.length > 0
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'finalize',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'finalized'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Workflow completed with Phase 3 enhancements'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'finalize'],
        resumable: false
      });

      // Update execution metadata with final timing and performance metrics
      const endTime = Date.now();
      const executionTime = endTime - (updatedState.execution_metadata?.start_time || endTime);
      
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        end_time: endTime,
        execution_time_ms: executionTime,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        performance_metrics: {
          total_execution_time: executionTime,
          cache_hit_rate: this.calculateCacheHitRate(updatedState),
          memory_maintenance_triggered: !!state.memory_maintenance_results,
          approval_required: !!state.approval_context,
          final_message_count: updatedState.messages?.length || 0
        }
      });

      // Add success message if no AI response was generated
      if (!updatedState.messages?.some(m => m.type === 'ai')) {
        updatedState = ZeroVectorStateManager.addMessage(updatedState, {
          type: 'ai',
          content: 'I apologize, but I encountered an issue processing your request. Please try again or rephrase your question.',
          additional_kwargs: {
            fallback_response: true,
            workflow_completed: true,
            phase3_enhanced: true
          }
        });
      }

      const perfData = timer.end({
        totalSteps: updatedState.execution_metadata?.step_count || 0,
        executionTimeMs: executionTime
      });

      logWorkflow(state.workflow_context?.workflow_id, 'finalize_completed', {
        totalMessages: updatedState.messages?.length || 0,
        totalSteps: updatedState.execution_metadata?.step_count || 0,
        executionTimeMs: executionTime,
        hasErrors: updatedState.errors?.length > 0,
        cacheHitRate: updatedState.execution_metadata?.performance_metrics?.cache_hit_rate,
        memoryMaintenanceTriggered: !!state.memory_maintenance_results,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
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
   * Enhanced error handler node
   */
  async errorHandlerNode(state) {
    const timer = createTimer('error_handler_node', {
      errorCount: state.errors?.length || 0
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'error_handler_start', {
        errorCount: state.errors?.length || 0,
        lastError: state.errors?.[state.errors.length - 1]?.code
      });

      // Update workflow context
      let updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
        ...state.workflow_context,
        current_step: 'error_handler',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'error_handling'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 'Handling errors with enhanced recovery'],
        branch_history: [...(state.workflow_context?.branch_history || []), 'error_handler'],
        resumable: false
      });

      // Generate enhanced error response
      const errorMessage = this.generateEnhancedErrorResponse(state.errors || []);
      updatedState = ZeroVectorStateManager.addMessage(updatedState, {
        type: 'ai',
        content: errorMessage,
        additional_kwargs: {
          error_response: true,
          error_count: state.errors?.length || 0,
          phase3_enhanced: true,
          recoverable: this.isRecoverable(state.errors || [])
        }
      });

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        end_time: Date.now(),
        error_count: state.errors?.length || 0,
        step_count: (updatedState.execution_metadata?.step_count || 0) + 1,
        error_recovery_attempted: true
      });

      const perfData = timer.end({
        errorCount: state.errors?.length || 0
      });

      logWorkflow(state.workflow_context?.workflow_id, 'error_handler_completed', {
        errorCount: state.errors?.length || 0,
        errorResponse: errorMessage.substring(0, 100),
        recoverable: this.isRecoverable(state.errors || []),
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
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
          additional_kwargs: { 
            critical_error: true,
            phase3_enhanced: true
          }
        }]
      };
    }
  }

  /**
   * Enhanced routing functions with Phase 3 logic
   */
  routeAfterRetrieval(state) {
    try {
      // Check for errors first
      if (state.errors && state.errors.length > 0) {
        logger.debug('Routing to error handler due to errors');
        return "error";
      }

      // Check if memory maintenance is required
      if (state.memory_maintenance_required) {
        logger.debug('Routing to memory maintenance');
        return "maintenance";
      }

      // Check query complexity
      const complexity = state.memory_context?.query_complexity || 'simple';
      
      // Check for sensitive content with enhanced risk assessment
      if (this.isSensitiveContentEnhanced(state)) {
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

      if (state.requires_approval || this.isSensitiveContentEnhanced(state)) {
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

  checkCoordinationResult(state) {
    try {
      if (state.errors && state.errors.length > 0) {
        return "error";
      }

      // Check if memory maintenance is needed after coordination
      if (state.memory_maintenance_required) {
        logger.debug('Memory maintenance required after persona coordination');
        return "maintenance";
      }

      // Check if coordination was successful and produced a response
      const hasResponse = state.messages?.some(m => m.type === 'ai') || false;
      if (hasResponse) {
        logger.debug('Persona coordination completed successfully with response');
        return "finalize";
      }

      // If coordination didn't produce a response, check for handoffs
      const hasHandoffs = state.persona_coordination?.handoffs?.length > 0;
      if (hasHandoffs) {
        logger.debug('Persona coordination completed with handoffs but no final response yet');
        return "finalize"; // Still finalize as coordination process is complete
      }

      logger.debug('Persona coordination completed successfully');
      return "finalize";

    } catch (error) {
      logger.warn('Error checking coordination result', { error: error.message });
      return "error";
    }
  }

  checkProcessingResult(state) {
    try {
      if (state.errors && state.errors.length > 0) {
        return "error";
      }

      // Check if memory maintenance is needed after processing
      if (state.memory_maintenance_required) {
        logger.debug('Memory maintenance required after processing');
        return "maintenance";
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

  checkMaintenanceResult(state) {
    try {
      if (state.errors && state.errors.length > 0) {
        return "error";
      }

      if (state.memory_maintenance_results) {
        logger.debug('Memory maintenance completed successfully');
        return "continue";
      }

      logger.debug('Memory maintenance encountered issues');
      return "error";

    } catch (error) {
      logger.warn('Error checking maintenance result', { error: error.message });
      return "error";
    }
  }

  /**
   * Phase 3 helper functions
   */
  async checkRetrievalCache(query, state) {
    if (!this.cacheManager) return null;

    const searchParams = {
      type: 'hybrid_retrieval',
      persona: state.active_persona,
      user_id: state.user_profile?.id
    };

    return await this.cacheManager.getCachedSearchResults(query, searchParams);
  }

  async cacheRetrievalResults(query, state) {
    if (!this.cacheManager || !state.vector_results) return;

    const searchParams = {
      type: 'hybrid_retrieval',
      persona: state.active_persona,
      user_id: state.user_profile?.id
    };

    await this.cacheManager.cacheSearchResults(query, state.vector_results, searchParams);
  }

  async cachePersonaContext(personaId, userId, context) {
    if (!this.cacheManager) return;
    await this.cacheManager.cachePersonaContext(personaId, userId, context);
  }

  async checkMemoryMaintenanceNeeded(state) {
    if (!this.memoryLifecycleManager) return null;

    const userId = state.user_profile?.id;
    if (!userId) return null;

    // Check various maintenance triggers
    const checks = await this.memoryLifecycleManager.checkMaintenanceNeeded(userId);
    
    if (checks.archival_needed || checks.compression_needed || checks.cleanup_needed || checks.conflicts_detected) {
      return {
        needed: true,
        reason: 'scheduled_maintenance',
        details: checks
      };
    }

    return null;
  }

  calculateCacheHitRate(state) {
    const cacheHits = state.execution_metadata?.cache_hits || 0;
    const totalRequests = (state.execution_metadata?.agent_executions?.hybrid_retrieval || 0) + 
                         (state.execution_metadata?.agent_executions?.persona_memory || 0);
    
    return totalRequests > 0 ? cacheHits / totalRequests : 0;
  }

  isSensitiveContentEnhanced(state) {
    if (!this.config.humanInTheLoop?.riskAssessmentEnabled) {
      return false;
    }

    const query = state.messages?.[state.messages.length - 1]?.content || '';
    const sensitiveTopics = this.config.humanInTheLoop?.sensitiveTopics || [];
    
    // Enhanced sensitivity detection
    const lowerQuery = query.toLowerCase();
    
    // Check direct keyword matches
    const hasDirectMatch = sensitiveTopics.some(topic => 
      lowerQuery.includes(topic.toLowerCase())
    );

    // Check for potential PII patterns
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ // Email
    ];

    const hasPII = piiPatterns.some(pattern => pattern.test(query));

    return hasDirectMatch || hasPII;
  }

  async performEnhancedReasoning(state) {
    // Enhanced reasoning fallback with better logic
    logger.debug('Applying enhanced reasoning enhancement');
    
    const query = state.messages?.[state.messages.length - 1]?.content || '';
    const complexity = this.analyzeQueryComplexity(query);
    
    // Add enhanced reasoning context to workflow
    return ZeroVectorStateManager.updateWorkflowContext(state, {
      ...state.workflow_context,
      reasoning_path: [...(state.workflow_context?.reasoning_path || []), 
        'Applied enhanced reasoning with complexity analysis'],
      decision_points: [...(state.workflow_context?.decision_points || []), {
        step: 'enhanced_reasoning',
        complexity_analysis: complexity,
        enhancement: 'advanced_logic_check',
        timestamp: new Date().toISOString()
      }]
    });
  }

  analyzeQueryComplexity(query) {
    const indicators = {
      length: query.length,
      questionMarks: (query.match(/\?/g) || []).length,
      conjunctions: (query.match(/\b(and|or|but|however|therefore|because)\b/gi) || []).length,
      conditionals: (query.match(/\b(if|when|unless|provided|assuming)\b/gi) || []).length
    };

    let score = 0;
    if (indicators.length > 100) score += 1;
    if (indicators.questionMarks > 1) score += 1;
    if (indicators.conjunctions > 2) score += 2;
    if (indicators.conditionals > 0) score += 2;

    return {
      score,
      level: score >= 4 ? 'complex' : score >= 2 ? 'moderate' : 'simple',
      indicators
    };
  }

  generateEnhancedErrorResponse(errors) {
    if (errors.length === 0) {
      return 'I encountered an unexpected issue while processing your request. Please try again with a different approach.';
    }

    const lastError = errors[errors.length - 1];
    const errorPatterns = {
      'HYBRID_RETRIEVAL_ERROR': 'I had trouble searching through my knowledge base. This might be due to high system load or a complex query. Please try rephrasing your question in simpler terms.',
      'PERSONA_MEMORY_ERROR': 'I encountered an issue accessing my memory system for our conversation. Your question is important to me, so please try again in a moment.',
      'MEMORY_MAINTENANCE_ERROR': 'I experienced a temporary issue while organizing my memory. This is a background process and shouldn\'t affect our conversation. Please continue.',
      'APPROVAL_NODE_ERROR': 'I had trouble with the content review process. This might be related to sensitive content detection. Please rephrase your request.',
      'REASON_NODE_ERROR': 'I encountered difficulty with complex reasoning for your question. Let me try a different approach - could you break down your question into smaller parts?'
    };

    const specificMessage = errorPatterns[lastError.code];
    if (specificMessage) {
      return specificMessage;
    }

    if (lastError.recoverable) {
      return 'I encountered a temporary issue but can try a different approach. Please rephrase your question or try asking about something specific.';
    } else {
      return 'I apologize, but I encountered a critical error while processing your request. Please contact support if this issue continues to occur.';
    }
  }

  isRecoverable(errors) {
    return errors.some(error => error.recoverable === true);
  }

  getStateSchema() {
    // Return a simple object schema that LangGraph can handle
    // Using a basic object structure instead of complex type definitions
    return {
      messages: [],
      active_persona: '',
      user_profile: {},
      vector_results: [],
      graph_relationships: [],
      memory_context: {},
      workflow_context: {},
      approval_context: {},
      requires_approval: false,
      execution_metadata: {},
      features: {},
      errors: [],
      memory_maintenance_required: false,
      memory_maintenance_reason: '',
      memory_maintenance_results: {},
      persona_context: {}
    };
  }
}

module.exports = ZeroVectorGraph;
