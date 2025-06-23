const { z } = require('zod');

/**
 * Zero-Vector-3 State Schema
 * Comprehensive state management for LangGraph integration
 */

// Message schema
const MessageSchema = z.object({
  type: z.enum(['human', 'ai', 'system', 'function']),
  content: z.string(),
  additional_kwargs: z.record(z.any()).optional(),
  response_metadata: z.record(z.any()).optional(),
  tool_calls: z.array(z.any()).optional(),
  invalid_tool_calls: z.array(z.any()).optional(),
  usage_metadata: z.record(z.any()).optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  timestamp: z.number().optional()
});

// Persona context schema
const PersonaContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  personality: z.string(),
  expertise: z.array(z.string()),
  communication_style: z.string(),
  config: z.record(z.any()).optional(),
  memory_namespace: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

// User profile schema
const UserProfileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  preferences: z.record(z.any()).optional(),
  permissions: z.array(z.string()).optional(),
  authenticated: z.boolean().default(true),
  created_at: z.string().optional(),
  last_active: z.string().optional()
});

// Vector result schema
const VectorResultSchema = z.object({
  id: z.string(),
  content: z.string(),
  similarity: z.number(),
  metadata: z.record(z.any()),
  embedding: z.array(z.number()).optional(),
  graphExpanded: z.boolean().optional(),
  graphBoosted: z.boolean().optional(),
  source: z.enum(['vector', 'graph', 'hybrid']).optional()
});

// Graph relationship schema
const GraphRelationshipSchema = z.object({
  id: z.string(),
  source_entity: z.string(),
  target_entity: z.string(),
  relationship_type: z.string(),
  confidence: z.number(),
  metadata: z.record(z.any()).optional(),
  created_at: z.string().optional()
});

// Memory context schema
const MemoryContextSchema = z.object({
  retrieval_timestamp: z.string(),
  query_complexity: z.enum(['simple', 'moderate', 'complex']),
  result_confidence: z.number(),
  processing_time_ms: z.number().optional(),
  cache_hit: z.boolean().optional(),
  graph_expansion_used: z.boolean().optional(),
  entities_extracted: z.number().optional(),
  relationships_found: z.number().optional()
});

// Execution metadata schema
const ExecutionMetadataSchema = z.object({
  execution_id: z.string(),
  start_time: z.number(),
  end_time: z.number().optional(),
  execution_time_ms: z.number().optional(),
  step_count: z.number().optional(),
  agent_executions: z.record(z.number()).optional(),
  memory_usage_mb: z.number().optional(),
  cpu_usage_percent: z.number().optional(),
  cache_hits: z.number().optional(),
  cache_misses: z.number().optional(),
  error_count: z.number().optional(),
  warning_count: z.number().optional()
});

// Approval context schema
const ApprovalContextSchema = z.object({
  approval_id: z.string(),
  risk_level: z.enum(['low', 'medium', 'high']),
  risk_score: z.number(),
  sensitive_topics: z.array(z.string()),
  requires_human_approval: z.boolean(),
  approval_timeout_ms: z.number(),
  submitted_at: z.string(),
  approved_at: z.string().optional(),
  approved_by: z.string().optional(),
  approval_status: z.enum(['pending', 'approved', 'rejected', 'timeout']).optional()
});

// Workflow context schema
const WorkflowContextSchema = z.object({
  workflow_id: z.string(),
  workflow_type: z.string(),
  current_step: z.string(),
  completed_steps: z.array(z.string()),
  reasoning_path: z.array(z.string()),
  decision_points: z.array(z.record(z.any())),
  branch_history: z.array(z.string()),
  interrupt_points: z.array(z.string()),
  resumable: z.boolean(),
  max_steps: z.number().optional(),
  timeout_ms: z.number().optional()
});

