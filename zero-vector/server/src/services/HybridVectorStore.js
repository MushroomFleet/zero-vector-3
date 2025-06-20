const IndexedVectorStore = require('./IndexedVectorStore');
const GraphDatabaseService = require('./GraphDatabaseService');
const EntityExtractor = require('./EntityExtractor');
const { logger, logError } = require('../utils/logger');

/**
 * Hybrid Vector Store
 * Combines vector search with knowledge graph capabilities
 * Extends IndexedVectorStore while preserving all existing functionality
 */
class HybridVectorStore extends IndexedVectorStore {
  constructor(maxMemoryMB, dimensions, indexOptions, database, embeddingService) {
    // Initialize parent IndexedVectorStore
    super(maxMemoryMB, dimensions, indexOptions);
    
    // Initialize graph services
    this.database = database;
    this.embeddingService = embeddingService;
    this.graphService = new GraphDatabaseService(database);
    this.entityExtractor = new EntityExtractor(embeddingService);
    
    // Graph processing configuration
    this.graphEnabled = true;
    this.entityExtractionEnabled = true;
    this.relationshipExtractionEnabled = true;
    
    // Performance tracking for hybrid operations
    this.hybridStats = {
      graphProcessingTime: 0,
      entitiesExtracted: 0,
      relationshipsCreated: 0,
      hybridSearches: 0,
      graphExpansions: 0
    };
    
    logger.info('HybridVectorStore initialized', {
      maxMemoryMB,
      dimensions,
      graphEnabled: this.graphEnabled,
      entityExtractionEnabled: this.entityExtractionEnabled
    });
  }

  /**
   * Enhanced addVector with graph processing
   */
  async addVector(vector, id, metadata = {}) {
    const startTime = Date.now();
    
    try {
      // First, add vector using parent implementation
      const vectorResult = super.addVector(vector, id, metadata);
      
      // Create vector metadata record in database for foreign key references
      if (this.database) {
        await this.createVectorMetadata(id, vector, metadata);
      }
      
      // Process graph associations if enabled and content is available
      if (this.graphEnabled && metadata.originalContent && metadata.personaId) {
        await this.processGraphAssociations(id, metadata);
      }
      
      const duration = Date.now() - startTime;
      logger.debug('Hybrid vector addition completed', {
        id,
        duration,
        graphProcessed: this.graphEnabled && metadata.originalContent && metadata.personaId,
        metadataCreated: !!this.database
      });
      
      return vectorResult;
      
    } catch (error) {
      logError(error, { 
        operation: 'hybridAddVector', 
        id,
        hasOriginalContent: !!metadata.originalContent,
        hasPersonaId: !!metadata.personaId
      });
      throw error;
    }
  }

  /**
   * Enhanced search with graph expansion capabilities
   */
  async hybridSearch(queryVector, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        useGraphExpansion = true,
        graphDepth = 2,
        graphWeight = 0.3,
        ...vectorSearchOptions
      } = options;
      
      // Perform primary vector search
      const vectorResults = await this.search(queryVector, vectorSearchOptions);
      
      // Expand with graph context if enabled
      if (useGraphExpansion && this.graphEnabled && vectorResults.length > 0) {
        const expandedResults = await this.expandWithGraphContext(
          vectorResults, 
          {
            graphDepth,
            graphWeight,
            ...options
          }
        );
        
        this.hybridStats.hybridSearches++;
        if (expandedResults.length > vectorResults.length) {
          this.hybridStats.graphExpansions++;
        }
        
        const duration = Date.now() - startTime;
        logger.debug('Hybrid search completed with graph expansion', {
          originalResults: vectorResults.length,
          expandedResults: expandedResults.length,
          duration,
          graphDepth,
          graphWeight
        });
        
        return expandedResults;
      }
      
      this.hybridStats.hybridSearches++;
      const duration = Date.now() - startTime;
      
      logger.debug('Hybrid search completed without graph expansion', {
        resultCount: vectorResults.length,
        duration,
        graphExpansionSkipped: !useGraphExpansion || !this.graphEnabled
      });
      
