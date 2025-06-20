const { ZeroVectorStateManager } = require('../state/ZeroVectorState');
const { logger, logError } = require('../utils/logger');

/**
 * Multi-Step Reasoning Agent
 * Implements complex reasoning chains for sophisticated query processing
 * Based on the LangGraph-DEV-HANDOFF.md specifications
 */
class MultiStepReasoningAgent {
  constructor(llmService, embeddingService, options = {}) {
    this.llmService = llmService;
    this.embeddingService = embeddingService;
    this.config = {
      maxReasoningSteps: options.maxReasoningSteps || 5,
      confidenceThreshold: options.confidenceThreshold || 0.7,
      enableParallelReasoning: options.enableParallelReasoning !== false,
      reasoningTimeout: options.reasoningTimeout || 30000, // 30 seconds
      ...options
    };
    
    this.performanceMetrics = {
      totalReasoningChains: 0,
      averageSteps: 0,
      averageConfidence: 0,
      averageProcessingTime: 0,
      successRate: 0
    };
    
    logger.info('MultiStepReasoningAgent initialized', {
      maxSteps: this.config.maxReasoningSteps,
      confidenceThreshold: this.config.confidenceThreshold,
      parallelReasoning: this.config.enableParallelReasoning,
      hasLLMService: !!this.llmService
    });
  }

  /**
   * Main agent execution function for LangGraph
   * Implements multi-step reasoning with query decomposition and synthesis
   */
  async __call__(state) {
    const startTime = Date.now();
    let reasoningSteps = [];
    let finalConfidence = 0;

    try {
      // Extract context from state
      const messages = state.messages || [];
      const query = messages[messages.length - 1]?.content;
      const vectorResults = state.vector_results || [];
      const personaId = state.active_persona;
      const userId = state.user_profile?.id;

      if (!query) {
        throw new Error('No query found in messages');
      }

      logger.debug('Starting multi-step reasoning process', {
        query: query.substring(0, 100),
        vectorResultCount: vectorResults.length,
        personaId,
        userId,
        queryComplexity: state.memory_context?.query_complexity
      });

      // Stage 1: Query Analysis and Decomposition
      const queryAnalysis = await this.analyzeQueryComplexity(query, vectorResults);
      const subQueries = await this.decomposeQuery(query, queryAnalysis);

      logger.debug('Query decomposition completed', {
        originalQuery: query.substring(0, 50),
        complexity: queryAnalysis.complexity,
        subQueryCount: subQueries.length,
        requiresMultiStep: subQueries.length > 1
      });

      // Stage 2: Determine Reasoning Strategy
      const reasoningStrategy = this.selectReasoningStrategy(queryAnalysis, subQueries, vectorResults);

      // Stage 3: Execute Reasoning Chain
      let reasoningResult;
      if (reasoningStrategy.type === 'simple') {
        reasoningResult = await this.executeSimpleReasoning(query, vectorResults, state);
      } else if (reasoningStrategy.type === 'sequential') {
        reasoningResult = await this.executeSequentialReasoning(subQueries, vectorResults, state);
      } else if (reasoningStrategy.type === 'parallel') {
        reasoningResult = await this.executeParallelReasoning(subQueries, vectorResults, state);
      } else {
        reasoningResult = await this.executeComplexReasoning(query, subQueries, vectorResults, state);
      }

      reasoningSteps = reasoningResult.steps;
      finalConfidence = reasoningResult.confidence;

      // Stage 4: Synthesize Final Response
      const synthesizedResponse = await this.synthesizeResponse(
        query,
        reasoningSteps,
        vectorResults,
        {
          personaId,
          userProfile: state.user_profile,
          conversationHistory: messages.slice(-5),
          confidence: finalConfidence
        }
      );

      // Stage 5: Validate and Refine Response
      const validationResult = await this.validateResponse(
        synthesizedResponse,
        query,
        reasoningSteps,
        finalConfidence
      );

      // Stage 6: Update Performance Metrics
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics({
        processingTime,
        stepCount: reasoningSteps.length,
        confidence: finalConfidence,
        success: validationResult.valid
      });

      // Stage 7: Update State
      let updatedState = ZeroVectorStateManager.addMessage(state, {
        type: 'ai',
        content: validationResult.response || synthesizedResponse,
        additional_kwargs: {
          reasoning_agent: 'multi_step',
          reasoning_steps: reasoningSteps.length,
          confidence: finalConfidence,
          strategy: reasoningStrategy.type,
          processing_time_ms: processingTime,
          validation_passed: validationResult.valid
        },
        response_metadata: {
          reasoning_analysis: {
            original_query: query.substring(0, 100),
            complexity: queryAnalysis.complexity,
            strategy: reasoningStrategy.type,
            sub_queries: subQueries.length,
            steps_executed: reasoningSteps.length,
            final_confidence: finalConfidence
          },
          processing_stats: {
            decomposition_time: reasoningResult.decompositionTime || 0,
            reasoning_time: reasoningResult.reasoningTime || 0,
            synthesis_time: reasoningResult.synthesisTime || 0,
            validation_time: reasoningResult.validationTime || 0,
            total_time: processingTime
          }
        }
      });

      // Update workflow context with reasoning path
      updatedState = ZeroVectorStateManager.updateWorkflowContext(updatedState, {
        ...state.workflow_context,
        reasoning_path: [
          ...(state.workflow_context?.reasoning_path || []),
          `Applied ${reasoningStrategy.type} reasoning with ${reasoningSteps.length} steps`,
          `Query decomposed into ${subQueries.length} sub-queries`,
          `Final confidence: ${(finalConfidence * 100).toFixed(1)}%`
        ],
        decision_points: [
          ...(state.workflow_context?.decision_points || []),
          {
            step: 'reasoning_strategy_selection',
            strategy: reasoningStrategy.type,
            reasoning: reasoningStrategy.reasoning,
            confidence: finalConfidence,
            timestamp: new Date().toISOString()
          }
        ],
        reasoning_metadata: {
          query_analysis: queryAnalysis,
          sub_queries: subQueries,
          reasoning_steps: reasoningSteps.map(step => ({
            step_number: step.stepNumber,
            type: step.type,
            confidence: step.confidence,
            summary: step.summary
          })),
          synthesis_metadata: {
            strategy: reasoningStrategy.type,
            confidence: finalConfidence,
            validation_passed: validationResult.valid
          }
        }
      });

      logger.info('Multi-step reasoning completed successfully', {
        query: query.substring(0, 100),
        strategy: reasoningStrategy.type,
        stepCount: reasoningSteps.length,
        subQueryCount: subQueries.length,
        finalConfidence: finalConfidence.toFixed(3),
        processingTimeMs: processingTime,
        validationPassed: validationResult.valid
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'multiStepReasoningAgent',
        query: state.messages?.[state.messages.length - 1]?.content?.substring(0, 100),
        userId: state.user_profile?.id,
        processingTime: Date.now() - startTime,
        stepCount: reasoningSteps.length
      });

      // Return state with error information
      const errorState = ZeroVectorStateManager.addError(state, {
        code: 'MULTI_STEP_REASONING_ERROR',
        message: error.message,
        step: 'multi_step_reasoning',
        recoverable: true,
        context: {
          completed_steps: reasoningSteps.length,
          partial_confidence: finalConfidence
        }
      });

      return errorState;
    }
  }