// Main Zero-Vector-3 State Schema
const ZeroVectorStateSchema = z.object({
  // Core messaging
  messages: z.array(MessageSchema).default([]),
  
  // Persona management
  active_persona: z.string().optional(),
  persona_context: PersonaContextSchema.optional(),
  user_profile: UserProfileSchema,
  
  // Memory system
  vector_results: z.array(VectorResultSchema).default([]),
  graph_relationships: z.array(GraphRelationshipSchema).default([]),
  memory_context: MemoryContextSchema.optional(),
  
  // Workflow control
  workflow_context: WorkflowContextSchema.optional(),
  
  // Approval system
  approval_context: ApprovalContextSchema.optional(),
  requires_approval: z.boolean().default(false),
  
  // Execution tracking
  execution_metadata: ExecutionMetadataSchema.optional(),
  
  // Additional context
  session_id: z.string().optional(),
  conversation_id: z.string().optional(),
  request_id: z.string().optional(),
  
  // Feature flags
  features: z.object({
    graph_expansion_enabled: z.boolean().default(true),
    entity_extraction_enabled: z.boolean().default(true),
    relationship_extraction_enabled: z.boolean().default(true),
    approval_workflow_enabled: z.boolean().default(true),
    performance_monitoring_enabled: z.boolean().default(true),
    caching_enabled: z.boolean().default(true)
  }).default({}),
  
  // Error handling
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    stack: z.string().optional(),
    timestamp: z.string(),
    step: z.string().optional(),
    recoverable: z.boolean().default(true)
  })).default([]),
  
  // Debugging information
  debug: z.object({
    enabled: z.boolean().default(false),
    trace_id: z.string().optional(),
    debug_level: z.enum(['info', 'debug', 'trace']).default('info'),
    performance_metrics: z.record(z.any()).optional(),
    state_snapshots: z.array(z.any()).optional()
  }).optional()
});

/**
 * State Management Utilities
 */
class ZeroVectorStateManager {
  /**
   * Create a new state instance
   */
  static createState(initialData = {}) {
    const defaultState = {
      messages: [],
      vector_results: [],
      graph_relationships: [],
      requires_approval: false,
      features: {
        graph_expansion_enabled: true,
        entity_extraction_enabled: true,
        relationship_extraction_enabled: true,
        approval_workflow_enabled: true,
        performance_monitoring_enabled: true,
        caching_enabled: true
      },
      errors: []
    };

    const state = { ...defaultState, ...initialData };
    return ZeroVectorStateSchema.parse(state);
  }

  /**
   * Validate state
   */
  static validateState(state) {
    try {
      return ZeroVectorStateSchema.parse(state);
    } catch (error) {
      throw new Error(`Invalid state: ${error.message}`);
    }
  }

  /**
   * Add message to state
   */
  static addMessage(state, message) {
    const validatedMessage = MessageSchema.parse({
      ...message,
      timestamp: message.timestamp || Date.now()
    });

    return {
      ...state,
      messages: [...state.messages, validatedMessage]
    };
  }

  /**
   * Update persona context
   */
  static updatePersonaContext(state, personaContext) {
    const validatedContext = PersonaContextSchema.parse(personaContext);
    
    return {
      ...state,
      active_persona: validatedContext.id,
      persona_context: validatedContext
    };
  }

  /**
   * Add vector results
   */
  static addVectorResults(state, results) {
    const validatedResults = results.map(result => VectorResultSchema.parse(result));
    
    return {
      ...state,
      vector_results: [...state.vector_results, ...validatedResults]
    };
  }

  /**
   * Update memory context
   */
  static updateMemoryContext(state, memoryContext) {
    const validatedContext = MemoryContextSchema.parse(memoryContext);
    
    return {
      ...state,
      memory_context: validatedContext
    };
  }

  /**
   * Update workflow context
   */
  static updateWorkflowContext(state, workflowContext) {
    const validatedContext = WorkflowContextSchema.parse(workflowContext);
    
    return {
      ...state,
      workflow_context: validatedContext
    };
  }

