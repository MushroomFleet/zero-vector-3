const PersonaMemoryManager = require('./PersonaMemoryManager');
const HybridVectorStore = require('./HybridVectorStore');
const { logger, logError } = require('../utils/logger');

/**
 * Hybrid Persona Memory Manager
 * Extends PersonaMemoryManager with knowledge graph capabilities
 * Maintains full backward compatibility while adding graph features
 */
class HybridPersonaMemoryManager extends PersonaMemoryManager {
  constructor(database, vectorStore, embeddingService) {
    // Upgrade vector store to hybrid if it's not already
    let hybridVectorStore = vectorStore;
    
    if (!(vectorStore instanceof HybridVectorStore)) {
      logger.info('Upgrading vector store to HybridVectorStore');
      
      // Create hybrid vector store with same configuration
      hybridVectorStore = new HybridVectorStore(
        vectorStore.maxMemoryMB || 2048,
        vectorStore.dimensions || 1536,
        {
          M: vectorStore.hnswIndex?.M || 16,
          efConstruction: vectorStore.hnswIndex?.efConstruction || 200,
          efSearch: vectorStore.hnswIndex?.efSearch || 50,
          distanceFunction: 'cosine',
          indexThreshold: vectorStore.indexThreshold || 100
        },
        database,
        embeddingService
      );
      
      // Transfer existing vectors if any
      if (vectorStore.vectorCount > 0) {
        logger.info('Transferring existing vectors to hybrid store', {
          vectorCount: vectorStore.vectorCount
        });
        
        // Note: In a real migration, we'd copy vectors, but for now we'll rely on reload
        // The server's reloadExistingMemories will handle this
      }
    }
    
    // Initialize parent with hybrid vector store
    super(database, hybridVectorStore, embeddingService);
    
    // Store reference to hybrid capabilities
    this.hybridVectorStore = hybridVectorStore;
    this.graphEnabled = true;
    
    logger.info('HybridPersonaMemoryManager initialized', {
      graphEnabled: this.graphEnabled,
      vectorStoreType: this.vectorStore.constructor.name
    });
  }

  /**
   * Enhanced addMemory with automatic graph processing
   */
  async addMemory(personaId, content, context = {}) {
    try {
      logger.debug('Adding memory with hybrid processing', {
        personaId,
        contentLength: content.length,
        memoryType: context.type || this.memoryTypes.CONVERSATION
      });

      // Call parent addMemory which will now use HybridVectorStore
      const result = await super.addMemory(personaId, content, context);
      
      // The graph processing happens automatically in HybridVectorStore.addVector
      // No additional processing needed here
      
      logger.info('Hybrid memory addition completed', {
        personaId,
        memoryId: result.id,
        memoryType: result.type,
        graphProcessingEnabled: this.hybridVectorStore.graphEnabled
      });

      return result;

    } catch (error) {
      logError(error, {
        operation: 'hybridAddMemory',
        personaId,
        contentLength: content?.length
      });
      throw error;
    }
  }

