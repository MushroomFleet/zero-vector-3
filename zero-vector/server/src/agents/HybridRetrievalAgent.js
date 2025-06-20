const { z } = require('zod');
const { ZeroVectorStateManager } = require('../state/ZeroVectorState');
const { logger, logError } = require('../utils/logger');

/**
 * Hybrid Retrieval Agent
 * Enhanced vector-graph search with LangGraph integration
 * Implements the hybrid retrieval patterns from the LangGraph-DEV-HANDOFF.md
 */
class HybridRetrievalAgent {
  constructor(hybridVectorStore, embeddingService, graphService) {
    this.hybridVectorStore = hybridVectorStore;
    this.embeddingService = embeddingService;
    this.graphService = graphService;
    this.performanceMetrics = {
      totalSearches: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      graphExpansionRate: 0
    };
    
    logger.info('HybridRetrievalAgent initialized', {
      vectorStoreType: hybridVectorStore.constructor.name,
      graphEnabled: hybridVectorStore.graphEnabled || false,
      entityExtractionEnabled: hybridVectorStore.entityExtractionEnabled || false
    });
  }

  /**
   * Main agent execution function for LangGraph
   * Implements comprehensive hybrid retrieval with entity extraction and graph traversal
   */
  async __call__(state) {
    const startTime = Date.now();
    let cacheHit = false;
    let graphExpansionUsed = false;
    let entitiesExtracted = 0;
    let relationshipsFound = 0;

    try {
      // Extract query from latest message
      const messages = state.messages || [];
      if (messages.length === 0) {
        throw new Error('No messages found in state');
      }

      const latestMessage = messages[messages.length - 1];
      const query = latestMessage.content;
      const userId = state.user_profile?.id;
      const personaId = state.active_persona;

      logger.debug('Starting hybrid retrieval process', {
        query: query.substring(0, 100),
        userId,
        personaId,
        messageCount: messages.length
      });

      // Stage 1: Query Analysis and Complexity Assessment
      const queryComplexity = this.analyzeQueryComplexity(query);
      const useGraphExpansion = state.features?.graph_expansion_enabled !== false && 
                               queryComplexity !== 'simple';

      // Stage 2: Generate Query Embedding
      const embeddingOptions = {
        provider: state.persona_context?.config?.embeddingProvider || 'openai',
        model: state.persona_context?.config?.embeddingModel || 'text-embedding-3-small',
        useCache: state.features?.caching_enabled !== false
      };

      const embeddingResult = await this.embeddingService.generateEmbedding(query, embeddingOptions);
      const queryEmbedding = embeddingResult.vector;
      cacheHit = embeddingResult.cached || false;

      // Stage 3: Entity Extraction (if enabled)
      let extractedEntities = [];
      if (state.features?.entity_extraction_enabled !== false && this.hybridVectorStore.entityExtractionEnabled) {
        try {
          extractedEntities = await this.extractEntities(query, personaId);
          entitiesExtracted = extractedEntities.length;
          
          logger.debug('Extracted entities from query', {
            query: query.substring(0, 50),
            entityCount: entitiesExtracted,
            entities: extractedEntities.map(e => e.name)
          });
        } catch (error) {
          logger.warn('Entity extraction failed, continuing with vector search only', {
            error: error.message
          });
        }
      }

      // Stage 4: Vector Similarity Search
      const vectorSearchOptions = {
        limit: queryComplexity === 'complex' ? 30 : queryComplexity === 'moderate' ? 20 : 15,
        threshold: 0.7,
        metric: 'cosine',
        filters: {
          personaId: personaId,
          userId: userId
        },
        includeValues: false,
        includeMetadata: true,
        useIndex: true
      };

      const vectorResults = await this.hybridVectorStore.search(queryEmbedding, vectorSearchOptions);

      // Stage 5: Graph Relationship Traversal (if enabled and entities found)
      let graphResults = [];
      let relatedEntities = [];
      
      if (useGraphExpansion && extractedEntities.length > 0) {
        try {
          graphExpansionUsed = true;
          
          // Find related entities through graph traversal
          for (const entity of extractedEntities) {
            const related = await this.hybridVectorStore.findRelatedEntities(entity.id, {
              maxDepth: 2,
              relationshipTypes: ['RELATES_TO', 'IMPLIES', 'SUPPORTS', 'CONNECTED_TO'],
              confidenceThreshold: 0.6,
              limit: 10
            });
            relatedEntities.push(...related);
          }

          relationshipsFound = relatedEntities.length;

          // Expand search with relationship context
          for (const relatedEntity of relatedEntities) {
            const entityDocs = await this.hybridVectorStore.search(
              relatedEntity.embedding || await this.generateEntityEmbedding(relatedEntity.description),
              {
                ...vectorSearchOptions,
                limit: 5,
                filters: {
                  ...vectorSearchOptions.filters,
                  entityType: relatedEntity.type
                }
              }
            );
            
            // Mark these as graph-expanded results
            const markedResults = entityDocs.map(doc => ({
              ...doc,
              graphExpanded: true,
              expandedFrom: relatedEntity.name,
              graphWeight: 0.3
            }));
            
            graphResults.push(...markedResults);
          }

          logger.debug('Graph expansion completed', {
            extractedEntities: entitiesExtracted,
            relatedEntities: relationshipsFound,
            graphResults: graphResults.length
          });

        } catch (error) {
          logger.warn('Graph expansion failed, using vector results only', {
            error: error.message,
            extractedEntities: entitiesExtracted
          });
        }
      }

      // Stage 6: Combine and Rank Results
      const allResults = [...vectorResults, ...graphResults];
      const rankedResults = this.rankHybridResults(query, allResults, {
        queryComplexity,
        graphWeight: 0.3,
        diversityBoost: 0.1,
        recencyBoost: 0.05
      });

      // Stage 7: Apply Result Filtering and Limits
      const finalLimit = queryComplexity === 'complex' ? 15 : queryComplexity === 'moderate' ? 10 : 8;
      const filteredResults = this.applyResultFilters(rankedResults, {
        limit: finalLimit,
        minSimilarity: 0.6,
        deduplicationThreshold: 0.95,
        maxAge: state.user_profile?.preferences?.maxMemoryAge,
        preferredTypes: state.persona_context?.config?.preferredMemoryTypes
      });

      // Stage 8: Enrich Results with Context
      const enrichedResults = await this.enrichResultsWithContext(filteredResults, {
        includeOriginalContent: true,
        includeRelationships: graphExpansionUsed,
        includeEntityContext: entitiesExtracted > 0
      });

      // Stage 9: Update Performance Metrics
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics({
        processingTime,
        cacheHit,
        graphExpansionUsed,
        resultCount: enrichedResults.length
      });

      // Stage 10: Create Memory Context
      const memoryContext = {
        retrieval_timestamp: new Date().toISOString(),
        query_complexity: queryComplexity,
        result_confidence: this.calculateResultConfidence(enrichedResults),
        processing_time_ms: processingTime,
        cache_hit: cacheHit,
        graph_expansion_used: graphExpansionUsed,
        entities_extracted: entitiesExtracted,
        relationships_found: relationshipsFound
      };

      // Stage 11: Update State
      let updatedState = ZeroVectorStateManager.addVectorResults(state, enrichedResults);
      updatedState = ZeroVectorStateManager.updateMemoryContext(updatedState, memoryContext);

      // Add graph relationships if found
      if (relatedEntities.length > 0) {
        const relationships = relatedEntities.map(entity => ({
          id: `rel_${entity.id}`,
          source_entity: extractedEntities.find(e => e.name === entity.sourceEntity)?.name || 'unknown',
          target_entity: entity.name,
          relationship_type: entity.relationshipType || 'RELATED_TO',
          confidence: entity.confidence || 0.7,
          metadata: {
            graph_expansion: true,
            query: query.substring(0, 100)
          },
          created_at: new Date().toISOString()
        }));

        updatedState.graph_relationships = [...(updatedState.graph_relationships || []), ...relationships];
      }

      logger.info('Hybrid retrieval completed successfully', {
        query: query.substring(0, 100),
        queryComplexity,
        vectorResultCount: vectorResults.length,
        graphResultCount: graphResults.length,
        finalResultCount: enrichedResults.length,
        processingTimeMs: processingTime,
        cacheHit,
        graphExpansionUsed,
        entitiesExtracted,
        relationshipsFound,
        avgSimilarity: enrichedResults.length > 0 
          ? (enrichedResults.reduce((sum, r) => sum + r.similarity, 0) / enrichedResults.length).toFixed(3)
          : 0
      });

      return updatedState;

    } catch (error) {
      logError(error, {
        operation: 'hybridRetrievalAgent',
        query: state.messages?.[state.messages.length - 1]?.content?.substring(0, 100),
        userId: state.user_profile?.id,
        personaId: state.active_persona,
        processingTime: Date.now() - startTime
      });

      // Return state with error information
      const errorState = ZeroVectorStateManager.addError(state, {
        code: 'HYBRID_RETRIEVAL_ERROR',
        message: error.message,
        step: 'hybrid_retrieval',
        recoverable: true
      });

      return errorState;
    }
  }