  /**
   * Update persona coordination context
   */
  static updatePersonaCoordination(state, coordinationData) {
    return {
      ...state,
      persona_coordination: {
        ...state.persona_coordination,
        ...coordinationData
      }
    };
  }

  /**
   * Add persona handoff record
   */
  static addPersonaHandoff(state, handoff) {
    return {
      ...state,
      persona_coordination: {
        ...state.persona_coordination,
        handoffs: [
          ...(state.persona_coordination?.handoffs || []),
          handoff
        ]
      }
    };
  }

  /**
   * Switch active persona with coordination tracking
   */
  static switchPersona(state, newPersona, reason = 'manual_switch') {
    const handoff = {
      from: state.active_persona,
      to: newPersona,
      reason,
      timestamp: new Date().toISOString(),
      context_preserved: true
    };

    return {
      ...state,
      active_persona: newPersona,
      persona_coordination: {
        ...state.persona_coordination,
        handoffs: [
          ...(state.persona_coordination?.handoffs || []),
          handoff
        ],
        active_personas: [
          ...new Set([
            ...(state.persona_coordination?.active_personas || []),
            newPersona
          ])
        ]
      }
    };
  }

  /**
   * Add error to state
   */
  static addError(state, error) {
    const errorEntry = {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      step: error.step,
      recoverable: error.recoverable !== false
    };

    return {
      ...state,
      errors: [...state.errors, errorEntry]
    };
  }

  /**
   * Update execution metadata
   */
  static updateExecutionMetadata(state, metadata) {
    const currentMetadata = state.execution_metadata || {};
    const updatedMetadata = { ...currentMetadata, ...metadata };
    const validatedMetadata = ExecutionMetadataSchema.parse(updatedMetadata);
    
    return {
      ...state,
      execution_metadata: validatedMetadata
    };
  }

  /**
   * Set approval requirement
   */
  static setApprovalRequired(state, approvalContext) {
    const validatedContext = ApprovalContextSchema.parse(approvalContext);
    
    return {
      ...state,
      requires_approval: true,
      approval_context: validatedContext
    };
  }

  /**
   * Clear approval requirement
   */
  static clearApprovalRequired(state) {
    return {
      ...state,
      requires_approval: false,
      approval_context: undefined
    };
  }

  /**
   * Enable/disable feature
   */
  static setFeature(state, featureName, enabled) {
    return {
      ...state,
      features: {
        ...state.features,
        [featureName]: enabled
      }
    };
  }

  /**
   * Get state summary for logging
   */
  static getStateSummary(state) {
    return {
      messageCount: state.messages?.length || 0,
      activePersona: state.active_persona,
      vectorResultCount: state.vector_results?.length || 0,
      graphRelationshipCount: state.graph_relationships?.length || 0,
      requiresApproval: state.requires_approval,
      currentStep: state.workflow_context?.current_step,
      errorCount: state.errors?.length || 0,
      sessionId: state.session_id,
      features: Object.keys(state.features || {}).filter(key => state.features[key])
    };
  }

  /**
   * Clean state for serialization
   */
  static cleanForSerialization(state) {
    // Remove large or sensitive data before serialization
    const cleaned = { ...state };
    
    // Remove embeddings from vector results to reduce size
    if (cleaned.vector_results) {
      cleaned.vector_results = cleaned.vector_results.map(result => {
        const { embedding, ...rest } = result;
        return rest;
      });
    }
    
    // Remove stack traces from errors in production
    if (process.env.NODE_ENV === 'production' && cleaned.errors) {
      cleaned.errors = cleaned.errors.map(error => {
        const { stack, ...rest } = error;
        return rest;
      });
    }
    
    return cleaned;
  }
}

module.exports = {
  ZeroVectorStateSchema,
  ZeroVectorStateManager,
  MessageSchema,
  PersonaContextSchema,
  UserProfileSchema,
  VectorResultSchema,
  GraphRelationshipSchema,
  MemoryContextSchema,
  ExecutionMetadataSchema,
  ApprovalContextSchema,
  WorkflowContextSchema
};
