const { ZeroVectorStateManager } = require('../state/ZeroVectorState');
const { logger, logError } = require('../utils/logger');

/**
 * Persona Memory Agent
 * Advanced persona system with persistent memory and LangGraph integration
 * Implements persona-specific response generation from the LangGraph-DEV-HANDOFF.md
 */
class PersonaMemoryAgent {
  constructor(hybridMemoryManager, embeddingService, llmService, personaProfiles) {
    this.hybridMemoryManager = hybridMemoryManager;
    this.embeddingService = embeddingService;
    this.llmService = llmService;
    this.personaProfiles = personaProfiles || this.getDefaultPersonaProfiles();
    this.performanceMetrics = {
      totalGenerations: 0,
      averageResponseTime: 0,
      personaConsistencyScore: 0,
      memoryRetrievals: 0
    };
    
    logger.info('PersonaMemoryAgent initialized', {
      availablePersonas: Object.keys(this.personaProfiles),
      memoryManagerType: hybridMemoryManager.constructor.name,
      llmServiceType: llmService?.constructor.name || 'not provided'
    });
  }

  /**
   * Main agent execution function for LangGraph
   * Implements persona-aware response generation with memory integration
   */
  async __call__(state) {
    const startTime = Date.now();
    let memoriesRetrieved = 0;
    let personaConsistencyScore = 0;

    try {
      // Extract context from state
      const messages = state.messages || [];
      const query = messages[messages.length - 1]?.content;
      const personaId = state.active_persona;
      const userId = state.user_profile?.id;
      const vectorResults = state.vector_results || [];

      if (!query) {
        throw new Error('No query found in messages');
      }

      if (!personaId) {
        throw new Error('No active persona specified');
      }

      logger.debug('Starting persona memory processing', {
        query: query.substring(0, 100),
        personaId,
        userId,
        vectorResultCount: vectorResults.length,
        messageCount: messages.length
      });

      // Stage 1: Load or Create Persona Profile
      const personaProfile = await this.loadPersonaProfile(personaId, userId);
      if (!personaProfile) {
        throw new Error(`Persona profile not found: ${personaId}`);
      }

      // Stage 2: Retrieve Persona-Specific Memories
      const personaMemories = await this.retrievePersonaMemories(personaId, userId, query, {
        limit: 10,
        includeConversationHistory: true,
        includePersonalPreferences: true,
        maxAge: state.user_profile?.preferences?.maxMemoryAge
      });
      memoriesRetrieved = personaMemories.length;

      // Stage 3: Build Comprehensive Persona Context
      const personaContext = await this.buildPersonaContext(
        personaProfile,
        personaMemories,
        state.user_profile,
        {
          vectorResults,
          conversationHistory: messages.slice(-10), // Last 10 messages for context
          currentQuery: query
        }
      );

      // Stage 4: Generate Persona-Specific Response
      const response = await this.generatePersonaResponse({
        personaContext,
        query,
        conversationHistory: messages,
        vectorResults,
        userProfile: state.user_profile,
        options: {
          maxTokens: state.persona_context?.config?.maxResponseTokens || 1000,
          temperature: state.persona_context?.config?.temperature || 0.7,
          useMemoryContext: true,
          maintainPersonaConsistency: true
        }
      });

      // Stage 5: Calculate Persona Consistency Score
      personaConsistencyScore = await this.calculatePersonaConsistency(
        response,
        personaProfile,
        personaMemories
      );

      // Stage 6: Store New Memory
      const newMemory = await this.storeConversationMemory(
        personaId,
        userId,
        query,
        response,
        {
          vectorResults,
          personaConsistencyScore,
          memoryContext: state.memory_context
        }
      );

      // Stage 7: Update Performance Metrics
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics({
        processingTime,
        memoriesRetrieved,
        personaConsistencyScore
      });

      // Stage 8: Update State
      let updatedState = ZeroVectorStateManager.addMessage(state, {
        type: 'ai',
        content: response,
        additional_kwargs: {
          persona: personaId,
          consistency_score: personaConsistencyScore,
          memories_used: memoriesRetrieved,
          processing_time_ms: processingTime
        },
        response_metadata: {
          persona_profile: {
            id: personaProfile.id,
            name: personaProfile.name,
            role: personaProfile.role
          },
          memory_stats: {
            memories_retrieved: memoriesRetrieved,
            new_memory_id: newMemory?.id
          },
          generation_stats: {
            tokens_used: response.length, // Approximate
            consistency_score: personaConsistencyScore
          }
        }
      });

      // Update persona context
      updatedState = ZeroVectorStateManager.updatePersonaContext(updatedState, personaProfile);

      // Update workflow context
      updatedState = ZeroVectorStateManager.updateWorkflowContext(updatedState, {
        workflow_id: state.workflow_context?.workflow_id || `workflow_${Date.now()}`,
        workflow_type: 'persona_response_generation',
        current_step: 'persona_processing_complete',
        completed_steps: [...(state.workflow_context?.completed_steps || []), 'persona_memory_processing'],
        reasoning_path: [...(state.workflow_context?.reasoning_path || []), 
          `Generated ${response.length} char response with ${memoriesRetrieved} memories for persona ${personaId}`],
        decision_points: [...(state.workflow_context?.decision_points || []), {
          step: 'persona_selection',
          persona: personaId,
          consistency_score: personaConsistencyScore,
          timestamp: new Date().toISOString()
        }],
        branch_history: [...(state.workflow_context?.branch_history || []), 'persona_memory_agent'],
        interrupt_points: [],
        resumable: true
      });

      logger.info('Persona memory processing completed successfully', {
        personaId,
        userId,
        query: query.substring(0, 100),
        responseLength: response.length,
        memoriesRetrieved,
        personaConsistencyScore: personaConsistencyScore.toFixed(3),
        processingTimeMs: processingTime
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'personaMemoryAgent',
        personaId: state.active_persona,
        userId: state.user_profile?.id,
        query: messages[messages.length - 1]?.content?.substring(0, 100),
        processingTime: Date.now() - startTime
      });

      // Return state with error information
      const errorState = ZeroVectorStateManager.addError(state, {
        code: 'PERSONA_MEMORY_ERROR',
        message: error.message,
        step: 'persona_memory_processing',
        recoverable: true
      });

      return errorState;
    }
  }