  /**
   * Enhanced memory retrieval with graph expansion
   */
  async retrieveRelevantMemories(personaId, query, options = {}) {
    try {
      logger.debug('Retrieving memories with hybrid search', {
        personaId,
        query: query.substring(0, 50),
        options
      });

      const {
        limit = 5,
        threshold = 0.7,
        memoryTypes = null,
        maxAge = null,
        includeContext = true,
        useGraphExpansion = true,
        graphDepth = 2,
        graphWeight = 0.3
      } = options;

      const persona = await this.database.getPersonaById(personaId);
      if (!persona) {
        throw new Error('Persona not found');
      }

      // Generate query embedding
      const provider = persona.config.embeddingProvider || 'local';
      const model = persona.config.embeddingModel || (provider === 'openai' ? 'text-embedding-3-small' : 'all-MiniLM-L6-v2');
      
      const queryEmbedding = await this.embeddingService.generateEmbedding(query, {
        provider: provider,
        model: model,
        useCache: true
      });

      // Use hybrid search instead of regular search
      const searchResults = await this.hybridVectorStore.hybridSearch(queryEmbedding.vector, {
        limit: limit * 2, // Get more to filter
        threshold: threshold,
        metric: 'cosine',
        filters: { personaId: personaId },
        includeValues: false,
        includeMetadata: true,
        useIndex: true,
        useGraphExpansion: useGraphExpansion && this.graphEnabled,
        graphDepth: graphDepth,
        graphWeight: graphWeight,
        personaId: personaId
      });

      // Apply the same filtering logic as parent class
      let filteredResults = searchResults;

      // Filter by memory types if specified
      if (memoryTypes && Array.isArray(memoryTypes)) {
        filteredResults = filteredResults.filter(result => 
          memoryTypes.includes(result.metadata.memoryType)
        );
      }

      // Filter by age if specified
      if (maxAge) {
        const cutoffTime = Date.now() - maxAge;
        filteredResults = filteredResults.filter(result => 
          result.metadata.timestamp >= cutoffTime
        );
      }

      // Sort by relevance and recency (accounting for potential graph boosting)
      filteredResults.sort((a, b) => {
        const scoreA = a.similarity + (a.metadata.importance || 0.5) * 0.1;
        const scoreB = b.similarity + (b.metadata.importance || 0.5) * 0.1;
        
        // Give slight boost to graph-expanded results
        const graphBoostA = (a.graphExpanded || a.graphBoosted) ? 0.05 : 0;
        const graphBoostB = (b.graphExpanded || b.graphBoosted) ? 0.05 : 0;
        
        return (scoreB + graphBoostB) - (scoreA + graphBoostA);
      });

      // Limit final results
      filteredResults = filteredResults.slice(0, limit);

      // Enrich with database metadata if needed (same logic as parent)
      if (includeContext) {
        for (const result of filteredResults) {
          try {
            if (!result.metadata.originalContent) {
              const dbMetadata = await this.database.getVectorMetadata(result.id);
              if (dbMetadata && dbMetadata.customMetadata) {
                result.metadata = { 
                  ...result.metadata, 
                  ...dbMetadata.customMetadata,
                  originalContent: dbMetadata.customMetadata.originalContent
                };
              }
            }
          } catch (error) {
            logger.error('Failed to fetch metadata for memory', {
              memoryId: result.id,
              error: error.message
            });
          }
        }
      }

      logger.info('Hybrid memory retrieval completed', {
        personaId,
        query: query.substring(0, 100),
        resultCount: filteredResults.length,
        graphExpansionUsed: useGraphExpansion && this.graphEnabled,
        graphExpandedResults: filteredResults.filter(r => r.graphExpanded || r.graphBoosted).length,
        avgSimilarity: filteredResults.length > 0 
          ? (filteredResults.reduce((sum, r) => sum + r.similarity, 0) / filteredResults.length).toFixed(3)
          : 0
      });

      return filteredResults;

    } catch (error) {
      logError(error, {
        operation: 'hybridRetrieveRelevantMemories',
        personaId,
        query: query?.substring(0, 100)
      });
      throw error;
    }
  }

  /**
   * Get enhanced persona memory statistics including graph data
   */
  async getPersonaMemoryStats(personaId) {
    try {
      // Get base memory statistics from parent
      const baseStats = await super.getPersonaMemoryStats(personaId);
      
      // Add graph statistics if enabled
      let graphStats = null;
      if (this.graphEnabled && this.hybridVectorStore.graphEnabled) {
        try {
          graphStats = await this.hybridVectorStore.getGraphStatistics(personaId);
        } catch (error) {
          logger.warn('Failed to get graph statistics', {
            personaId,
            error: error.message
          });
        }
      }

      // Get hybrid vector store statistics
      const hybridVectorStats = this.hybridVectorStore.getStats().hybrid;

      const enhancedStats = {
        ...baseStats,
        graphStats: graphStats,
        hybridFeatures: {
          graphEnabled: this.graphEnabled,
          entitiesExtracted: hybridVectorStats.entitiesExtracted,
          relationshipsCreated: hybridVectorStats.relationshipsCreated,
          hybridSearches: hybridVectorStats.hybridSearches,
          graphExpansions: hybridVectorStats.graphExpansions,
          avgGraphProcessingTime: hybridVectorStats.avgGraphProcessingTime
        }
      };

      logger.debug('Retrieved enhanced persona memory statistics', {
        personaId,
        totalMemories: baseStats.totalMemories,
        totalEntities: graphStats?.totalEntities || 0,
        totalRelationships: graphStats?.totalRelationships || 0
      });

      return enhancedStats;

    } catch (error) {
      logError(error, {
        operation: 'getEnhancedPersonaMemoryStats',
        personaId
      });
      // Fall back to base stats if enhanced stats fail
      return await super.getPersonaMemoryStats(personaId);
    }
  }

  /**
   * Search entities in the persona's knowledge graph
   */
  async searchGraphEntities(personaId, query, options = {}) {
    try {
      if (!this.graphEnabled) {
        logger.warn('Graph search requested but graph features are disabled', { personaId });
        return [];
      }

      const results = await this.hybridVectorStore.searchGraphEntities(personaId, query, options);
      
      logger.info('Graph entity search completed', {
        personaId,
        query,
        resultCount: results.length
      });

      return results;

    } catch (error) {
      logError(error, {
        operation: 'searchGraphEntities',
        personaId,
        query
      });
      return [];
    }
  }

