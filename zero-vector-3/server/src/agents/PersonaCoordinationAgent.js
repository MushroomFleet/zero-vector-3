const { logger, logError, logWorkflow, createTimer } = require('../utils/logger');
const { ZeroVectorStateManager } = require('../state/ZeroVectorState');

/**
 * PersonaCoordinationAgent - Phase 3 Cross-Persona Workflow Agent
 * 
 * Manages multi-persona interactions with sophisticated handoff logic,
 * context preservation, and collaborative response generation.
 * 
 * Features:
 * - Intelligent persona selection based on query analysis
 * - Seamless context transfer between personas
 * - Collaborative response generation
 * - Memory preservation across persona switches
 * - Dynamic workflow routing
 */
class PersonaCoordinationAgent {
  constructor(personaMemoryAgent, hybridRetrievalAgent, config = {}) {
    this.personaMemoryAgent = personaMemoryAgent;
    this.hybridRetrievalAgent = hybridRetrievalAgent;
    this.config = {
      maxPersonaSwitches: 3,
      contextPreservationEnabled: true,
      collaborativeResponseEnabled: true,
      intelligentRoutingEnabled: true,
      ...config
    };

    // Define persona capabilities and specializations
    this.personaCapabilities = {
      helpful_assistant: {
        specializations: ['general_knowledge', 'conversation', 'explanation', 'guidance'],
        triggers: ['help', 'explain', 'how to', 'what is', 'guide me', 'assist'],
        handoff_patterns: ['technical', 'complex', 'detailed implementation', 'advanced']
      },
      technical_expert: {
        specializations: ['programming', 'algorithms', 'system_design', 'debugging', 'architecture'],
        triggers: ['code', 'implement', 'algorithm', 'technical', 'programming', 'debug', 'optimize'],
        handoff_patterns: ['simple explanation', 'user-friendly', 'beginner', 'clarify']
      },
      creative_writer: {
        specializations: ['writing', 'storytelling', 'creative_content', 'editing'],
        triggers: ['write', 'story', 'creative', 'narrative', 'content', 'edit'],
        handoff_patterns: ['technical analysis', 'factual information', 'research']
      },
      research_analyst: {
        specializations: ['analysis', 'research', 'data_interpretation', 'insights'],
        triggers: ['analyze', 'research', 'data', 'trends', 'insights', 'compare'],
        handoff_patterns: ['creative presentation', 'implementation', 'user guidance']
      }
    };

    logger.info('PersonaCoordinationAgent initialized', {
      maxPersonaSwitches: this.config.maxPersonaSwitches,
      contextPreservationEnabled: this.config.contextPreservationEnabled,
      availablePersonas: Object.keys(this.personaCapabilities)
    });
  }