  /**
   * Load persona profile with fallback to defaults
   */
  async loadPersonaProfile(personaId, userId) {
    try {
      // First try to load from database/memory manager
      if (this.hybridMemoryManager.database) {
        const storedPersona = await this.hybridMemoryManager.database.getPersonaById(personaId);
        if (storedPersona) {
          return {
            ...storedPersona,
            memory_namespace: `${userId}_${personaId}_memories`
          };
        }
      }

      // Fall back to default profiles
      const defaultProfile = this.personaProfiles[personaId];
      if (defaultProfile) {
        return {
          ...defaultProfile,
          memory_namespace: `${userId}_${personaId}_memories`
        };
      }

      // Create minimal default if none found
      return {
        id: personaId,
        name: personaId.charAt(0).toUpperCase() + personaId.slice(1),
        role: 'Assistant',
        personality: 'Helpful and knowledgeable',
        expertise: ['general assistance'],
        communication_style: 'Friendly and professional',
        memory_namespace: `${userId}_${personaId}_memories`,
        config: {
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          maxResponseTokens: 1000,
          temperature: 0.7
        }
      };

    } catch (error) {
      logger.warn('Failed to load persona profile, using default', {
        personaId,
        error: error.message
      });
      
      return {
        id: personaId,
        name: 'Default Assistant',
        role: 'Assistant',
        personality: 'Helpful and knowledgeable',
        expertise: ['general assistance'],
        communication_style: 'Friendly and professional',
        memory_namespace: `${userId}_${personaId}_memories`
      };
    }
  }