  /**
   * Analyze query complexity for adaptive processing
   */
  analyzeQueryComplexity(query) {
    const words = query.toLowerCase().split(/\s+/);
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who'];
    const complexityIndicators = ['explain', 'analyze', 'compare', 'relationship', 'because', 'therefore'];
    
    // Simple heuristics for complexity assessment
    if (words.length <= 5 && !questionWords.some(q => words.includes(q))) {
      return 'simple';
    }
    
    if (words.length > 15 || complexityIndicators.some(c => words.includes(c))) {
      return 'complex';
    }
    
    return 'moderate';
  }

  /**
   * Extract entities from query text
   */
  async extractEntities(query, personaId) {
    try {
      if (!this.hybridVectorStore.entityExtractor) {
        return [];
      }

      const entities = await this.hybridVectorStore.entityExtractor.extractEntities(query, {
        personaId,
        includeExisting: true,
        confidenceThreshold: 0.6,
        maxEntities: 10
      });

      return entities.filter(entity => entity.confidence >= 0.6);

    } catch (error) {
      logger.warn('Entity extraction failed', { error: error.message, query });
      return [];
    }
  }

  /**
   * Generate embedding for entity description
   */
  async generateEntityEmbedding(description) {
    try {
      const result = await this.embeddingService.generateEmbedding(description, {
        provider: 'openai',
        useCache: true
      });
      return result.vector;
    } catch (error) {
      logger.warn('Failed to generate entity embedding', { error: error.message });
      return null;
    }
  }