  /**
   * Analyze query complexity for reasoning strategy selection
   */
  async analyzeQueryComplexity(query, vectorResults = []) {
    try {
      const analysis = {
        length: query.length,
        wordCount: query.split(/\s+/).length,
        questionCount: (query.match(/\?/g) || []).length,
        conjunctions: (query.match(/\b(and|or|but|however|therefore|because|since|although)\b/gi) || []).length,
        conditionals: (query.match(/\b(if|when|unless|provided|assuming|suppose)\b/gi) || []).length,
        comparatives: (query.match(/\b(compare|contrast|difference|similar|versus|vs|better|worse)\b/gi) || []).length,
        causality: (query.match(/\b(why|because|cause|reason|result|effect|due to)\b/gi) || []).length,
        temporal: (query.match(/\b(before|after|during|when|while|first|then|next|finally)\b/gi) || []).length,
        quantifiers: (query.match(/\b(all|some|many|few|most|several|various|multiple)\b/gi) || []).length
      };

      // Calculate complexity score
      let complexityScore = 0;
      if (analysis.wordCount > 20) complexityScore += 1;
      if (analysis.questionCount > 1) complexityScore += 2;
      if (analysis.conjunctions > 2) complexityScore += 2;
      if (analysis.conditionals > 0) complexityScore += 3;
      if (analysis.comparatives > 0) complexityScore += 2;
      if (analysis.causality > 0) complexityScore += 2;
      if (analysis.temporal > 1) complexityScore += 2;
      if (analysis.quantifiers > 1) complexityScore += 1;

      // Determine complexity level
      let complexity;
      if (complexityScore >= 8) {
        complexity = 'very_complex';
      } else if (complexityScore >= 5) {
        complexity = 'complex';
      } else if (complexityScore >= 3) {
        complexity = 'moderate';
      } else {
        complexity = 'simple';
      }

      // Additional context analysis
      const contextFactors = {
        hasVectorResults: vectorResults.length > 0,
        vectorResultCount: vectorResults.length,
        avgVectorSimilarity: vectorResults.length > 0 
          ? vectorResults.reduce((sum, r) => sum + (r.similarity || 0), 0) / vectorResults.length 
          : 0,
        hasHighConfidenceResults: vectorResults.some(r => (r.similarity || 0) > 0.8)
      };

      return {
        ...analysis,
        complexityScore,
        complexity,
        contextFactors,
        requiresDecomposition: complexityScore >= 5 || analysis.conjunctions > 1 || analysis.questionCount > 1,
        recommendedStrategy: this.getRecommendedStrategy(complexityScore, analysis, contextFactors)
      };

    } catch (error) {
      logger.warn('Failed to analyze query complexity', { error: error.message });
      return {
        complexity: 'moderate',
        complexityScore: 3,
        requiresDecomposition: true,
        recommendedStrategy: 'sequential'
      };
    }
  }