  /**
   * Main coordination entry point - analyze query and coordinate personas
   */
  async __call__(state) {
    const timer = createTimer('persona_coordination_agent', {
      activePersona: state.active_persona,
      userId: state.user_profile?.id,
      crossPersonaEnabled: true
    });

    try {
      logWorkflow(state.workflow_context?.workflow_id, 'persona_coordination_start', {
        activePersona: state.active_persona,
        userId: state.user_profile?.id,
        messageCount: state.messages?.length || 0
      });

      // Initialize cross-persona context if not present
      let updatedState = this.initializeCrossPersonaContext(state);

      // Analyze the query to determine if persona coordination is needed
      const coordinationAnalysis = await this.analyzeCoordinationNeeds(updatedState);
      
      if (coordinationAnalysis.needsCoordination) {
        logWorkflow(state.workflow_context?.workflow_id, 'coordination_needed', {
          reason: coordinationAnalysis.reason,
          suggestedPersonas: coordinationAnalysis.suggestedPersonas,
          coordinationType: coordinationAnalysis.type
        });

        // Execute coordinated persona workflow
        updatedState = await this.executeCoordinatedWorkflow(updatedState, coordinationAnalysis);
      } else {
        // Single persona processing with coordination context awareness
        logWorkflow(state.workflow_context?.workflow_id, 'single_persona_processing', {
          persona: state.active_persona,
          reason: coordinationAnalysis.reason
        });

        updatedState = await this.executeSinglePersonaWithContext(updatedState);
      }

      // Update execution metadata
      updatedState = ZeroVectorStateManager.updateExecutionMetadata(updatedState, {
        ...updatedState.execution_metadata,
        persona_coordination: {
          analysis: coordinationAnalysis,
          switches_performed: updatedState.persona_coordination?.handoffs?.length || 0,
          final_persona: updatedState.active_persona,
          collaboration_enabled: coordinationAnalysis.needsCoordination
        }
      });

      const perfData = timer.end({
        coordinationNeeded: coordinationAnalysis.needsCoordination,
        personaSwitches: updatedState.persona_coordination?.handoffs?.length || 0
      });

      logWorkflow(state.workflow_context?.workflow_id, 'persona_coordination_completed', {
        coordinationNeeded: coordinationAnalysis.needsCoordination,
        finalPersona: updatedState.active_persona,
        personaSwitches: updatedState.persona_coordination?.handoffs?.length || 0,
        duration: perfData.duration
      });

      return updatedState;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'PersonaCoordinationAgent.__call__',
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
   * Initialize cross-persona context in state
   */
  initializeCrossPersonaContext(state) {
    if (state.persona_coordination) {
      return state; // Already initialized
    }

    return {
      ...state,
      persona_coordination: {
        enabled: true,
        session_id: `coord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        handoffs: [],
        shared_context: {
          original_query: state.messages?.[state.messages.length - 1]?.content || '',
          user_intent: null,
          complexity_analysis: null,
          collaboration_history: []
        },
        active_personas: [state.active_persona],
        coordination_metadata: {
          started_at: new Date().toISOString(),
          coordination_type: 'single', // Will be updated if coordination is needed
          max_switches_allowed: this.config.maxPersonaSwitches
        }
      }
    };
  }

  /**
   * Analyze if the query needs persona coordination
   */
  async analyzeCoordinationNeeds(state) {
    const query = state.messages?.[state.messages.length - 1]?.content || '';
    const currentPersona = state.active_persona;
    
    // Analyze query complexity and domain requirements
    const queryAnalysis = this.analyzeQueryDomains(query);
    const currentCapabilities = this.personaCapabilities[currentPersona] || {};
    
    // Check if current persona can handle all required domains
    const canHandleAllDomains = queryAnalysis.requiredDomains.every(domain =>
      currentCapabilities.specializations.includes(domain)
    );

    // Check for explicit handoff triggers
    const hasHandoffTriggers = currentCapabilities.handoff_patterns?.some(pattern =>
      query.toLowerCase().includes(pattern.toLowerCase())
    );

    // Check for multi-domain complexity
    const isMultiDomain = queryAnalysis.requiredDomains.length > 1;

    // Determine if coordination is needed
    const needsCoordination = !canHandleAllDomains || hasHandoffTriggers || 
      (isMultiDomain && this.config.collaborativeResponseEnabled);

    if (needsCoordination) {
      // Suggest optimal persona sequence
      const suggestedPersonas = this.suggestPersonaSequence(queryAnalysis, currentPersona);
      
      return {
        needsCoordination: true,
        reason: !canHandleAllDomains ? 'capability_mismatch' : 
                hasHandoffTriggers ? 'explicit_handoff_trigger' : 'multi_domain_complexity',
        type: isMultiDomain ? 'collaborative' : 'handoff',
        requiredDomains: queryAnalysis.requiredDomains,
        suggestedPersonas,
        queryAnalysis
      };
    }

    return {
      needsCoordination: false,
      reason: 'single_persona_sufficient',
      type: 'single',
      queryAnalysis
    };
  }

  /**
   * Analyze query to determine required domains and complexity
   */
  analyzeQueryDomains(query) {
    const lowerQuery = query.toLowerCase();
    const domains = [];
    const keywords = [];

    // Technical domain detection
    const technicalKeywords = ['code', 'algorithm', 'programming', 'implement', 'debug', 'optimize', 'function', 'class', 'variable'];
    if (technicalKeywords.some(keyword => lowerQuery.includes(keyword))) {
      domains.push('programming');
      keywords.push(...technicalKeywords.filter(k => lowerQuery.includes(k)));
    }

    // Creative domain detection
    const creativeKeywords = ['write', 'story', 'creative', 'narrative', 'content', 'poem', 'article'];
    if (creativeKeywords.some(keyword => lowerQuery.includes(keyword))) {
      domains.push('writing');
      keywords.push(...creativeKeywords.filter(k => lowerQuery.includes(k)));
    }

    // Research domain detection
    const researchKeywords = ['analyze', 'research', 'data', 'trends', 'compare', 'study', 'findings'];
    if (researchKeywords.some(keyword => lowerQuery.includes(keyword))) {
      domains.push('analysis');
      keywords.push(...researchKeywords.filter(k => lowerQuery.includes(k)));
    }

    // General knowledge domain detection
    const generalKeywords = ['explain', 'help', 'what is', 'how to', 'guide', 'assist'];
    if (generalKeywords.some(keyword => lowerQuery.includes(keyword))) {
      domains.push('general_knowledge');
      keywords.push(...generalKeywords.filter(k => lowerQuery.includes(k)));
    }

    // Default to general knowledge if no specific domain detected
    if (domains.length === 0) {
      domains.push('general_knowledge');
    }

    return {
      requiredDomains: [...new Set(domains)], // Remove duplicates
      detectedKeywords: [...new Set(keywords)],
      complexity: this.assessQueryComplexity(query),
      length: query.length,
      questionMarks: (query.match(/\?/g) || []).length
    };
  }

  /**
   * Suggest optimal persona sequence for handling the query
   */
  suggestPersonaSequence(queryAnalysis, currentPersona) {
    const sequence = [currentPersona]; // Start with current persona
    const requiredDomains = queryAnalysis.requiredDomains;

    // Map domains to optimal personas
    const domainPersonaMap = {
      programming: 'technical_expert',
      system_design: 'technical_expert',
      algorithms: 'technical_expert',
      writing: 'creative_writer',
      storytelling: 'creative_writer',
      creative_content: 'creative_writer',
      analysis: 'research_analyst',
      research: 'research_analyst',
      data_interpretation: 'research_analyst',
      general_knowledge: 'helpful_assistant',
      conversation: 'helpful_assistant',
      explanation: 'helpful_assistant'
    };

    // Add personas for domains that current persona can't handle well
    const currentCapabilities = this.personaCapabilities[currentPersona]?.specializations || [];
    
    for (const domain of requiredDomains) {
      if (!currentCapabilities.includes(domain)) {
        const optimalPersona = domainPersonaMap[domain];
        if (optimalPersona && !sequence.includes(optimalPersona)) {
          sequence.push(optimalPersona);
        }
      }
    }

    // For complex multi-domain queries, add helpful_assistant at the end for synthesis
    if (sequence.length > 2 && !sequence.includes('helpful_assistant')) {
      sequence.push('helpful_assistant');
    }

    return sequence;
  }

  /**
   * Execute coordinated workflow with multiple personas
   */
  async executeCoordinatedWorkflow(state, coordinationAnalysis) {
    let currentState = { ...state };
    const personaSequence = coordinationAnalysis.suggestedPersonas;
    
    // Update coordination context
    currentState.persona_coordination.coordination_metadata.coordination_type = coordinationAnalysis.type;
    currentState.persona_coordination.shared_context.user_intent = coordinationAnalysis.queryAnalysis;

    if (coordinationAnalysis.type === 'collaborative') {
      return await this.executeCollaborativeWorkflow(currentState, personaSequence);
    } else {
      return await this.executeHandoffWorkflow(currentState, personaSequence);
    }
  }

  /**
   * Execute collaborative workflow where multiple personas contribute
   */
  async executeCollaborativeWorkflow(state, personaSequence) {
    let currentState = { ...state };
    const collaborativeResponses = [];
    
    logWorkflow(state.workflow_context?.workflow_id, 'collaborative_workflow_start', {
      personaSequence,
      originalPersona: state.active_persona
    });

    for (let i = 0; i < personaSequence.length && i < this.config.maxPersonaSwitches; i++) {
      const persona = personaSequence[i];
      
      if (persona === currentState.active_persona) continue; // Skip if already active

      // Switch to persona
      currentState = await this.switchToPersona(currentState, persona, `collaborative_step_${i + 1}`);
      
      // Execute persona with collaborative context
      const personaResponse = await this.executePersonaWithCollaborativeContext(currentState, i, personaSequence);
      
      if (personaResponse.messages && personaResponse.messages.length > 0) {
        collaborativeResponses.push({
          persona,
          response: personaResponse.messages[personaResponse.messages.length - 1],
          step: i + 1
        });
      }
      
      currentState = personaResponse;
    }

    // Synthesize collaborative responses
    if (collaborativeResponses.length > 1) {
      currentState = await this.synthesizeCollaborativeResponses(currentState, collaborativeResponses);
    }

    return currentState;
  }

  /**
   * Execute handoff workflow where personas hand off to each other
   */
  async executeHandoffWorkflow(state, personaSequence) {
    let currentState = { ...state };
    
    logWorkflow(state.workflow_context?.workflow_id, 'handoff_workflow_start', {
      personaSequence,
      originalPersona: state.active_persona
    });

    for (let i = 1; i < personaSequence.length && i < this.config.maxPersonaSwitches; i++) {
      const targetPersona = personaSequence[i];
      
      // Create handoff context
      const handoffReason = this.generateHandoffReason(currentState, targetPersona);
      
      // Add handoff message from current persona
      currentState = this.addHandoffMessage(currentState, targetPersona, handoffReason);
      
      // Switch to target persona
      currentState = await this.switchToPersona(currentState, targetPersona, `handoff_${i}`);
      
      // Execute target persona
      currentState = await this.personaMemoryAgent.__call__(currentState);
      
      // Check if further handoff is needed
      const needsFurtherHandoff = await this.checkForFurtherHandoff(currentState, personaSequence, i);
      if (!needsFurtherHandoff) {
        break;
      }
    }

    return currentState;
  }

  /**
   * Switch to a different persona with context preservation
   */
  async switchToPersona(state, targetPersona, reason) {
    const previousPersona = state.active_persona;
    
    // Record the handoff
    const handoff = {
      from: previousPersona,
      to: targetPersona,
      reason,
      timestamp: new Date().toISOString(),
      context_preserved: this.config.contextPreservationEnabled
    };

    const updatedState = {
      ...state,
      active_persona: targetPersona,
      persona_coordination: {
        ...state.persona_coordination,
        handoffs: [...(state.persona_coordination?.handoffs || []), handoff],
        active_personas: [...new Set([...(state.persona_coordination?.active_personas || []), targetPersona])]
      }
    };

    logWorkflow(state.workflow_context?.workflow_id, 'persona_switch', {
      from: previousPersona,
      to: targetPersona,
      reason,
      handoffCount: updatedState.persona_coordination.handoffs.length
    });

    return updatedState;
  }

  /**
   * Execute persona with collaborative context
   */
  async executePersonaWithCollaborativeContext(state, stepIndex, personaSequence) {
    // Add collaborative instruction to the context
    const collaborativeInstruction = this.generateCollaborativeInstruction(
      state.active_persona, 
      stepIndex, 
      personaSequence
    );

    // Create modified state with collaborative context
    const collaborativeState = {
      ...state,
      persona_coordination: {
        ...state.persona_coordination,
        shared_context: {
          ...state.persona_coordination.shared_context,
          collaborative_instruction: collaborativeInstruction,
          step_index: stepIndex,
          total_steps: personaSequence.length
        }
      }
    };

    return await this.personaMemoryAgent.__call__(collaborativeState);
  }

  /**
   * Execute single persona with coordination context awareness
   */
  async executeSinglePersonaWithContext(state) {
    // Add coordination awareness to the context
    const updatedState = {
      ...state,
      persona_coordination: {
        ...state.persona_coordination,
        coordination_metadata: {
          ...state.persona_coordination.coordination_metadata,
          coordination_type: 'single',
          coordination_available: true
        }
      }
    };

    return await this.personaMemoryAgent.__call__(updatedState);
  }

  /**
   * Add handoff message from current persona
   */
  addHandoffMessage(state, targetPersona, reason) {
    const handoffMessage = this.generateHandoffMessage(state.active_persona, targetPersona, reason);
    
    return ZeroVectorStateManager.addMessage(state, {
      type: 'ai',
      content: handoffMessage,
      additional_kwargs: {
        handoff: true,
        from_persona: state.active_persona,
        to_persona: targetPersona,
        handoff_reason: reason
      }
    });
  }

  /**
   * Generate handoff message
   */
  generateHandoffMessage(fromPersona, toPersona, reason) {
    const handoffTemplates = {
      'helpful_assistant_to_technical_expert': "I can see this requires technical expertise. Let me connect you with my technical colleague who can provide detailed implementation guidance.",
      'technical_expert_to_helpful_assistant': "I've provided the technical details. Let me hand this back to my colleague who can help explain this in more accessible terms.",
      'helpful_assistant_to_creative_writer': "This creative request would be better handled by my creative writing colleague. Let me connect you with them.",
      'creative_writer_to_research_analyst': "For the research and analysis aspects of this request, let me bring in my research colleague.",
      'research_analyst_to_helpful_assistant': "I've completed the analysis. Let me hand this back to my colleague for a comprehensive summary.",
      'default': `Based on your request, I'm connecting you with my ${toPersona.replace('_', ' ')} colleague who specializes in this area.`
    };

    const templateKey = `${fromPersona}_to_${toPersona}`;
    return handoffTemplates[templateKey] || handoffTemplates.default;
  }

  /**
   * Generate handoff reason
   */
  generateHandoffReason(state, targetPersona) {
    const query = state.messages?.[state.messages.length - 1]?.content || '';
    const targetCapabilities = this.personaCapabilities[targetPersona];
    
    if (!targetCapabilities) return 'specialized_assistance';

    // Find matching specialization
    const matchingSpecialization = targetCapabilities.specializations.find(spec =>
      targetCapabilities.triggers.some(trigger => 
        query.toLowerCase().includes(trigger.toLowerCase())
      )
    );

    return matchingSpecialization ? `${matchingSpecialization}_expertise_needed` : 'specialized_assistance';
  }

  /**
   * Check if further handoff is needed
   */
  async checkForFurtherHandoff(state, personaSequence, currentIndex) {
    // Simple logic: continue if we haven't reached the end of the sequence
    // and the current response doesn't seem complete
    const currentResponse = state.messages?.[state.messages.length - 1]?.content || '';
    const hasMorePersonas = currentIndex + 1 < personaSequence.length;
    
    // Check if current response indicates need for additional expertise
    const needsMoreExpertise = currentResponse.toLowerCase().includes('need') ||
                              currentResponse.toLowerCase().includes('require') ||
                              currentResponse.toLowerCase().includes('complex');
    
    return hasMorePersonas && needsMoreExpertise && 
           state.persona_coordination.handoffs.length < this.config.maxPersonaSwitches;
  }

  /**
   * Generate collaborative instruction for a persona
   */
  generateCollaborativeInstruction(persona, stepIndex, personaSequence) {
    const totalSteps = personaSequence.length;
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === totalSteps - 1;

    if (isFirst && isLast) {
      return "Please provide a comprehensive response addressing all aspects of the user's request.";
    } else if (isFirst) {
      return `You are the first of ${totalSteps} experts contributing to this response. Focus on your area of expertise, knowing that other specialists will build upon your contribution.`;
    } else if (isLast) {
      return "You are providing the final contribution to this collaborative response. Please synthesize the previous contributions and provide a cohesive conclusion.";
    } else {
      return `You are contributing as part of a ${totalSteps}-person expert team (step ${stepIndex + 1}). Build upon previous contributions while focusing on your specialized expertise.`;
    }
  }

  /**
   * Synthesize collaborative responses into a cohesive final response
   */
  async synthesizeCollaborativeResponses(state, collaborativeResponses) {
    // Create synthesis prompt
    const synthesisPrompt = this.createSynthesisPrompt(collaborativeResponses);
    
    // Switch to helpful_assistant for synthesis if not already active
    let synthesisState = state;
    if (state.active_persona !== 'helpful_assistant') {
      synthesisState = await this.switchToPersona(state, 'helpful_assistant', 'synthesis');
    }

    // Add synthesis instruction
    synthesisState = ZeroVectorStateManager.addMessage(synthesisState, {
      type: 'human',
      content: synthesisPrompt,
      additional_kwargs: {
        synthesis_request: true,
        collaborative_responses: collaborativeResponses.length
      }
    });

    // Execute synthesis
    const synthesizedState = await this.personaMemoryAgent.__call__(synthesisState);

    // Update coordination metadata
    synthesizedState.persona_coordination.shared_context.collaboration_history = collaborativeResponses;
    
    return synthesizedState;
  }

  /**
   * Create synthesis prompt from collaborative responses
   */
  createSynthesisPrompt(collaborativeResponses) {
    let prompt = "Please synthesize the following expert contributions into a comprehensive, cohesive response:\n\n";
    
    collaborativeResponses.forEach((response, index) => {
      prompt += `**${response.persona.replace('_', ' ').toUpperCase()} (Step ${response.step}):**\n`;
      prompt += `${response.response.content}\n\n`;
    });

    prompt += "Please provide a unified response that integrates all these perspectives while maintaining clarity and coherence.";
    
    return prompt;
  }

  /**
   * Assess query complexity
   */
  assessQueryComplexity(query) {
    const indicators = {
      length: query.length,
      sentences: query.split(/[.!?]/).length,
      questions: (query.match(/\?/g) || []).length,
      conjunctions: (query.match(/\b(and|or|but|however|therefore|because)\b/gi) || []).length,
      technical_terms: (query.match(/\b(algorithm|implementation|optimize|debug|analyze|data|system)\b/gi) || []).length
    };

    let score = 0;
    if (indicators.length > 150) score += 2;
    if (indicators.sentences > 3) score += 1;
    if (indicators.questions > 1) score += 1;
    if (indicators.conjunctions > 2) score += 2;
    if (indicators.technical_terms > 3) score += 2;

    return {
      score,
      level: score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low',
      indicators
    };
  }
}

module.exports = PersonaCoordinationAgent;
