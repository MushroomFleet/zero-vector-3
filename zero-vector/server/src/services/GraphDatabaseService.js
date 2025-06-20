const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { logger, logError } = require('../utils/logger');

/**
 * Graph Database Service
 * Handles knowledge graph operations including entity and relationship management
 */
class GraphDatabaseService {
  constructor(database) {
    this.database = database;
  }

  /**
   * Generate deterministic entity ID based on persona, name, and type
   */
  generateEntityId(personaId, name, type) {
    const normalizedName = this.normalizeEntityName(name);
    const content = `${personaId}:${normalizedName}:${type}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
  }

  /**
   * Generate deterministic relationship ID
   */
  generateRelationshipId(personaId, sourceEntityId, targetEntityId, relationshipType) {
    const content = `${personaId}:${sourceEntityId}:${targetEntityId}:${relationshipType}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
  }

  /**
   * Normalize entity name for consistent lookups
   */
  normalizeEntityName(name) {
    return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Generate content hash for entity
   */
  generateContentHash(name, type, properties = {}) {
    const content = JSON.stringify({ name, type, properties }, Object.keys({ name, type, properties }).sort());
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Validate entity exists before creating relationships
   */
  async validateEntityExists(entityId) {
    try {
      const entity = await this.database.getEntityById(entityId);
      return !!entity;
    } catch (error) {
      logger.warn('Failed to validate entity existence', { entityId, error: error.message });
      return false;
    }
  }

  /**
   * Create or update an entity in the knowledge graph
   */
  async createEntity(entityData) {
    try {
      // Generate deterministic entity ID
      const entityId = entityData.id || this.generateEntityId(
        entityData.personaId,
        entityData.name,
        entityData.type
      );

      // Normalize entity name for consistent lookups
      const normalizedName = this.normalizeEntityName(entityData.name);
      const contentHash = this.generateContentHash(entityData.name, entityData.type, entityData.properties);

      // Check if entity already exists with same ID
      const existingEntity = await this.database.getEntityById(entityId);

      if (existingEntity) {
        // Update existing entity with higher confidence if provided
        if ((entityData.confidence || 1.0) > existingEntity.confidence) {
          await this.updateEntity(existingEntity.id, {
            confidence: entityData.confidence || 1.0,
            vectorId: entityData.vectorId || existingEntity.vector_id,
            properties: {
              ...existingEntity.properties,
              ...entityData.properties
            },
            contentHash: contentHash
          });
          
          logger.info('Updated existing entity with higher confidence', {
            entityId: existingEntity.id,
            name: entityData.name,
            oldConfidence: existingEntity.confidence,
            newConfidence: entityData.confidence || 1.0
          });
          
          return existingEntity.id;
        } else {
          // Entity exists with equal or higher confidence, return existing ID
          logger.debug('Entity already exists with sufficient confidence', {
            entityId: existingEntity.id,
            name: entityData.name,
            confidence: existingEntity.confidence
          });
          return existingEntity.id;
        }
      }

      try {
        // Create new entity with enhanced data
        await this.database.insertEntity({
          id: entityId,
          personaId: entityData.personaId,
          vectorId: entityData.vectorId,
          type: entityData.type,
          name: entityData.name,
          normalizedName: normalizedName,
          properties: entityData.properties || {},
          confidence: entityData.confidence || 1.0,
          contentHash: contentHash
        });

        logger.info('Created new entity', {
          entityId,
          personaId: entityData.personaId,
          type: entityData.type,
          name: entityData.name,
          normalizedName: normalizedName,
          confidence: entityData.confidence || 1.0
        });

        return entityId;

      } catch (insertError) {
        // Check if this is a UNIQUE constraint violation
        if (insertError.message && insertError.message.includes('UNIQUE constraint failed')) {
          // Entity was created by another process, find and return the existing entity
          logger.warn('UNIQUE constraint violation, finding existing entity', {
            personaId: entityData.personaId,
            name: entityData.name,
            type: entityData.type,
            error: insertError.message
          });

          // Try to find existing entity by normalized name and type
          const existingEntities = await this.database.getEntitiesByPersona(entityData.personaId, {
            limit: 100
          });

          const matchingEntity = existingEntities.find(entity => 
            entity.type === entityData.type && 
            entity.normalized_name === normalizedName
          );

          if (matchingEntity) {
            logger.info('Found existing entity after UNIQUE constraint violation', {
              entityId: matchingEntity.id,
              name: entityData.name,
              type: entityData.type
            });
            return matchingEntity.id;
          } else {
            // If we can't find the entity, something is wrong
            logger.error('Could not find entity after UNIQUE constraint violation', {
              personaId: entityData.personaId,
              name: entityData.name,
              type: entityData.type,
              normalizedName: normalizedName
            });
            throw insertError;
          }
        } else {
          // Some other error, re-throw it
          throw insertError;
        }
      }

    } catch (error) {
      logError(error, {
        operation: 'createEntity',
        entityData: {
          personaId: entityData.personaId,
          type: entityData.type,
          name: entityData.name
        }
      });
      throw error;
    }
  }

  /**
   * Create or update a relationship between entities
   */
  async createRelationship(relationshipData) {
    try {
      // Validate that both entities exist before creating relationship
      const sourceExists = await this.validateEntityExists(relationshipData.sourceEntityId);
      const targetExists = await this.validateEntityExists(relationshipData.targetEntityId);

      if (!sourceExists) {
        const error = new Error(`Source entity not found: ${relationshipData.sourceEntityId}`);
        logError(error, {
          operation: 'createRelationship',
          sourceEntityId: relationshipData.sourceEntityId,
          targetEntityId: relationshipData.targetEntityId,
          relationshipType: relationshipData.relationshipType
        });
        throw error;
      }

      if (!targetExists) {
        const error = new Error(`Target entity not found: ${relationshipData.targetEntityId}`);
        logError(error, {
          operation: 'createRelationship',
          sourceEntityId: relationshipData.sourceEntityId,
          targetEntityId: relationshipData.targetEntityId,
          relationshipType: relationshipData.relationshipType
        });
        throw error;
      }

      // Enhanced duplicate detection: Check using the actual UNIQUE constraint fields
      const existingRelationshipByFields = await this.findExistingRelationship(
        relationshipData.personaId,
        relationshipData.sourceEntityId,
        relationshipData.targetEntityId,
        relationshipData.relationshipType
      );

      if (existingRelationshipByFields) {
        // Update relationship strength using weighted average
        const newStrength = Math.min(1.0, (existingRelationshipByFields.strength + (relationshipData.strength || 1.0)) / 2);
        
        await this.database.updateRelationship(existingRelationshipByFields.id, {
          strength: newStrength,
          context: relationshipData.context || existingRelationshipByFields.context,
          properties: {
            ...existingRelationshipByFields.properties,
            ...relationshipData.properties,
            updateCount: (existingRelationshipByFields.properties.updateCount || 0) + 1,
            lastUpdated: Date.now()
          }
        });

        logger.debug('Updated existing relationship found by constraint fields', {
          relationshipId: existingRelationshipByFields.id,
          personaId: relationshipData.personaId,
          sourceEntityId: relationshipData.sourceEntityId,
          targetEntityId: relationshipData.targetEntityId,
          relationshipType: relationshipData.relationshipType,
          oldStrength: existingRelationshipByFields.strength,
          newStrength: newStrength
        });

        return existingRelationshipByFields.id;
      }

      // Generate deterministic relationship ID
      const relationshipId = relationshipData.id || this.generateRelationshipId(
        relationshipData.personaId,
        relationshipData.sourceEntityId,
        relationshipData.targetEntityId,
        relationshipData.relationshipType
      );

      // Generate content hash for relationship
      const contentHash = this.generateContentHash(
        `${relationshipData.sourceEntityId}:${relationshipData.targetEntityId}`,
        relationshipData.relationshipType,
        relationshipData.properties
      );

      try {
        // Create new relationship with validation passed
        await this.database.insertRelationship({
          id: relationshipId,
          personaId: relationshipData.personaId,
          sourceEntityId: relationshipData.sourceEntityId,
          targetEntityId: relationshipData.targetEntityId,
          relationshipType: relationshipData.relationshipType,
          strength: relationshipData.strength || 1.0,
          context: relationshipData.context,
          properties: relationshipData.properties || {},
          contentHash: contentHash
        });

        logger.info('Created new relationship', {
          relationshipId,
          personaId: relationshipData.personaId,
          sourceEntityId: relationshipData.sourceEntityId,
          targetEntityId: relationshipData.targetEntityId,
          relationshipType: relationshipData.relationshipType,
          strength: relationshipData.strength || 1.0
        });

        return relationshipId;

      } catch (insertError) {
        // Handle UNIQUE constraint violations as a safety net
        if (insertError.message && insertError.message.includes('UNIQUE constraint failed')) {
          logger.warn('UNIQUE constraint violation, finding existing relationship', {
            personaId: relationshipData.personaId,
            sourceEntityId: relationshipData.sourceEntityId,
            targetEntityId: relationshipData.targetEntityId,
            relationshipType: relationshipData.relationshipType,
            error: insertError.message
          });

          // Try to find the existing relationship again
          const existingRelationship = await this.findExistingRelationship(
            relationshipData.personaId,
            relationshipData.sourceEntityId,
            relationshipData.targetEntityId,
            relationshipData.relationshipType
          );

          if (existingRelationship) {
            logger.info('Found existing relationship after UNIQUE constraint violation', {
              relationshipId: existingRelationship.id,
              personaId: relationshipData.personaId,
              sourceEntityId: relationshipData.sourceEntityId,
              targetEntityId: relationshipData.targetEntityId,
              relationshipType: relationshipData.relationshipType
            });
            return existingRelationship.id;
          } else {
            // If we still can't find it, something is seriously wrong
            logger.error('Could not find relationship after UNIQUE constraint violation', {
              personaId: relationshipData.personaId,
              sourceEntityId: relationshipData.sourceEntityId,
              targetEntityId: relationshipData.targetEntityId,
              relationshipType: relationshipData.relationshipType
            });
            throw insertError;
          }
        } else {
          // Some other error, re-throw it
          throw insertError;
        }
      }

    } catch (error) {
      logError(error, {
        operation: 'createRelationship',
        relationshipData: {
          personaId: relationshipData.personaId,
          sourceEntityId: relationshipData.sourceEntityId,
          targetEntityId: relationshipData.targetEntityId,
          relationshipType: relationshipData.relationshipType
        }
      });
      throw error;
    }
  }

  /**
   * Process extracted entities and relationships from content
   */
  async processEntitiesAndRelationships(entities, relationships) {
    try {
      const processedEntities = [];
      const processedRelationships = [];
      const entityIdMapping = new Map(); // Map original random IDs to new deterministic IDs

      // Process entities first and build ID mapping
      for (const entity of entities) {
        try {
          const originalId = entity.id;
          const newEntityId = await this.createEntity(entity);
          
          // Track the mapping from original ID to new deterministic ID
          entityIdMapping.set(originalId, newEntityId);
          
          processedEntities.push({
            ...entity,
            id: newEntityId,
            originalId: originalId,
            status: 'processed'
          });
          
          logger.debug('Entity processed with ID mapping', {
            originalId,
            newId: newEntityId,
            entityName: entity.name,
            entityType: entity.type
          });
          
        } catch (error) {
          logError(error, {
            operation: 'processEntity',
            entityName: entity.name,
            entityType: entity.type,
            originalId: entity.id
          });
          processedEntities.push({
            ...entity,
            status: 'failed',
            error: error.message
          });
        }
      }

      // Update relationship entity IDs to use new deterministic IDs
      const updatedRelationships = relationships.map(relationship => {
        const originalSourceId = relationship.sourceEntityId;
        const originalTargetId = relationship.targetEntityId;
        const newSourceId = entityIdMapping.get(originalSourceId);
        const newTargetId = entityIdMapping.get(originalTargetId);

        if (!newSourceId || !newTargetId) {
          logger.warn('Missing entity ID mapping for relationship', {
            originalSourceId,
            originalTargetId,
            newSourceId,
            newTargetId,
            relationshipType: relationship.relationshipType
          });
        }

        return {
          ...relationship,
          sourceEntityId: newSourceId || originalSourceId,
          targetEntityId: newTargetId || originalTargetId,
          originalSourceId,
          originalTargetId
        };
      });

      // Process relationships with updated entity IDs
      for (const relationship of updatedRelationships) {
        try {
          // Only process if both entities were successfully created
          if (entityIdMapping.has(relationship.originalSourceId) && 
              entityIdMapping.has(relationship.originalTargetId)) {
            
            const relationshipId = await this.createRelationship(relationship);
            processedRelationships.push({
              ...relationship,
              id: relationshipId,
              status: 'processed'
            });
            
            logger.debug('Relationship processed with updated IDs', {
              relationshipId,
              sourceEntityId: relationship.sourceEntityId,
              targetEntityId: relationship.targetEntityId,
              relationshipType: relationship.relationshipType
            });
            
          } else {
            throw new Error(`Missing source or target entity for relationship: ${relationship.originalSourceId} -> ${relationship.originalTargetId}`);
          }
        } catch (error) {
          logError(error, {
            operation: 'processRelationship',
            sourceEntityId: relationship.sourceEntityId,
            targetEntityId: relationship.targetEntityId,
            originalSourceId: relationship.originalSourceId,
            originalTargetId: relationship.originalTargetId,
            relationshipType: relationship.relationshipType
          });
          processedRelationships.push({
            ...relationship,
            status: 'failed',
            error: error.message
          });
        }
      }

      const summary = {
        entitiesProcessed: processedEntities.filter(e => e.status === 'processed').length,
        entitiesFailed: processedEntities.filter(e => e.status === 'failed').length,
        relationshipsProcessed: processedRelationships.filter(r => r.status === 'processed').length,
        relationshipsFailed: processedRelationships.filter(r => r.status === 'failed').length,
        entityIdMappings: entityIdMapping.size
      };

      logger.info('Graph processing completed with ID mapping', {
        ...summary,
        entityIdMappingsCreated: entityIdMapping.size
      });

      return {
        entities: processedEntities,
        relationships: processedRelationships,
        summary,
        entityIdMapping: Object.fromEntries(entityIdMapping) // Include mapping in response for debugging
      };

    } catch (error) {
      logError(error, {
        operation: 'processEntitiesAndRelationships',
        entityCount: entities?.length,
        relationshipCount: relationships?.length
      });
      throw error;
    }
  }

  /**
   * Find related entities using graph traversal
   */
  async findRelatedEntities(entityId, options = {}) {
    try {
      const {
        maxDepth = 2,
        limit = 50,
        minStrength = 0.1,
        entityTypes = null,
        relationshipTypes = null
      } = options;

      // Use database's graph traversal method
      const relatedEntities = await this.database.findRelatedEntities(entityId, maxDepth, limit);

      // Filter by entity types if specified
      let filteredEntities = relatedEntities;
      if (entityTypes && Array.isArray(entityTypes)) {
        filteredEntities = filteredEntities.filter(entity => 
          entityTypes.includes(entity.type)
        );
      }

      // Filter by minimum confidence (using confidence as a proxy for strength)
      if (minStrength > 0) {
        filteredEntities = filteredEntities.filter(entity => 
          entity.confidence >= minStrength
        );
      }

      // Get relationship information for each related entity
      const enrichedEntities = await Promise.all(
        filteredEntities.map(async (entity) => {
          try {
            const relationships = await this.database.getEntityRelationships(entity.entity_id, 'both', 5);
            
            // Filter relationships if types specified
            let filteredRelationships = relationships;
            if (relationshipTypes && Array.isArray(relationshipTypes)) {
              filteredRelationships = relationships.filter(rel => 
                relationshipTypes.includes(rel.relationship_type)
              );
            }

            return {
              id: entity.entity_id,
              name: entity.name,
              type: entity.type,
              confidence: entity.confidence,
              depth: entity.depth,
              relationships: filteredRelationships.map(rel => ({
                id: rel.id,
                type: rel.relationship_type,
                strength: rel.strength,
                direction: rel.source_entity_id === entity.entity_id ? 'outgoing' : 'incoming',
                connectedEntityId: rel.source_entity_id === entity.entity_id ? rel.target_entity_id : rel.source_entity_id
              }))
            };
          } catch (error) {
            logError(error, {
              operation: 'enrichRelatedEntity',
              entityId: entity.entity_id
            });
            return {
              id: entity.entity_id,
              name: entity.name,
              type: entity.type,
              confidence: entity.confidence,
              depth: entity.depth,
              relationships: []
            };
          }
        })
      );

      logger.info('Found related entities', {
        sourceEntityId: entityId,
        relatedCount: enrichedEntities.length,
        maxDepth,
        options
      });

      return enrichedEntities;

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
   * Get knowledge graph context for entities
   */
  async getGraphContext(entityIds, options = {}) {
    try {
      const {
        includeRelationships = true,
        maxRelationships = 10,
        relationshipDepth = 1
      } = options;

      const context = {
        entities: [],
        relationships: [],
        connections: []
      };

      // Get detailed information for each entity
      for (const entityId of entityIds) {
        try {
          const entity = await this.database.getEntityById(entityId);
          if (entity) {
            context.entities.push(entity);

            if (includeRelationships) {
              const relationships = await this.database.getEntityRelationships(
                entityId, 
                'both', 
                maxRelationships
              );
              
              context.relationships.push(...relationships);

              // Find connections between the requested entities
              const connections = relationships.filter(rel => 
                entityIds.includes(rel.source_entity_id) || 
                entityIds.includes(rel.target_entity_id)
              );
              
              context.connections.push(...connections);
            }
          }
        } catch (error) {
          logError(error, {
            operation: 'getEntityContext',
            entityId
          });
        }
      }

      // Remove duplicate relationships
      context.relationships = this.deduplicateRelationships(context.relationships);
      context.connections = this.deduplicateRelationships(context.connections);

      logger.info('Retrieved graph context', {
        requestedEntities: entityIds.length,
        foundEntities: context.entities.length,
        relationships: context.relationships.length,
        connections: context.connections.length
      });

      return context;

    } catch (error) {
      logError(error, {
        operation: 'getGraphContext',
        entityIds
      });
      return { entities: [], relationships: [], connections: [] };
    }
  }

  /**
   * Search entities by similarity to query terms
   */
  async searchEntities(personaId, query, options = {}) {
    try {
      const {
        limit = 10,
        entityTypes = null,
        minConfidence = 0.0
      } = options;

      // Simple text-based search for now (could be enhanced with semantic search later)
      const searchTerms = query.toLowerCase().split(/\s+/);
      let allEntities = await this.database.getEntitiesByPersona(personaId, {
        limit: 1000 // Get more for filtering
      });

      // Filter by entity types if specified
      if (entityTypes && Array.isArray(entityTypes)) {
        allEntities = allEntities.filter(entity => 
          entityTypes.includes(entity.type)
        );
      }

      // Filter by minimum confidence
      allEntities = allEntities.filter(entity => 
        entity.confidence >= minConfidence
      );

      // Score entities based on query similarity
      const scoredEntities = allEntities.map(entity => {
        const name = entity.name.toLowerCase();
        let score = 0;

        // Exact match gets highest score
        if (name === query.toLowerCase()) {
          score = 1.0;
        } else {
          // Partial matches
          for (const term of searchTerms) {
            if (name.includes(term)) {
              score += 0.5 / searchTerms.length;
            }
            // Word boundary matches get higher score
            if (name.match(new RegExp(`\\b${term}\\b`))) {
              score += 0.3 / searchTerms.length;
            }
          }
        }

        // Boost score by entity confidence
        score *= entity.confidence;

        return {
          ...entity,
          searchScore: score
        };
      });

      // Sort by search score and limit results
      const results = scoredEntities
        .filter(entity => entity.searchScore > 0)
        .sort((a, b) => b.searchScore - a.searchScore)
        .slice(0, limit);

      logger.info('Entity search completed', {
        personaId,
        query,
        resultsFound: results.length,
        totalSearched: allEntities.length
      });

      return results;

    } catch (error) {
      logError(error, {
        operation: 'searchEntities',
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
      const stats = await this.database.getGraphStats(personaId);
      
      // Add additional derived statistics
      const totalNodes = stats.totalEntities;
      const totalEdges = stats.totalRelationships;
      const density = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;
      
      // Calculate average relationships per entity
      const avgRelationshipsPerEntity = totalNodes > 0 ? totalEdges / totalNodes : 0;

      // Transform entityTypes array to include percentages and proper field names
      const transformedEntityTypes = stats.entityTypes.map(entityType => ({
        type: entityType.type,
        count: entityType.count,
        percentage: totalNodes > 0 ? parseFloat(((entityType.count / totalNodes) * 100).toFixed(1)) : 0.0,
        avgConfidence: entityType.avg_confidence ? parseFloat(entityType.avg_confidence.toFixed(3)) : 0.0
      }));

      // Transform relationshipTypes array to include percentages and proper field names
      const transformedRelationshipTypes = stats.relationshipTypes.map(relType => ({
        type: relType.relationship_type, // Transform field name from relationship_type to type
        count: relType.count,
        percentage: totalEdges > 0 ? parseFloat(((relType.count / totalEdges) * 100).toFixed(1)) : 0.0,
        avgStrength: relType.avg_strength ? parseFloat(relType.avg_strength.toFixed(3)) : 0.0
      }));

      const enhancedStats = {
        ...stats,
        entityTypes: transformedEntityTypes,
        relationshipTypes: transformedRelationshipTypes,
        graphDensity: parseFloat(density.toFixed(4)),
        averageRelationshipsPerEntity: parseFloat(avgRelationshipsPerEntity.toFixed(2)),
        graphComplexity: this.calculateGraphComplexity(stats),
        lastUpdated: Date.now()
      };

      logger.info('Retrieved graph statistics', {
        personaId,
        totalEntities: stats.totalEntities,
        totalRelationships: stats.totalRelationships,
        graphDensity: enhancedStats.graphDensity,
        entityTypesCount: transformedEntityTypes.length,
        relationshipTypesCount: transformedRelationshipTypes.length
      });

      return enhancedStats;

    } catch (error) {
      logError(error, {
        operation: 'getGraphStatistics',
        personaId
      });
      return {
        totalEntities: 0,
        totalRelationships: 0,
        entityTypes: [],
        relationshipTypes: [],
        graphDensity: 0,
        averageRelationshipsPerEntity: 0,
        graphComplexity: 'low',
        lastUpdated: Date.now()
      };
    }
  }

  /**
   * Helper method to find entity by name and type
   */
  async findEntityByNameAndType(personaId, name, type) {
    try {
      const entities = await this.database.searchEntitiesByName(personaId, name, 5);
      return entities.find(entity => 
        entity.type === type && 
        entity.name.toLowerCase() === name.toLowerCase()
      );
    } catch (error) {
      logError(error, {
        operation: 'findEntityByNameAndType',
        personaId,
        name,
        type
      });
      return null;
    }
  }

  /**
   * Find existing relationship using UNIQUE constraint fields
   */
  async findExistingRelationship(personaId, sourceEntityId, targetEntityId, relationshipType) {
    try {
      const relationship = await this.database.findRelationshipByFields(
        personaId,
        sourceEntityId,
        targetEntityId,
        relationshipType
      );
      
      if (relationship) {
        logger.debug('Found existing relationship by constraint fields', {
          relationshipId: relationship.id,
          personaId,
          sourceEntityId,
          targetEntityId,
          relationshipType
        });
      }
      
      return relationship;
    } catch (error) {
      logError(error, {
        operation: 'findExistingRelationship',
        personaId,
        sourceEntityId,
        targetEntityId,
        relationshipType
      });
      return null;
    }
  }

  /**
   * Helper method to find existing relationship (legacy method)
   */
  async findRelationship(sourceEntityId, targetEntityId, relationshipType) {
    try {
      const relationships = await this.database.getEntityRelationships(sourceEntityId, 'outgoing', 100);
      return relationships.find(rel => 
        rel.target_entity_id === targetEntityId && 
        rel.relationship_type === relationshipType
      );
    } catch (error) {
      logError(error, {
        operation: 'findRelationship',
        sourceEntityId,
        targetEntityId,
        relationshipType
      });
      return null;
    }
  }

  /**
   * Helper method to update entity
   */
  async updateEntity(entityId, updates) {
    try {
      await this.database.updateEntity(entityId, updates);
      logger.debug('Entity updated', { entityId, updates });
    } catch (error) {
      logError(error, {
        operation: 'updateEntity',
        entityId,
        updates
      });
      throw error;
    }
  }

  /**
   * Helper method to deduplicate relationships
   */
  deduplicateRelationships(relationships) {
    const seen = new Set();
    return relationships.filter(rel => {
      const key = `${rel.source_entity_id}-${rel.target_entity_id}-${rel.relationship_type}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Calculate graph complexity based on statistics
   */
  calculateGraphComplexity(stats) {
    const totalEntities = stats.totalEntities;
    const totalRelationships = stats.totalRelationships;
    const entityTypeCount = stats.entityTypes.length;
    const relationshipTypeCount = stats.relationshipTypes.length;

    if (totalEntities < 10) return 'low';
    if (totalEntities < 50) return 'medium';
    if (totalEntities < 200) return 'high';
    return 'very_high';
  }

  /**
   * Clean up orphaned entities (entities with no relationships)
   */
  async cleanupOrphanedEntities(personaId, maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    try {
      const cutoffTime = Date.now() - maxAge;
      let cleanedCount = 0;

      // Get all entities for the persona
      const entities = await this.database.getEntitiesByPersona(personaId);

      for (const entity of entities) {
        // Skip if entity is recent
        if (entity.created_at > cutoffTime) continue;

        // Check if entity has any relationships
        const relationships = await this.database.getEntityRelationships(entity.id, 'both', 1);
        
        // If no relationships and entity is old, consider for cleanup
        if (relationships.length === 0 && entity.confidence < 0.5) {
          await this.database.deleteEntity(entity.id);
          cleanedCount++;
        }
      }

      logger.info('Cleaned up orphaned entities', {
        personaId,
        cleanedCount,
        maxAge
      });

      return cleanedCount;

    } catch (error) {
      logError(error, {
        operation: 'cleanupOrphanedEntities',
        personaId
      });
      return 0;
    }
  }
}

module.exports = GraphDatabaseService;