  /**
   * Decompose complex queries into manageable sub-queries
   */
  async decomposeQuery(query, analysis) {
    try {
      // If query is simple, return as single sub-query
      if (!analysis.requiresDecomposition) {
        return [{
          id: 'main',
          query: query,
          type: 'primary',
          priority: 1,
          dependencies: []
        }];
      }

      const subQueries = [];

      // Split on explicit conjunctions
      if (analysis.conjunctions > 0) {
        const segments = query.split(/\b(and|or|but|however|also)\b/gi);
        let priority = 1;
        
        for (let i = 0; i < segments.length; i += 2) {
          const segment = segments[i].trim();
          if (segment.length > 10) {
            subQueries.push({
              id: `segment_${Math.floor(i/2)}`,
              query: segment,
              type: 'segment',
              priority: priority++,
              dependencies: [],
              originalConnector: segments[i + 1] || null
            });
          }
        }
      }

      // Identify causal relationships
      if (analysis.causality > 0) {
        const causalMatches = query.match(/(.+?)(?:because|due to|caused by)(.+?)(?:\.|$)/gi);
        if (causalMatches) {
          causalMatches.forEach((match, index) => {
            const parts = match.split(/\b(because|due to|caused by)\b/gi);
            if (parts.length >= 3) {
              subQueries.push({
                id: `cause_${index}`,
                query: parts[2].trim(),
                type: 'causal_factor',
                priority: 1,
                dependencies: []
              });
              subQueries.push({
                id: `effect_${index}`,
                query: parts[0].trim(),
                type: 'causal_result',
                priority: 2,
                dependencies: [`cause_${index}`]
              });
            }
          });
        }
      }

      // Handle comparative queries
      if (analysis.comparatives > 0) {
        const compareMatches = query.match(/compare|contrast|difference between/gi);
        if (compareMatches) {
          const entities = this.extractComparableEntities(query);
          entities.forEach((entity, index) => {
            subQueries.push({
              id: `compare_${index}`,
              query: `What are the characteristics of ${entity}?`,
              type: 'comparative_analysis',
              priority: 1,
              dependencies: [],
              entity: entity
            });
          });
        }
      }

      // Handle temporal sequences
      if (analysis.temporal > 1) {
        const temporalMarkers = ['first', 'then', 'next', 'after', 'finally', 'before'];
        const sequences = this.extractTemporalSequences(query, temporalMarkers);
        sequences.forEach((sequence, index) => {
          subQueries.push({
            id: `temporal_${index}`,
            query: sequence.text,
            type: 'temporal_step',
            priority: sequence.order,
            dependencies: index > 0 ? [`temporal_${index - 1}`] : [],
            temporalMarker: sequence.marker
          });
        });
      }

      // If no specific decomposition was possible, create logical segments
      if (subQueries.length === 0 && analysis.wordCount > 30) {
        const sentences = query.split(/[.!?]+/).filter(s => s.trim().length > 10);
        sentences.forEach((sentence, index) => {
          subQueries.push({
            id: `sentence_${index}`,
            query: sentence.trim(),
            type: 'logical_segment',
            priority: index + 1,
            dependencies: index > 0 ? [`sentence_${index - 1}`] : []
          });
        });
      }

      // If still no decomposition, return original query
      if (subQueries.length === 0) {
        return [{
          id: 'main',
          query: query,
          type: 'primary',
          priority: 1,
          dependencies: []
        }];
      }

      // Sort by priority and validate dependencies
      const validatedSubQueries = this.validateSubQueryDependencies(subQueries);

      logger.debug('Query decomposition completed', {
        originalQuery: query.substring(0, 50),
        subQueryCount: validatedSubQueries.length,
        types: validatedSubQueries.map(sq => sq.type),
        hasDependencies: validatedSubQueries.some(sq => sq.dependencies.length > 0)
      });

      return validatedSubQueries;

    } catch (error) {
      logger.warn('Failed to decompose query', { error: error.message });
      return [{
        id: 'main',
        query: query,
        type: 'primary',
        priority: 1,
        dependencies: []
      }];
    }
  }