  /**
   * Rank hybrid results using multiple factors
   */
  rankHybridResults(query, results, options = {}) {
    const {
      queryComplexity = 'moderate',
      graphWeight = 0.3,
      diversityBoost = 0.1,
      recencyBoost = 0.05
    } = options;

    return results
      .map(result => {
        let score = result.similarity || 0;
        
        // Apply graph expansion boost
        if (result.graphExpanded) {
          score += graphWeight;
        }
        
        // Apply recency boost
        if (result.metadata?.timestamp) {
          const age = Date.now() - new Date(result.metadata.timestamp).getTime();
          const daysSinceCreated = age / (1000 * 60 * 60 * 24);
          if (daysSinceCreated < 7) {
            score += recencyBoost * (7 - daysSinceCreated) / 7;
          }
        }
        
        // Apply importance boost
        if (result.metadata?.importance) {
          score += result.metadata.importance * 0.1;
        }
        
        // Apply diversity boost for different content types
        if (result.metadata?.memoryType !== 'conversation') {
          score += diversityBoost;
        }

        return {
          ...result,
          finalScore: score
        };
      })
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
  }

  /**
   * Apply various filters to results
   */
  applyResultFilters(results, options = {}) {
    const {
      limit = 10,
      minSimilarity = 0.6,
      deduplicationThreshold = 0.95,
      maxAge,
      preferredTypes = []
    } = options;

    let filtered = results;

    // Filter by similarity threshold
    filtered = filtered.filter(result => (result.similarity || 0) >= minSimilarity);

    // Filter by age if specified
    if (maxAge) {
      const cutoffTime = Date.now() - maxAge;
      filtered = filtered.filter(result => {
        if (!result.metadata?.timestamp) return true;
        return new Date(result.metadata.timestamp).getTime() >= cutoffTime;
      });
    }

    // Deduplicate similar results
    const deduplicated = [];
    for (const result of filtered) {
      const isDuplicate = deduplicated.some(existing => 
        this.calculateContentSimilarity(result.content, existing.content) > deduplicationThreshold
      );
      
      if (!isDuplicate) {
        deduplicated.push(result);
      }
    }

    // Prefer certain types if specified
    if (preferredTypes.length > 0) {
      const preferred = deduplicated.filter(result => 
        preferredTypes.includes(result.metadata?.memoryType)
      );
      const others = deduplicated.filter(result => 
        !preferredTypes.includes(result.metadata?.memoryType)
      );
      
      filtered = [...preferred, ...others];
    } else {
      filtered = deduplicated;
    }

    return filtered.slice(0, limit);
  }