  /**
   * Retrieve persona-specific memories
   */
  async retrievePersonaMemories(personaId, userId, query, options = {}) {
    try {
      const {
        limit = 10,
        includeConversationHistory = true,
        includePersonalPreferences = true,
        maxAge
      } = options;

      // Use the hybrid memory manager's enhanced retrieval
      const memories = await this.hybridMemoryManager.retrieveRelevantMemories(
        personaId,
        query,
        {
          limit,
          threshold: 0.7,
          memoryTypes: includeConversationHistory ? null : ['fact', 'preference', 'insight'],
          maxAge,
          includeContext: true,
          useGraphExpansion: true,
          graphDepth: 2,
          graphWeight: 0.3
        }
      );

      // Filter and enhance memories
      const enhancedMemories = memories.map(memory => ({
        ...memory,
        relevanceScore: memory.similarity || 0,
        memoryAge: memory.metadata?.timestamp 
          ? Date.now() - new Date(memory.metadata.timestamp).getTime()
          : null,
        memoryType: memory.metadata?.memoryType || 'conversation'
      }));

      logger.debug('Retrieved persona memories', {
        personaId,
        query: query.substring(0, 50),
        memoryCount: enhancedMemories.length,
        avgRelevance: enhancedMemories.length > 0 
          ? (enhancedMemories.reduce((sum, m) => sum + m.relevanceScore, 0) / enhancedMemories.length).toFixed(3)
          : 0
      });

      return enhancedMemories;

    } catch (error) {
      logger.warn('Failed to retrieve persona memories', {
        personaId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Build comprehensive persona context
   */
  async buildPersonaContext(personaProfile, memories, userProfile, additionalContext = {}) {
    try {
      const {
        vectorResults = [],
        conversationHistory = [],
        currentQuery = ''
      } = additionalContext;

      // Organize memories by type
      const organizedMemories = {
        conversations: memories.filter(m => m.memoryType === 'conversation'),
        facts: memories.filter(m => m.memoryType === 'fact'),
        preferences: memories.filter(m => m.memoryType === 'preference'),
        insights: memories.filter(m => m.memoryType === 'insight')
      };

      // Extract user preferences from memories and profile
      const userPreferences = {
        ...userProfile.preferences,
        ...this.extractPreferencesFromMemories(organizedMemories.preferences)
      };

      // Create conversation summary
      const conversationSummary = this.summarizeConversation(conversationHistory);

      // Build context
      const context = {
        persona: {
          profile: personaProfile,
          consistency_guidelines: this.generateConsistencyGuidelines(personaProfile),
          response_style: this.generateResponseStyleGuide(personaProfile)
        },
        user: {
          profile: userProfile,
          preferences: userPreferences,
          interaction_history: this.summarizeUserInteractions(organizedMemories.conversations)
        },
        memory: {
          relevant_memories: organizedMemories,
          total_memories: memories.length,
          memory_summary: this.summarizeMemories(memories),
          graph_relationships: this.extractGraphRelationships(memories)
        },
        context: {
          current_query: currentQuery,
          conversation_summary: conversationSummary,
          vector_results: vectorResults.slice(0, 5), // Limit context size
          query_intent: this.analyzeQueryIntent(currentQuery),
          emotional_context: this.detectEmotionalContext(conversationHistory)
        },
        generation_guidelines: {
          maintain_persona_consistency: true,
          use_memory_context: true,
          respect_user_preferences: true,
          adapt_to_emotional_context: true,
          max_tokens: personaProfile.config?.maxResponseTokens || 1000,
          temperature: personaProfile.config?.temperature || 0.7
        }
      };

      logger.debug('Built persona context', {
        personaId: personaProfile.id,
        memoryCount: memories.length,
        conversationLength: conversationHistory.length,
        vectorResultCount: vectorResults.length,
        contextSize: JSON.stringify(context).length
      });

      return context;

    } catch (error) {
      logger.warn('Failed to build persona context', {
        personaId: personaProfile.id,
        error: error.message
      });
      
      // Return minimal context
      return {
        persona: { profile: personaProfile },
        user: { profile: userProfile },
        memory: { relevant_memories: {}, total_memories: 0 },
        context: { current_query: additionalContext.currentQuery || '' }
      };
    }
  }

  /**
   * Generate persona-specific response
   */
  async generatePersonaResponse(options) {
    try {
      const {
        personaContext,
        query,
        conversationHistory,
        vectorResults,
        userProfile,
        options: genOptions = {}
      } = options;

      // Build prompt with persona context
      const prompt = this.buildPersonaPrompt(personaContext, query, {
        conversationHistory,
        vectorResults,
        includeMemoryContext: genOptions.useMemoryContext !== false
      });

      // Generate response using LLM service
      let response;
      if (this.llmService) {
        response = await this.llmService.generateResponse(prompt, {
          maxTokens: genOptions.maxTokens || 1000,
          temperature: genOptions.temperature || 0.7,
          personaId: personaContext.persona.profile.id
        });
      } else {
        // Fallback: Create a structured response based on context
        response = this.generateFallbackResponse(personaContext, query);
      }

      // Post-process response for persona consistency
      const processedResponse = this.postProcessResponse(
        response,
        personaContext.persona.profile
      );

      logger.debug('Generated persona response', {
        personaId: personaContext.persona.profile.id,
        query: query.substring(0, 50),
        responseLength: processedResponse.length,
        memoryUsed: personaContext.memory.total_memories,
        hasLLMService: !!this.llmService
      });

      return processedResponse;

    } catch (error) {
      logger.warn('Failed to generate persona response', {
        error: error.message,
        personaId: options.personaContext?.persona?.profile?.id
      });
      
      // Return fallback response
      return this.generateFallbackResponse(
        options.personaContext,
        options.query
      );
    }
  }

  /**
   * Build persona-specific prompt
   */
  buildPersonaPrompt(personaContext, query, options = {}) {
    const {
      conversationHistory = [],
      vectorResults = [],
      includeMemoryContext = true
    } = options;

    const persona = personaContext.persona.profile;
    const memories = personaContext.memory.relevant_memories;

    let prompt = `You are ${persona.name}, a ${persona.role}.

Personality: ${persona.personality}
Expertise: ${persona.expertise.join(', ')}
Communication Style: ${persona.communication_style}

`;

    // Add memory context if available
    if (includeMemoryContext && memories && Object.keys(memories).length > 0) {
      prompt += `Relevant memories from our past interactions:
`;
      
      // Add conversation memories
      if (memories.conversations?.length > 0) {
        prompt += `Previous conversations:
${memories.conversations.slice(0, 3).map(m => `- ${m.content.substring(0, 100)}...`).join('\n')}

`;
      }

      // Add factual memories
      if (memories.facts?.length > 0) {
        prompt += `Important facts I should remember:
${memories.facts.slice(0, 3).map(m => `- ${m.content}`).join('\n')}

`;
      }

      // Add preferences
      if (memories.preferences?.length > 0) {
        prompt += `User preferences:
${memories.preferences.slice(0, 3).map(m => `- ${m.content}`).join('\n')}

`;
      }
    }

    // Add vector search results if available
    if (vectorResults.length > 0) {
      prompt += `Relevant information from knowledge base:
${vectorResults.slice(0, 3).map(r => `- ${r.content.substring(0, 100)}...`).join('\n')}

`;
    }

    // Add recent conversation context
    if (conversationHistory.length > 0) {
      prompt += `Recent conversation:
${conversationHistory.slice(-3).map(msg => 
        `${msg.type === 'human' ? 'User' : 'You'}: ${msg.content}`
      ).join('\n')}

`;
    }

    prompt += `Current question: ${query}

Please respond as ${persona.name}, maintaining your personality and communication style while using the relevant memories and information provided. Keep your response helpful, accurate, and consistent with our past interactions.`;

    return prompt;
  }

  /**
   * Generate fallback response when LLM service is not available
   */
  generateFallbackResponse(personaContext, query) {
    const persona = personaContext.persona.profile;
    const memories = personaContext.memory.relevant_memories || {};
    
    let response = `Hello! I'm ${persona.name}, your ${persona.role}. `;
    
    // Add persona-specific greeting
    if (persona.communication_style?.includes('friendly')) {
      response += "I'm here to help you with your question. ";
    } else if (persona.communication_style?.includes('professional')) {
      response += "I'll provide you with accurate information. ";
    }
    
    // Reference memories if available
    if (memories.conversations && memories.conversations.length > 0) {
      response += "Based on our previous conversations, ";
    }
    
    response += `Regarding your question about "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}", `;
    
    // Add expertise-based response
    if (persona.expertise.includes('general')) {
      response += "I'll do my best to provide helpful information. ";
    } else {
      response += `drawing from my expertise in ${persona.expertise.join(' and ')}, `;
    }
    
    response += "I'd be happy to help you with this. Could you provide any additional details that might help me give you a more specific answer?";
    
    return response;
  }

  /**
   * Post-process response for persona consistency
   */
  postProcessResponse(response, personaProfile) {
    let processed = response;
    
    // Ensure response maintains persona voice
    if (personaProfile.communication_style?.includes('formal') && 
        !processed.match(/\b(please|thank you|kindly)\b/i)) {
      processed = processed.replace(/\.$/, ', please let me know if you need further assistance.');
    }
    
    // Add persona signature if appropriate
    if (personaProfile.role && !processed.includes(personaProfile.name)) {
      // Could add subtle persona indicators
    }
    
    return processed;
  }

  /**
   * Calculate persona consistency score
   */
  async calculatePersonaConsistency(response, personaProfile, memories) {
    try {
      let score = 0.8; // Base score
      
      // Check for persona traits in response
      const responseText = response.toLowerCase();
      
      // Communication style consistency
      if (personaProfile.communication_style) {
        const style = personaProfile.communication_style.toLowerCase();
        if (style.includes('friendly') && responseText.match(/\b(hi|hello|thanks|great)\b/)) {
          score += 0.1;
        }
        if (style.includes('professional') && responseText.match(/\b(please|certainly|indeed)\b/)) {
          score += 0.1;
        }
        if (style.includes('casual') && responseText.match(/\b(hey|cool|awesome)\b/)) {
          score += 0.1;
        }
      }
      
      // Expertise relevance
      if (personaProfile.expertise) {
        const hasRelevantExpertise = personaProfile.expertise.some(expertise =>
          responseText.includes(expertise.toLowerCase())
        );
        if (hasRelevantExpertise) {
          score += 0.05;
        }
      }
      
      // Memory consistency (basic check)
      if (memories.length > 0) {
        // Could implement more sophisticated consistency checking
        score += 0.05;
      }
      
      return Math.min(score, 1.0); // Cap at 1.0
      
    } catch (error) {
      logger.warn('Failed to calculate persona consistency', { error: error.message });
      return 0.7; // Default score
    }
  }

  /**
   * Store new conversation memory
   */
  async storeConversationMemory(personaId, userId, query, response, context = {}) {
    try {
      const memoryContent = `User asked: "${query}"\nI responded: "${response}"`;
      
      const metadata = {
        type: 'conversation',
        personaId,
        userId,
        query,
        response,
        timestamp: Date.now(),
        consistencyScore: context.personaConsistencyScore || 0.8,
        vectorResultsUsed: context.vectorResults?.length || 0,
        processingContext: context.memoryContext
      };

      const result = await this.hybridMemoryManager.addMemory(
        personaId,
        memoryContent,
        metadata
      );

      logger.debug('Stored conversation memory', {
        personaId,
        userId,
        memoryId: result.id,
        contentLength: memoryContent.length
      });

      return result;

    } catch (error) {
      logger.warn('Failed to store conversation memory', {
        personaId,
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Helper methods for context building
   */
  extractPreferencesFromMemories(preferenceMemories) {
    const preferences = {};
    for (const memory of preferenceMemories) {
      // Simple preference extraction logic
      if (memory.content.includes('prefer')) {
        // Could implement more sophisticated preference parsing
        preferences.extracted = true;
      }
    }
    return preferences;
  }

  summarizeConversation(conversationHistory) {
    if (conversationHistory.length === 0) return '';
    
    const recentMessages = conversationHistory.slice(-5);
    return `Recent conversation with ${recentMessages.length} messages`;
  }

  summarizeUserInteractions(conversationMemories) {
    return {
      totalInteractions: conversationMemories.length,
      lastInteraction: conversationMemories[0]?.metadata?.timestamp || null,
      commonTopics: [] // Could implement topic extraction
    };
  }

  summarizeMemories(memories) {
    return {
      total: memories.length,
      byType: memories.reduce((acc, memory) => {
        const type = memory.memoryType || 'unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {})
    };
  }

  extractGraphRelationships(memories) {
    return memories
      .filter(m => m.graphExpanded || m.graphBoosted)
      .map(m => ({
        memoryId: m.id,
        relationshipType: m.relationshipType || 'RELATED_TO',
        expandedFrom: m.expandedFrom
      }));
  }

  analyzeQueryIntent(query) {
    const intentKeywords = {
      question: ['what', 'how', 'why', 'when', 'where', 'who'],
      request: ['please', 'can you', 'could you', 'would you'],
      command: ['do', 'make', 'create', 'show', 'tell']
    };

    const queryLower = query.toLowerCase();
    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      if (keywords.some(keyword => queryLower.includes(keyword))) {
        return intent;
      }
    }
    return 'unknown';
  }

  detectEmotionalContext(conversationHistory) {
    // Simple emotional context detection
    const recentMessages = conversationHistory.slice(-3);
    const text = recentMessages.map(m => m.content).join(' ').toLowerCase();
    
    if (text.match(/\b(excited|happy|great|awesome|love)\b/)) return 'positive';
    if (text.match(/\b(frustrated|annoyed|problem|issue|wrong)\b/)) return 'negative';
    if (text.match(/\b(help|please|thank|thanks)\b/)) return 'helpful';
    
    return 'neutral';
  }

  generateConsistencyGuidelines(personaProfile) {
    return {
      voice: personaProfile.communication_style || 'professional',
      expertise: personaProfile.expertise || [],
      personality_traits: personaProfile.personality?.split(', ') || []
    };
  }

  generateResponseStyleGuide(personaProfile) {
    return {
      tone: personaProfile.communication_style || 'professional',
      formality: personaProfile.communication_style?.includes('formal') ? 'formal' : 'casual',
      length: 'moderate',
      includeExpertise: true
    };
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(metrics) {
    this.performanceMetrics.totalGenerations++;
    
    const count = this.performanceMetrics.totalGenerations;
    
    // Update average response time
    this.performanceMetrics.averageResponseTime = 
      (this.performanceMetrics.averageResponseTime * (count - 1) + metrics.processingTime) / count;
    
    // Update average consistency score
    this.performanceMetrics.personaConsistencyScore = 
      (this.performanceMetrics.personaConsistencyScore * (count - 1) + metrics.personaConsistencyScore) / count;
    
    // Update memory retrieval count
    this.performanceMetrics.memoryRetrievals += metrics.memoriesRetrieved;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      ...this.performanceMetrics,
      avgMemoriesPerGeneration: this.performanceMetrics.totalGenerations > 0 
        ? this.performanceMetrics.memoryRetrievals / this.performanceMetrics.totalGenerations 
        : 0,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get default persona profiles
   */
  getDefaultPersonaProfiles() {
    return {
      helpful_assistant: {
        id: 'helpful_assistant',
        name: 'Alex',
        role: 'Helpful Assistant',
        personality: 'Friendly, knowledgeable, patient, encouraging',
        expertise: ['general knowledge', 'problem solving', 'research assistance'],
        communication_style: 'Warm and supportive, clear explanations',
        config: {
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          maxResponseTokens: 1000,
          temperature: 0.7
        }
      },
      technical_expert: {
        id: 'technical_expert',
        name: 'Taylor',
        role: 'Technical Expert',
        personality: 'Analytical, precise, detail-oriented, methodical',
        expertise: ['programming', 'system architecture', 'debugging', 'best practices'],
        communication_style: 'Technical but accessible, structured responses',
        config: {
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          maxResponseTokens: 1500,
          temperature: 0.5
        }
      },
      creative_mentor: {
        id: 'creative_mentor',
        name: 'Morgan',
        role: 'Creative Mentor',
        personality: 'Imaginative, inspiring, open-minded, encouraging',
        expertise: ['creative writing', 'brainstorming', 'design thinking', 'innovation'],
        communication_style: 'Inspiring and motivational, uses metaphors',
        config: {
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          maxResponseTokens: 1200,
          temperature: 0.8
        }
      }
    };
  }
}

module.exports = PersonaMemoryAgent;