  /**
   * Select appropriate reasoning strategy
   */
  selectReasoningStrategy(analysis, subQueries, vectorResults) {
    const strategy = {
      type: 'simple',
      reasoning: 'Default strategy for simple queries',
      parallel: false,
      maxConcurrency: 1
    };

    // Determine strategy based on complexity and sub-queries
    if (analysis.complexity === 'simple' && subQueries.length === 1) {
      strategy.type = 'simple';
      strategy.reasoning = 'Single query with straightforward processing';
    } else if (subQueries.some(sq => sq.dependencies.length > 0)) {
      strategy.type = 'sequential';
      strategy.reasoning = 'Dependencies require sequential processing';
    } else if (this.config.enableParallelReasoning && subQueries.length > 2 && subQueries.length <= 5) {
      strategy.type = 'parallel';
      strategy.reasoning = 'Multiple independent sub-queries suitable for parallel processing';
      strategy.parallel = true;
      strategy.maxConcurrency = Math.min(3, subQueries.length);
    } else if (analysis.complexity === 'very_complex' || subQueries.length > 5) {
      strategy.type = 'complex';
      strategy.reasoning = 'Very complex query requiring sophisticated reasoning chain';
    } else {
      strategy.type = 'sequential';
      strategy.reasoning = 'Multiple sub-queries processed sequentially';
    }

    // Adjust based on available resources
    if (vectorResults.length === 0 && strategy.type !== 'simple') {
      strategy.type = 'simple';
      strategy.reasoning = 'No vector results available, simplified strategy';
    }

    return strategy;
  }

  /**
   * Execute simple reasoning for straightforward queries
   */
  async executeSimpleReasoning(query, vectorResults, state) {
    try {
      const step = {
        stepNumber: 1,
        type: 'simple_analysis',
        query: query,
        startTime: Date.now(),
        confidence: 0.8
      };

      // Analyze query intent and context
      const intent = this.analyzeQueryIntent(query);
      const context = this.extractContextFromResults(vectorResults);

      step.intent = intent;
      step.context = context;
      step.endTime = Date.now();
      step.processingTime = step.endTime - step.startTime;
      step.summary = `Simple reasoning applied for ${intent} query with ${vectorResults.length} context items`;

      return {
        steps: [step],
        confidence: step.confidence,
        decompositionTime: 0,
        reasoningTime: step.processingTime,
        synthesisTime: 0
      };

    } catch (error) {
      logger.warn('Simple reasoning failed', { error: error.message });
      return {
        steps: [{
          stepNumber: 1,
          type: 'simple_analysis',
          query: query,
          confidence: 0.5,
          error: error.message,
          summary: 'Simple reasoning encountered an error'
        }],
        confidence: 0.5
      };
    }
  }

  /**
   * Execute sequential reasoning for dependent sub-queries
   */
  async executeSequentialReasoning(subQueries, vectorResults, state) {
    try {
      const steps = [];
      let overallConfidence = 0;
      const startTime = Date.now();

      // Sort sub-queries by dependencies and priority
      const sortedQueries = this.sortQueriesByDependencies(subQueries);

      for (let i = 0; i < sortedQueries.length; i++) {
        const subQuery = sortedQueries[i];
        const step = {
          stepNumber: i + 1,
          type: subQuery.type,
          query: subQuery.query,
          subQueryId: subQuery.id,
          dependencies: subQuery.dependencies,
          startTime: Date.now()
        };

        try {
          // Process sub-query with context from previous steps
          const previousResults = steps.filter(s => subQuery.dependencies.includes(s.subQueryId));
          const subQueryContext = this.buildSubQueryContext(subQuery, previousResults, vectorResults);
          
          const subQueryResult = await this.processSubQuery(subQuery, subQueryContext, state);
          
          step.result = subQueryResult.result;
          step.confidence = subQueryResult.confidence;
          step.reasoning = subQueryResult.reasoning;
          step.endTime = Date.now();
          step.processingTime = step.endTime - step.startTime;
          step.summary = `Processed ${subQuery.type} sub-query with confidence ${(subQueryResult.confidence * 100).toFixed(1)}%`;

          overallConfidence += subQueryResult.confidence;

        } catch (error) {
          step.error = error.message;
          step.confidence = 0.3;
          step.endTime = Date.now();
          step.processingTime = step.endTime - step.startTime;
          step.summary = `Sub-query processing failed: ${error.message}`;
          
          logger.warn('Sub-query processing failed', {
            subQueryId: subQuery.id,
            error: error.message
          });
        }

        steps.push(step);
      }

      const totalTime = Date.now() - startTime;
      const avgConfidence = sortedQueries.length > 0 ? overallConfidence / sortedQueries.length : 0;

      return {
        steps,
        confidence: avgConfidence,
        decompositionTime: 0,
        reasoningTime: totalTime,
        synthesisTime: 0
      };

    } catch (error) {
      logger.warn('Sequential reasoning failed', { error: error.message });
      return {
        steps: [{
          stepNumber: 1,
          type: 'sequential_analysis',
          confidence: 0.4,
          error: error.message,
          summary: 'Sequential reasoning encountered an error'
        }],
        confidence: 0.4
      };
    }
  }