  /**
   * Calculate simple content similarity for deduplication
   */
  calculateContentSimilarity(content1, content2) {
    if (!content1 || !content2) return 0;
    
    const words1 = new Set(content1.toLowerCase().split(/\s+/));
    const words2 = new Set(content2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Enrich results with additional context
   */
  async enrichResultsWithContext(results, options = {}) {
    const {
      includeOriginalContent = true,
      includeRelationships = false,
      includeEntityContext = false
    } = options;

    const enriched = [];

    for (const result of results) {
      let enrichedResult = { ...result };

      try {
        // Include original content if requested and not already present
        if (includeOriginalContent && !result.metadata?.originalContent) {
          // This would typically fetch from database
          enrichedResult.metadata = {
            ...enrichedResult.metadata,
            originalContent: result.content
          };
        }

        // Include relationship context if requested
        if (includeRelationships && result.graphExpanded) {
          enrichedResult.metadata = {
            ...enrichedResult.metadata,
            relationshipContext: {
              expandedFrom: result.expandedFrom,
              relationshipType: result.relationshipType || 'RELATED_TO',
              graphDepth: result.graphDepth || 1
            }
          };
        }

        enriched.push(enrichedResult);

      } catch (error) {
        logger.warn('Failed to enrich result', {
          resultId: result.id,
          error: error.message
        });
        enriched.push(result); // Include original result
      }
    }

    return enriched;
  }

  /**
   * Calculate overall confidence in the result set
   */
  calculateResultConfidence(results) {
    if (results.length === 0) return 0;

    const similarities = results.map(r => r.similarity || 0);
    const avgSimilarity = similarities.reduce((sum, sim) => sum + sim, 0) / similarities.length;
    
    // Factor in result count and diversity
    const countFactor = Math.min(results.length / 5, 1); // Optimal around 5 results
    const diversityFactor = new Set(results.map(r => r.metadata?.memoryType)).size / Math.max(results.length, 1);
    
    return avgSimilarity * 0.7 + countFactor * 0.2 + diversityFactor * 0.1;
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(metrics) {
    this.performanceMetrics.totalSearches++;
    
    // Update average response time
    const prevAvg = this.performanceMetrics.averageResponseTime;
    const count = this.performanceMetrics.totalSearches;
    this.performanceMetrics.averageResponseTime = 
      (prevAvg * (count - 1) + metrics.processingTime) / count;
    
    // Update cache hit rate
    const cacheHits = metrics.cacheHit ? 1 : 0;
    this.performanceMetrics.cacheHitRate = 
      (this.performanceMetrics.cacheHitRate * (count - 1) + cacheHits) / count;
    
    // Update graph expansion rate
    const graphExpansions = metrics.graphExpansionUsed ? 1 : 0;
    this.performanceMetrics.graphExpansionRate = 
      (this.performanceMetrics.graphExpansionRate * (count - 1) + graphExpansions) / count;
  }

  /**
   * Get agent performance statistics
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
      totalSearches: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      graphExpansionRate: 0
    };
  }
}

module.exports = HybridRetrievalAgent;