      return vectorResults;
      
    } catch (error) {
      logError(error, { 
        operation: 'hybridSearch',
        useGraphExpansion: options.useGraphExpansion
      });
      // Fall back to regular vector search if hybrid search fails
      return await this.search(queryVector, vectorSearchOptions);
    }
  }

  /**
   * Create vector metadata record in database
   */
  async createVectorMetadata(vectorId, vector, metadata) {
    try {
      // Check if vector metadata already exists
      const existingMetadata = await this.database.getVectorMetadata(vectorId);
      if (existingMetadata) {
        logger.debug('Vector metadata already exists, skipping creation', {
          vectorId,
          personaId: metadata.personaId
        });
        return;
      }
      
      // Prepare metadata for database insertion
      const vectorMetadata = {
        id: vectorId,
        dimensions: vector.length,
        personaId: metadata.personaId || null,
        contentType: metadata.type || metadata.contentType || 'memory',
        source: metadata.source || 'user_input',
        tags: metadata.tags || [],
        customMetadata: {
          importance: metadata.importance,
          context: metadata.context,
          originalContent: metadata.originalContent ? metadata.originalContent.substring(0, 1000) : null, // Truncate for storage
          memoryType: metadata.type,
          ...metadata.customMetadata
        }
      };
      
      // Insert vector metadata into database
      await this.database.insertVectorMetadata(vectorMetadata);
      
      logger.debug('Vector metadata created successfully', {
        vectorId,
        personaId: vectorMetadata.personaId,
        dimensions: vectorMetadata.dimensions,
        contentType: vectorMetadata.contentType
      });
      
    } catch (error) {
      // Log error but don't throw - this shouldn't break vector storage
      logError(error, {
        operation: 'createVectorMetadata',
        vectorId,
        personaId: metadata.personaId
      });
      logger.warn('Failed to create vector metadata, continuing without database record', {
        vectorId,
        error: error.message
      });
    }
  }

  /**
   * Process graph associations for new content
   */
  async processGraphAssociations(vectorId, metadata) {
    if (!this.entityExtractionEnabled || !metadata.originalContent || !metadata.personaId) {
      return;
    }
    
    const startTime = Date.now();
    
    try {
      logger.debug('Starting graph processing', {
        vectorId,
        personaId: metadata.personaId,
        contentLength: metadata.originalContent.length
      });
      
      // Extract entities from content
      const entities = await this.entityExtractor.extractEntities(
        metadata.originalContent,
        metadata.personaId,
        vectorId
      );
      
      if (entities.length === 0) {
        logger.debug('No entities extracted from content', { vectorId });
        return;
      }
      
      // Extract relationships if enabled
      let relationships = [];
      if (this.relationshipExtractionEnabled && entities.length > 1) {
        relationships = await this.entityExtractor.findEntityRelationships(
          entities,
          metadata.originalContent
        );
      }
      
      // Process entities and relationships in the graph
      const processingResult = await this.graphService.processEntitiesAndRelationships(
        entities,
        relationships
      );
      
      // Update statistics
      this.hybridStats.entitiesExtracted += processingResult.summary.entitiesProcessed;
      this.hybridStats.relationshipsCreated += processingResult.summary.relationshipsProcessed;
      
      const duration = Date.now() - startTime;
      this.hybridStats.graphProcessingTime += duration;
      
      logger.info('Graph processing completed', {
        vectorId,
        personaId: metadata.personaId,
        entitiesProcessed: processingResult.summary.entitiesProcessed,
        relationshipsProcessed: processingResult.summary.relationshipsProcessed,
        duration
      });
      
    } catch (error) {
      logError(error, {
        operation: 'processGraphAssociations',
        vectorId,
        personaId: metadata.personaId
      });
      // Don't throw error - graph processing failure shouldn't break vector storage
    }
  }

  /**
   * Expand search results with graph context
   */
  async expandWithGraphContext(vectorResults, options = {}) {
    try {
      const {
        graphDepth = 2,
        graphWeight = 0.3,
        maxGraphResults = 10,
        personaId = null
      } = options;
      
      if (!vectorResults || vectorResults.length === 0) {
        return vectorResults;
      }
      
      // Extract entity IDs from vector results that have graph associations
      const entityIds = [];
      for (const result of vectorResults) {
        if (result.metadata && result.metadata.personaId) {
          // Find entities linked to this vector
          try {
            const entities = await this.database.getEntitiesByPersona(
              result.metadata.personaId,
              { vectorId: result.id, limit: 5 }
            );
            entityIds.push(...entities.map(e => e.id));
          } catch (error) {
            // Continue processing other results
            logger.debug('Failed to get entities for vector', { vectorId: result.id });
          }
        }
      }
      
      if (entityIds.length === 0) {
        logger.debug('No entities found for graph expansion');
        return vectorResults;
      }
      
      // Find related entities through graph traversal
      const relatedEntities = [];
      for (const entityId of entityIds.slice(0, 5)) { // Limit to prevent excessive processing
        try {
          const related = await this.graphService.findRelatedEntities(entityId, {
            maxDepth: graphDepth,
            limit: maxGraphResults,
            minStrength: 0.3
          });
          relatedEntities.push(...related);
        } catch (error) {
          logger.debug('Failed to find related entities', { entityId });
        }
      }
      
      // Get vectors associated with related entities
      const graphVectorIds = new Set();
      for (const entity of relatedEntities) {
        try {
          const entityData = await this.database.getEntityById(entity.id);
          if (entityData && entityData.vector_id && entityData.vector_id !== vectorResults.find(r => r.id === entityData.vector_id)) {
            graphVectorIds.add(entityData.vector_id);
          }
        } catch (error) {
          logger.debug('Failed to get entity data', { entityId: entity.id });
        }
      }
      
      // Retrieve graph-related vectors and merge with original results
      const graphResults = [];
      for (const vectorId of Array.from(graphVectorIds).slice(0, maxGraphResults)) {
        try {
          const vectorMeta = this.metadata.get(vectorId);
          if (vectorMeta) {
            graphResults.push({
              id: vectorId,
              similarity: 0.5, // Default similarity for graph-related results
              metadata: vectorMeta,
              source: 'graph_expansion'
            });
          }
        } catch (error) {
          logger.debug('Failed to get vector metadata', { vectorId });
        }
      }
      
      // Combine and reweight results
      const combinedResults = [...vectorResults];
      
      for (const graphResult of graphResults) {
        // Check if this vector is already in the results
        const existingIndex = combinedResults.findIndex(r => r.id === graphResult.id);
        
        if (existingIndex >= 0) {
          // Boost similarity of existing result
          combinedResults[existingIndex].similarity = Math.min(
            1.0, 
            combinedResults[existingIndex].similarity + (graphWeight * 0.2)
          );
          combinedResults[existingIndex].graphBoosted = true;
        } else {
          // Add new graph result with weighted similarity
          combinedResults.push({
            ...graphResult,
            similarity: graphResult.similarity * graphWeight,
            graphExpanded: true
          });
        }
      }
      
      // Sort by similarity and limit results
      combinedResults.sort((a, b) => b.similarity - a.similarity);
      const finalResults = combinedResults.slice(0, options.limit || 10);
      
      logger.debug('Graph expansion completed', {
        originalResults: vectorResults.length,
        graphResults: graphResults.length,
        finalResults: finalResults.length,
        graphWeight
      });
      
      return finalResults;
      
    } catch (error) {
      logError(error, { operation: 'expandWithGraphContext' });
      // Return original results if graph expansion fails
      return vectorResults;
    }
  }

  /**
   * Get comprehensive statistics including graph performance
   */
  getStats() {
    const baseStats = super.getStats();
    
    return {
      ...baseStats,
      hybrid: {
        graphEnabled: this.graphEnabled,
        entityExtractionEnabled: this.entityExtractionEnabled,
        relationshipExtractionEnabled: this.relationshipExtractionEnabled,
        ...this.hybridStats,
        avgGraphProcessingTime: this.hybridStats.entitiesExtracted > 0 
          ? (this.hybridStats.graphProcessingTime / this.hybridStats.entitiesExtracted).toFixed(2) + 'ms'
          : '0ms'
      }
    };
  }

  /**
   * Enable or disable graph processing
   */
  setGraphEnabled(enabled) {
    this.graphEnabled = enabled;
    logger.info(`Graph processing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable entity extraction
   */
  setEntityExtractionEnabled(enabled) {
    this.entityExtractionEnabled = enabled;
    logger.info(`Entity extraction ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable relationship extraction
   */
  setRelationshipExtractionEnabled(enabled) {
    this.relationshipExtractionEnabled = enabled;
    logger.info(`Relationship extraction ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Search entities in the knowledge graph
   */
  async searchGraphEntities(personaId, query, options = {}) {
    try {
      if (!this.graphEnabled) {
        return [];
      }
      
      return await this.graphService.searchEntities(personaId, query, options);
      
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
   * Get knowledge graph statistics for a persona
   */
  async getGraphStatistics(personaId) {
    try {
      if (!this.graphEnabled) {
        return null;
      }
      
      return await this.graphService.getGraphStatistics(personaId);
      
    } catch (error) {
      logError(error, {
        operation: 'getGraphStatistics',
        personaId
      });
      return null;
    }
  }

  /**
   * Find related entities for a given entity
   */
  async findRelatedEntities(entityId, options = {}) {
    try {
      if (!this.graphEnabled) {
        return [];
      }
      
      return await this.graphService.findRelatedEntities(entityId, options);
      
    } catch (error) {
      logError(error, {
        operation: 'findRelatedEntities',
        entityId
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
        return { entities: [], relationships: [], connections: [] };
      }
      
      return await this.graphService.getGraphContext(entityIds, options);
      
    } catch (error) {
      logError(error, {
        operation: 'getGraphContext',
        entityIds
      });
      return { entities: [], relationships: [], connections: [] };
    }
  }

  /**
   * Enhanced cleanup with graph maintenance
   */
  cleanup() {
    // Call parent cleanup
    super.cleanup();
    
    // Log hybrid statistics
    const hybridStats = this.getStats().hybrid;
    logger.info('Hybrid vector store cleanup completed', {
      entitiesExtracted: hybridStats.entitiesExtracted,
      relationshipsCreated: hybridStats.relationshipsCreated,
      hybridSearches: hybridStats.hybridSearches,
      graphExpansions: hybridStats.graphExpansions
    });
  }
}

module.exports = HybridVectorStore;