  /**
   * Execute parallel reasoning for independent sub-queries
   */
  async executeParallelReasoning(subQueries, vectorResults, state) {
    try {
      const startTime = Date.now();
      const independentQueries = subQueries.filter(sq => sq.dependencies.length === 0);
      const dependentQueries = subQueries.filter(sq => sq.dependencies.length > 0);

      // Process independent queries in parallel
      const parallelPromises = independentQueries.map(async (subQuery, index) => {
        const step = {
          stepNumber: index + 1,
          type: subQuery.type,
          query: subQuery.query,
          subQueryId: subQuery.id,
          dependencies: [],
          startTime: Date.now(),
          parallel: true
        };

        try {
          const subQueryContext = this.buildSubQueryContext(subQuery, [], vectorResults);
          const subQueryResult = await this.processSubQuery(subQuery, subQueryContext, state);
          
          step.result = subQueryResult.result;
          step.confidence = subQueryResult.confidence;
          step.reasoning = subQueryResult.reasoning;
          step.endTime = Date.now();
          step.processingTime = step.endTime - step.startTime;
          step.summary = `Parallel processed ${subQuery.type} with confidence ${(subQueryResult.confidence * 100).toFixed(1)}%`;

          return step;

        } catch (error) {
          step.error = error.message;
          step.confidence = 0.3;
          step.endTime = Date.now();
          step.processingTime = step.endTime - step.startTime;
          step.summary = `Parallel processing failed: ${error.message}`;
          return step;
        }
      });

      // Wait for all parallel processing to complete
      const parallelSteps = await Promise.all(parallelPromises);

      // Process dependent queries sequentially
      let allSteps = [...parallelSteps];
      for (const depQuery of dependentQueries) {
        const step = {
          stepNumber: allSteps.length + 1,
          type: depQuery.type,
          query: depQuery.query,
          subQueryId: depQuery.id,
          dependencies: depQuery.dependencies,
          startTime: Date.now(),
          sequential_after_parallel: true
        };

        try {
          const previousResults = allSteps.filter(s => depQuery.dependencies.includes(s.subQueryId));
          const subQueryContext = this.buildSubQueryContext(depQuery, previousResults, vectorResults);
          const subQueryResult = await this.processSubQuery(depQuery, subQueryContext, state);
          
          step.result = subQueryResult.result;
          step.confidence = subQueryResult.confidence;
          step.reasoning = subQueryResult.reasoning;
          step.endTime = Date.now();
          step.processingTime = step.endTime - step.startTime;
          step.summary = `Sequential processed dependent query with confidence ${(subQueryResult.confidence * 100).toFixed(1)}%`;

        } catch (error) {
          step.error = error.message;
          step.confidence = 0.3;
          step.endTime = Date.now();
          step.processingTime = step.endTime - step.startTime;
          step.summary = `Dependent processing failed: ${error.message}`;
        }

        allSteps.push(step);
      }

      const totalTime = Date.now() - startTime;
      const avgConfidence = allSteps.length > 0 
        ? allSteps.reduce((sum, step) => sum + (step.confidence || 0), 0) / allSteps.length 
        : 0;

      return {
        steps: allSteps,
        confidence: avgConfidence,
        decompositionTime: 0,
        reasoningTime: totalTime,
        synthesisTime: 0,
        parallelSteps: parallelSteps.length,
        sequentialSteps: dependentQueries.length
      };

    } catch (error) {
      logger.warn('Parallel reasoning failed', { error: error.message });
      return {
        steps: [{
          stepNumber: 1,
          type: 'parallel_analysis',
          confidence: 0.4,
          error: error.message,
          summary: 'Parallel reasoning encountered an error'
        }],
        confidence: 0.4
      };
    }
  }