  /**
   * Find entities related to a specific entity
   */
  async findRelatedEntities(entityId, options = {}) {
    try {
      if (!this.graphEnabled) {
        logger.warn('Related entity search requested but graph features are disabled', { entityId });
        return [];
      }

      const results = await this.hybridVectorStore.findRelatedEntities(entityId, options);
      
      logger.info('Related entity search completed', {
        entityId,
        resultCount: results.length,
        maxDepth: options.maxDepth || 2
      });

      return results;

    } catch (error) {
      logError(error, {
        operation: 'findRelatedEntities',
        entityId,
        options
      });
      return [];
    }
  }

  /**
   * Get graph context for specific entities
   */
  async getGraphContext(entityIds, options = {}) {
    try {
      if (!this.graphEnabled) {
        logger.warn('Graph context requested but graph features are disabled', { entityIds });
        return { entities: [], relationships: [], connections: [] };
      }

      const context = await this.hybridVectorStore.getGraphContext(entityIds, options);
      
      logger.info('Graph context retrieved', {
        requestedEntities: entityIds.length,
        foundEntities: context.entities.length,
        relationships: context.relationships.length,
        connections: context.connections.length
      });

      return context;

    } catch (error) {
      logError(error, {
        operation: 'getGraphContext',
        entityIds,
        options
      });
      return { entities: [], relationships: [], connections: [] };
    }
  }

  /**
   * Enable or disable graph features
   */
  setGraphEnabled(enabled) {
    this.graphEnabled = enabled;
    if (this.hybridVectorStore) {
      this.hybridVectorStore.setGraphEnabled(enabled);
    }
    
    logger.info(`Hybrid memory manager graph features ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable entity extraction
   */
  setEntityExtractionEnabled(enabled) {
    if (this.hybridVectorStore) {
      this.hybridVectorStore.setEntityExtractionEnabled(enabled);
    }
    
    logger.info(`Entity extraction ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable relationship extraction
   */
  setRelationshipExtractionEnabled(enabled) {
    if (this.hybridVectorStore) {
      this.hybridVectorStore.setRelationshipExtractionEnabled(enabled);
    }
    
    logger.info(`Relationship extraction ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get comprehensive statistics including graph performance
   */
  getHybridStats() {
    const baseStats = {
      vectorStoreType: this.vectorStore.constructor.name,
      graphEnabled: this.graphEnabled
    };

    if (this.hybridVectorStore) {
      const hybridStats = this.hybridVectorStore.getStats();
      return {
        ...baseStats,
        vectorStore: hybridStats,
        hybrid: hybridStats.hybrid
      };
    }

    return baseStats;
  }

  /**
   * Enhanced cleanup with graph maintenance
   */
  async cleanupExpiredMemories() {
    try {
      // Call parent cleanup
      const baseCleanupResult = await super.cleanupExpiredMemories();
      
      // Additional graph cleanup if enabled
      let graphCleanupResult = { totalCleaned: 0 };
      if (this.graphEnabled && this.hybridVectorStore) {
        try {
          // Get all personas that need graph cleanup
          const allPersonas = await this.database.searchVectorMetadata({ limit: 10000 });
          const personaIds = [...new Set(allPersonas.map(m => m.persona_id).filter(Boolean))];

          let totalGraphCleaned = 0;
          for (const personaId of personaIds) {
            try {
              // Clean up orphaned entities for each persona
              const cleaned = await this.hybridVectorStore.graphService.cleanupOrphanedEntities(personaId);
              totalGraphCleaned += cleaned;
            } catch (error) {
              logger.warn('Failed to cleanup graph for persona', {
                personaId,
                error: error.message
              });
            }
          }
          
          graphCleanupResult = { totalCleaned: totalGraphCleaned };
          
        } catch (error) {
          logger.warn('Graph cleanup failed', { error: error.message });
        }
      }

      const totalCleaned = baseCleanupResult.totalCleaned + graphCleanupResult.totalCleaned;

      logger.info('Hybrid memory cleanup completed', {
        memoriesCleaned: baseCleanupResult.totalCleaned,
        graphEntitiesCleaned: graphCleanupResult.totalCleaned,
        totalCleaned
      });

      return { 
        totalCleaned,
        memoriesCleaned: baseCleanupResult.totalCleaned,
        graphEntitiesCleaned: graphCleanupResult.totalCleaned
      };

    } catch (error) {
      logError(error, {
        operation: 'hybridCleanupExpiredMemories'
      });
      // Fall back to parent cleanup if hybrid cleanup fails
      return await super.cleanupExpiredMemories();
    }
  }
}

module.exports = HybridPersonaMemoryManager;