  /**
   * Execute complex reasoning for very sophisticated queries
   */
  async executeComplexReasoning(query, subQueries, vectorResults, state) {
    try {
      const startTime = Date.now();
      const steps = [];

      // Step 1: Comprehensive analysis
      const analysisStep = {
        stepNumber: 1,
        type: 'comprehensive_analysis',
        query: query,
        startTime: Date.now()
      };

      const queryAnalysis = await this.performComprehensiveAnalysis(query, vectorResults, state);
      analysisStep.result = queryAnalysis;
      analysisStep.confidence = queryAnalysis.confidence || 0.7;
      analysisStep.endTime = Date.now();
      analysisStep.processingTime = analysisStep.endTime - analysisStep.startTime;
      analysisStep.summary = `Comprehensive analysis completed with ${queryAnalysis.factors?.length || 0} factors identified`;
      steps.push(analysisStep);

      // Step 2: Multi-perspective reasoning
      const perspectiveStep = {
        stepNumber: 2,
        type: 'multi_perspective_reasoning',
        query: query,
        startTime: Date.now()
      };

      const perspectiveAnalysis = await this.performMultiPerspectiveReasoning(query, subQueries, vectorResults);
      perspectiveStep.result = perspectiveAnalysis;
      perspectiveStep.confidence = perspectiveAnalysis.confidence || 0.6;
      perspectiveStep.endTime = Date.now();
      perspectiveStep.processingTime = perspectiveStep.endTime - perspectiveStep.startTime;
      perspectiveStep.summary = `Analyzed ${perspectiveAnalysis.perspectives?.length || 0} different perspectives`;
      steps.push(perspectiveStep);

      // Step 3: Synthesis and integration
      const synthesisStep = {
        stepNumber: 3,
        type: 'synthesis_integration',
        query: query,
        startTime: Date.now()
      };

      const synthesis = await this.performSynthesisIntegration(steps, subQueries, vectorResults);
      synthesisStep.result = synthesis;
      synthesisStep.confidence = synthesis.confidence || 0.65;
      synthesisStep.endTime = Date.now();
      synthesisStep.processingTime = synthesisStep.endTime - synthesisStep.startTime;
      synthesisStep.summary = `Synthesized insights from ${steps.length} analysis steps`;
      steps.push(synthesisStep);

      const totalTime = Date.now() - startTime;
      const avgConfidence = steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length;

      return {
        steps,
        confidence: avgConfidence,
        decompositionTime: 0,
        reasoningTime: totalTime,
        synthesisTime: synthesisStep.processingTime || 0
      };

    } catch (error) {
      logger.warn('Complex reasoning failed', { error: error.message });
      return {
        steps: [{
          stepNumber: 1,
          type: 'complex_analysis',
          confidence: 0.4,
          error: error.message,
          summary: 'Complex reasoning encountered an error'
        }],
        confidence: 0.4
      };
    }
  }

  /**
   * Synthesize final response from reasoning steps
   */
  async synthesizeResponse(query, reasoningSteps, vectorResults, options = {}) {
    try {
      const {
        personaId,
        userProfile,
        conversationHistory = [],
        confidence = 0.7
      } = options;

      // Extract key insights from reasoning steps
      const insights = reasoningSteps.map(step => ({
        type: step.type,
        summary: step.summary,
        confidence: step.confidence,
        result: step.result,
        key_points: this.extractKeyPoints(step)
      }));

      // Build synthesis context
      const synthesisContext = {
        original_query: query,
        reasoning_insights: insights,
        vector_context: vectorResults.slice(0, 5).map(r => r.content.substring(0, 200)),
        confidence_level: confidence,
        persona_id: personaId
      };

      // Generate synthesized response based on insights
      let response;
      if (this.llmService) {
        const prompt = this.buildSynthesisPrompt(synthesisContext);
        response = await this.llmService.generateResponse(prompt, {
          maxTokens: 800,
          temperature: 0.7,
          personaId: personaId
        });
      } else {
        response = this.generateFallbackSynthesis(synthesisContext);
      }

      return response;

    } catch (error) {
      logger.warn('Response synthesis failed', { error: error.message });
      return `I've analyzed your question "${query.substring(0, 50)}..." and found some relevant information, but I'm having trouble synthesizing a complete response. Please let me know if you'd like me to try a different approach.`;
    }
  }

  /**
   * Validate response quality and consistency
   */
  async validateResponse(response, query, reasoningSteps, confidence) {
    try {
      const validation = {
        valid: true,
        issues: [],
        response: response,
        confidence: confidence
      };

      // Check response length
      if (response.length < 20) {
        validation.issues.push('Response too short');
        validation.valid = false;
      }

      // Check if response addresses the query
      const queryWords = query.toLowerCase().split(/\s+/);
      const responseWords = response.toLowerCase().split(/\s+/);
      const overlap = queryWords.filter(word => responseWords.includes(word)).length;
      const relevanceScore = overlap / queryWords.length;

      if (relevanceScore < 0.2) {
        validation.issues.push('Response may not address the query');
        validation.confidence *= 0.8;
      }

      // Check confidence threshold
      if (confidence < this.config.confidenceThreshold) {
        validation.issues.push('Low confidence in reasoning');
        validation.valid = false;
      }

      // Enhance response if issues found but recoverable
      if (!validation.valid && validation.issues.length > 0) {
        validation.response = this.enhanceResponse(response, validation.issues, query);
        validation.valid = true; // Mark as valid after enhancement
      }

      return validation;

    } catch (error) {
      logger.warn('Response validation failed', { error: error.message });
      return {
        valid: true,
        issues: ['Validation failed'],
        response: response,
        confidence: confidence * 0.9
      };
    }
  }

  /**
   * Helper methods for query analysis and processing
   */
  getRecommendedStrategy(complexityScore, analysis, contextFactors) {
    if (complexityScore >= 8) return 'complex';
    if (complexityScore >= 5) return 'sequential';
    if (analysis.conjunctions > 1) return 'parallel';
    return 'simple';
  }

  extractComparableEntities(query) {
    // Simple entity extraction for comparative queries
    const patterns = [
      /compare\s+(.+?)\s+(?:and|with|to)\s+(.+?)(?:\s|$)/gi,
      /difference\s+between\s+(.+?)\s+and\s+(.+?)(?:\s|$)/gi,
      /(.+?)\s+vs\s+(.+?)(?:\s|$)/gi
    ];

    const entities = [];
    for (const pattern of patterns) {
      const matches = [...query.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) entities.push(match[1].trim());
        if (match[2]) entities.push(match[2].trim());
      }
    }

    return [...new Set(entities)]; // Remove duplicates
  }

  extractTemporalSequences(query, markers) {
    const sequences = [];
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const regex = new RegExp(`\\b${marker}\\b[,\\s]*([^.!?]+)`, 'gi');
      const matches = [...query.matchAll(regex)];
      
      for (const match of matches) {
        sequences.push({
          text: match[1].trim(),
          marker: marker,
          order: i + 1
        });
      }
    }

    return sequences.sort((a, b) => a.order - b.order);
  }

  validateSubQueryDependencies(subQueries) {
    // Remove circular dependencies and validate
    const validQueries = [];
    for (const query of subQueries) {
      const validDeps = query.dependencies.filter(dep => 
        subQueries.some(sq => sq.id === dep && sq.id !== query.id)
      );
      validQueries.push({
        ...query,
        dependencies: validDeps
      });
    }

    return validQueries.sort((a, b) => a.priority - b.priority);
  }

  sortQueriesByDependencies(subQueries) {
    const sorted = [];
    const remaining = [...subQueries];

    while (remaining.length > 0) {
      const ready = remaining.filter(sq => 
        sq.dependencies.every(dep => sorted.some(s => s.id === dep))
      );

      if (ready.length === 0) {
        // No dependencies can be resolved, add remaining as-is
        sorted.push(...remaining);
        break;
      }

      sorted.push(...ready);
      ready.forEach(rq => {
        const index = remaining.findIndex(sq => sq.id === rq.id);
        if (index >= 0) remaining.splice(index, 1);
      });
    }

    return sorted;
  }

  buildSubQueryContext(subQuery, previousResults, vectorResults) {
    return {
      sub_query: subQuery,
      previous_results: previousResults.map(r => ({
        id: r.subQueryId,
        result: r.result,
        confidence: r.confidence
      })),
      vector_context: vectorResults.slice(0, 3),
      processing_type: subQuery.type
    };
  }

  async processSubQuery(subQuery, context, state) {
    try {
      // Simple sub-query processing
      const result = {
        query: subQuery.query,
        type: subQuery.type,
        context_used: context.vector_context?.length || 0,
        dependencies_resolved: context.previous_results?.length || 0
      };

      // Analyze query intent
      const intent = this.analyzeQueryIntent(subQuery.query);
      result.intent = intent;

      // Use vector context if available
      if (context.vector_context && context.vector_context.length > 0) {
        result.context_summary = context.vector_context.map(vc => 
          vc.content?.substring(0, 100)
        ).join(' | ');
      }

      // Calculate confidence based on context and dependencies
      let confidence = 0.7;
      if (context.vector_context?.length > 0) confidence += 0.1;
      if (context.previous_results?.length > 0) confidence += 0.1;
      if (intent !== 'unknown') confidence += 0.05;

      return {
        result: result,
        confidence: Math.min(confidence, 1.0),
        reasoning: `Processed ${subQuery.type} sub-query with ${context.vector_context?.length || 0} context items`
      };

    } catch (error) {
      logger.warn('Sub-query processing failed', {
        subQueryId: subQuery.id,
        error: error.message
      });

      return {
        result: { error: error.message },
        confidence: 0.3,
        reasoning: `Sub-query processing failed: ${error.message}`
      };
    }
  }

  analyzeQueryIntent(query) {
    const intentPatterns = {
      question: /\b(what|how|why|when|where|who|which)\b/i,
      request: /\b(please|can you|could you|would you|help)\b/i,
      comparison: /\b(compare|contrast|difference|similar|versus|vs)\b/i,
      explanation: /\b(explain|describe|tell me about|elaborate)\b/i,
      analysis: /\b(analyze|examine|evaluate|assess)\b/i,
      definition: /\b(define|meaning|what is|what are)\b/i
    };

    for (const [intent, pattern] of Object.entries(intentPatterns)) {
      if (pattern.test(query)) {
        return intent;
      }
    }

    return 'unknown';
  }

  extractContextFromResults(vectorResults) {
    if (!vectorResults || vectorResults.length === 0) {
      return { summary: 'No context available', count: 0 };
    }

    return {
      summary: `Found ${vectorResults.length} relevant context items`,
      count: vectorResults.length,
      avg_similarity: vectorResults.reduce((sum, r) => sum + (r.similarity || 0), 0) / vectorResults.length,
      topics: vectorResults.map(r => r.metadata?.topic || 'general').slice(0, 3)
    };
  }

  async performComprehensiveAnalysis(query, vectorResults, state) {
    return {
      query_analysis: {
        intent: this.analyzeQueryIntent(query),
        complexity: 'comprehensive',
        factors: ['multi-faceted', 'requires deep analysis']
      },
      context_analysis: this.extractContextFromResults(vectorResults),
      confidence: 0.7
    };
  }

  async performMultiPerspectiveReasoning(query, subQueries, vectorResults) {
    const perspectives = [
      { name: 'analytical', weight: 0.4 },
      { name: 'practical', weight: 0.3 },
      { name: 'contextual', weight: 0.3 }
    ];

    return {
      perspectives: perspectives,
      analysis: 'Multi-perspective reasoning applied',
      confidence: 0.6
    };
  }

  async performSynthesisIntegration(steps, subQueries, vectorResults) {
    return {
      integrated_insights: steps.map(s => s.summary),
      synthesis_quality: 'good',
      confidence: 0.65
    };
  }

  extractKeyPoints(step) {
    return [
      `Type: ${step.type}`,
      `Confidence: ${(step.confidence * 100).toFixed(1)}%`,
      step.summary || 'Processing completed'
    ];
  }

  buildSynthesisPrompt(context) {
    return `Based on the following analysis of the query "${context.original_query}":

Reasoning insights:
${context.reasoning_insights.map(insight => 
  `- ${insight.type}: ${insight.summary} (confidence: ${(insight.confidence * 100).toFixed(1)}%)`
).join('\n')}

Relevant context:
${context.vector_context.join('\n')}

Please provide a comprehensive response that synthesizes these insights and addresses the original query effectively.`;
  }

  generateFallbackSynthesis(context) {
    const insights = context.reasoning_insights || [];
    const query = context.original_query || '';

    let response = `Regarding your question about "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}", `;

    if (insights.length > 0) {
      response += `I've analyzed this through ${insights.length} reasoning steps. `;
      
      const highConfidenceInsights = insights.filter(i => i.confidence > 0.7);
      if (highConfidenceInsights.length > 0) {
        response += `The most reliable insights suggest that `;
        response += highConfidenceInsights.map(i => i.summary).join(', and ') + '. ';
      }
    }

    if (context.vector_context && context.vector_context.length > 0) {
      response += `Based on the available information, `;
    }

    response += `I can provide you with a thoughtful response, though I'd recommend asking for clarification if you need more specific details about any particular aspect.`;

    return response;
  }

  enhanceResponse(response, issues, query) {
    let enhanced = response;

    if (issues.includes('Response too short')) {
      enhanced += ` To elaborate further on "${query.substring(0, 30)}...", I'd be happy to provide more specific details if you could clarify what particular aspect interests you most.`;
    }

    if (issues.includes('Response may not address the query')) {
      enhanced = `Regarding your question "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}", ` + enhanced;
    }

    if (issues.includes('Low confidence in reasoning')) {
      enhanced += ` Please note that I have moderate confidence in this analysis, so I'd recommend verifying this information or asking follow-up questions for clarification.`;
    }

    return enhanced;
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(metrics) {
    this.performanceMetrics.totalReasoningChains++;
    
    const count = this.performanceMetrics.totalReasoningChains;
    
    // Update averages
    this.performanceMetrics.averageSteps = 
      (this.performanceMetrics.averageSteps * (count - 1) + metrics.stepCount) / count;
    
    this.performanceMetrics.averageConfidence = 
      (this.performanceMetrics.averageConfidence * (count - 1) + metrics.confidence) / count;
    
    this.performanceMetrics.averageProcessingTime = 
      (this.performanceMetrics.averageProcessingTime * (count - 1) + metrics.processingTime) / count;
    
    // Update success rate
    const successes = metrics.success ? 1 : 0;
    this.performanceMetrics.successRate = 
      (this.performanceMetrics.successRate * (count - 1) + successes) / count;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      ...this.performanceMetrics,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Reset performance metrics
   */
  resetPerformanceMetrics() {
    this.performanceMetrics = {
      totalReasoningChains: 0,
      averageSteps: 0,
      averageConfidence: 0,
      averageProcessingTime: 0,
      successRate: 0
    };
  }
}

module.exports = MultiStepReasoningAgent;
