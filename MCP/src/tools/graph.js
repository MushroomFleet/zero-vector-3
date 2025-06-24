/**
 * Graph Tools for Zero-Vector MCP Server v2.0
 * Advanced knowledge graph exploration and hybrid search capabilities
 */

import apiClient from '../apiClient.js';
import { validateInput } from '../utils/validation.js';
import { createLogger } from '../utils/logger.js';
import { formatTimestamp } from '../utils/dateHelpers.js';
import joi from 'joi';

const logger = createLogger('GraphTools');

// Common validation patterns
const patterns = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

/**
 * Graph validation schemas using Joi
 */
const graphSchemas = {
  exploreKnowledgeGraph: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    query: joi.string().min(1).max(1000).required(),
    limit: joi.number().integer().min(1).max(100).default(10),
    entityTypes: joi.array().items(
      joi.string().valid('PERSON', 'CONCEPT', 'EVENT', 'OBJECT', 'PLACE')
    ).optional(),
    minConfidence: joi.number().min(0).max(1).default(0.0),
    includeRelated: joi.boolean().default(false),
    maxDepth: joi.number().integer().min(1).max(5).default(2)
  }),

  hybridMemorySearch: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    query: joi.string().min(1).max(1000).required(),
    limit: joi.number().integer().min(1).max(50).default(5),
    threshold: joi.number().min(0).max(1).default(0.7),
    memoryTypes: joi.array().items(
      joi.string().valid('conversation', 'fact', 'preference', 'context', 'system')
    ).optional(),
    includeContext: joi.boolean().default(true),
    useGraphExpansion: joi.boolean().default(true),
    graphDepth: joi.number().integer().min(1).max(5).default(2),
    graphWeight: joi.number().min(0).max(1).default(0.3)
  }),

  getGraphContext: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    entityIds: joi.array().items(joi.string()).min(1).max(50).required(),
    includeRelationships: joi.boolean().default(true),
    maxRelationships: joi.number().integer().min(1).max(100).default(20),
    relationshipDepth: joi.number().integer().min(1).max(3).default(1)
  }),

  getGraphStats: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required()
  }),

  getPersonaRelationships: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    limit: joi.number().integer().min(1).max(500).default(50),
    offset: joi.number().integer().min(0).default(0),
    relationshipTypes: joi.array().items(joi.string()).optional(),
    entityTypes: joi.array().items(
      joi.string().valid('PERSON', 'CONCEPT', 'EVENT', 'OBJECT', 'PLACE')
    ).optional(),
    minStrength: joi.number().min(0).max(1).default(0),
    maxStrength: joi.number().min(0).max(1).default(1),
    includeEntityDetails: joi.boolean().default(false),
    sortBy: joi.string().valid('strength', 'created_at', 'updated_at', 'relationship_type').default('strength'),
    sortOrder: joi.string().valid('asc', 'desc').default('desc')
  })
};

/**
 * Explore knowledge graph for a persona
 */
export const exploreKnowledgeGraph = {
  name: 'explore_knowledge_graph',
  description: 'Explore the knowledge graph for a persona, finding entities and their relationships',
  inputSchema: {
    type: 'object',
    properties: {
      personaId: {
        type: 'string',
        description: 'UUID of the persona to explore'
      },
      query: {
        type: 'string',
        description: 'Search query for entities (1-1000 characters)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of entities to return (1-100, default: 10)'
      },
      entityTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['PERSON', 'CONCEPT', 'EVENT', 'OBJECT', 'PLACE']
        },
        description: 'Filter by specific entity types'
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold (0-1, default: 0.0)'
      },
      includeRelated: {
        type: 'boolean',
        description: 'Include related entities (default: false)'
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum relationship depth when including related entities (1-5, default: 2)'
      }
    },
    required: ['personaId', 'query']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(graphSchemas.exploreKnowledgeGraph, params, 'explore_knowledge_graph');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { personaId, includeRelated, maxDepth, ...searchParams } = validation.value;

      // Search entities via API
      const result = await apiClient.post(`/api/personas/${personaId}/graph/entities/search`, searchParams);

      if (!result.success) {
        logger.error('Graph exploration failed', {
          error: result.error,
          message: result.message,
          personaId
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to explore knowledge graph: ${result.message}\n\n💡 ${result.suggestion || 'Please check the persona ID and search query.'}`
          }],
          isError: true
        };
      }

      const { entities, options, meta } = result.data;
      logger.info('Graph exploration completed', {
        entityCount: entities.length,
        personaId,
        query: searchParams.query.substring(0, 50)
      });

      if (entities.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `🔍 No entities found in knowledge graph for "${searchParams.query}"\n\n💡 Try a broader search term or lower the confidence threshold.`
          }]
        };
      }

      let resultText = `🌐 **Knowledge Graph Exploration**\n\n`;
      resultText += `👤 **Persona:** ${personaId}\n`;
      resultText += `🔍 **Query:** "${searchParams.query}"\n`;
      resultText += `📊 **Found:** ${meta.count} entities\n`;
      resultText += `🏷️ **Types:** ${meta.types.join(', ')}\n\n`;

      entities.forEach((entity, index) => {
        resultText += `**${index + 1}. ${entity.name}** (${entity.type})\n`;
        resultText += `• **ID:** ${entity.id}\n`;
        resultText += `• **Confidence:** ${(entity.confidence * 100).toFixed(1)}%\n`;
        
        if (entity.properties && Object.keys(entity.properties).length > 0) {
          const props = typeof entity.properties === 'string' ? JSON.parse(entity.properties) : entity.properties;
          const propKeys = Object.keys(props).slice(0, 3);
          if (propKeys.length > 0) {
            resultText += `• **Properties:** ${propKeys.join(', ')}${Object.keys(props).length > 3 ? '...' : ''}\n`;
          }
        }
        
        if (entity.relationshipCount && entity.relationshipCount > 0) {
          resultText += `• **Relationships:** ${entity.relationshipCount}\n`;
        }
        
        resultText += `• **Created:** ${formatTimestamp(entity.created_at, 'date')}\n\n`;
      });

      // If requested, get related entities for each found entity
      if (includeRelated && entities.length > 0 && entities.length <= 5) {
        resultText += `🔗 **Related Entities:**\n\n`;
        
        for (const entity of entities.slice(0, 3)) { // Limit to first 3 entities to avoid overwhelming output
          try {
            const relatedResult = await apiClient.get(`/api/personas/${personaId}/graph/entities/${entity.id}/related`, {
              maxDepth: maxDepth || 2,
              limit: 5
            });

            if (relatedResult.success && relatedResult.data.relatedEntities.length > 0) {
              resultText += `**${entity.name}** → `;
              const relatedNames = relatedResult.data.relatedEntities.slice(0, 3).map(e => e.name);
              resultText += relatedNames.join(', ');
              if (relatedResult.data.relatedEntities.length > 3) {
                resultText += ` (+${relatedResult.data.relatedEntities.length - 3} more)`;
              }
              resultText += '\n';
            }
          } catch (error) {
            logger.warn('Failed to get related entities', { entityId: entity.id, error: error.message });
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: resultText.trim()
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in explore_knowledge_graph', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Hybrid memory search with graph expansion
 */
export const hybridMemorySearch = {
  name: 'hybrid_memory_search',
  description: 'Advanced memory search using both vector similarity and knowledge graph expansion',
  inputSchema: {
    type: 'object',
    properties: {
      personaId: {
        type: 'string',
        description: 'UUID of the persona to search memories for'
      },
      query: {
        type: 'string',
        description: 'Search query (1-1000 characters)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (1-50, default: 5)'
      },
      threshold: {
        type: 'number',
        description: 'Minimum similarity threshold (0-1, default: 0.7)'
      },
      memoryTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['conversation', 'fact', 'preference', 'context', 'system']
        },
        description: 'Filter by memory types'
      },
      includeContext: {
        type: 'boolean',
        description: 'Include context information in results (default: true)'
      },
      useGraphExpansion: {
        type: 'boolean',
        description: 'Enable graph-based expansion (default: true)'
      },
      graphDepth: {
        type: 'number',
        description: 'Graph traversal depth (1-5, default: 2)'
      },
      graphWeight: {
        type: 'number',
        description: 'Weight for graph-based results (0-1, default: 0.3)'
      }
    },
    required: ['personaId', 'query']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(graphSchemas.hybridMemorySearch, params, 'hybrid_memory_search');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { personaId, ...searchParams } = validation.value;

      // Perform hybrid search via API
      const result = await apiClient.post(`/api/personas/${personaId}/memories/search/hybrid`, searchParams);

      if (!result.success) {
        logger.error('Hybrid memory search failed', {
          error: result.error,
          message: result.message,
          personaId
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to perform hybrid search: ${result.message}\n\n💡 ${result.suggestion || 'Please check the persona ID and search query.'}`
          }],
          isError: true
        };
      }

      const { memories, options, meta } = result.data;
      logger.info('Hybrid memory search completed', {
        resultsCount: memories.length,
        expansionRate: meta.expansionRate,
        personaId
      });

      if (memories.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `🔍 No memories found for "${searchParams.query}" above threshold ${searchParams.threshold || 0.7}\n\n💡 Try lowering the threshold or using different search terms.`
          }]
        };
      }

      let resultText = `🧠 **Hybrid Memory Search Results**\n\n`;
      resultText += `👤 **Persona:** ${personaId}\n`;
      resultText += `🔍 **Query:** "${searchParams.query}"\n`;
      resultText += `📊 **Found:** ${meta.count} memories\n`;
      resultText += `🎯 **Avg Similarity:** ${meta.avgSimilarity}\n`;
      resultText += `🌐 **Graph Expansion:** ${meta.expansionRate} (${meta.graphExpandedResults} enhanced)\n`;
      resultText += `⚙️ **Graph Enabled:** ${options.useGraphExpansion ? '✅' : '❌'}\n\n`;

      memories.forEach((memory, index) => {
        resultText += `**${index + 1}. Memory ${memory.id}**\n`;
        resultText += `• **Similarity:** ${memory.similarity.toFixed(4)}`;
        
        // Indicate if this result was enhanced by graph expansion
        if (memory.graphExpanded) {
          resultText += ` 🌐 (graph enhanced)`;
        }
        if (memory.graphBoosted) {
          resultText += ` ⬆️ (graph boosted)`;
        }
        resultText += '\n';
        
        resultText += `• **Type:** ${memory.metadata.memoryType}\n`;
        resultText += `• **Importance:** ${memory.metadata.importance}\n`;
        
        // Show content preview
        const content = memory.metadata?.originalContent || 
                       memory.metadata?.content || 
                       memory.content || 
                       (memory.metadata?.customMetadata?.originalContent);
        
        if (content && typeof content === 'string' && content.trim().length > 0) {
          const preview = content.length > 150 ? content.substring(0, 150) + '...' : content;
          resultText += `• **Content:** ${preview}\n`;
        }
        
        if (memory.metadata.timestamp) {
          resultText += `• **Created:** ${formatTimestamp(memory.metadata.timestamp, 'date')}\n`;
        }
        
        // Show graph context if available
        if (memory.graphContext && memory.graphContext.length > 0) {
          const entityNames = memory.graphContext.slice(0, 3).map(e => e.name);
          resultText += `• **Graph Context:** ${entityNames.join(', ')}${memory.graphContext.length > 3 ? '...' : ''}\n`;
        }
        
        if (searchParams.includeContext && memory.metadata.context) {
          const contextKeys = Object.keys(memory.metadata.context);
          if (contextKeys.length > 0) {
            resultText += `• **Context:** ${contextKeys.slice(0, 3).join(', ')}${contextKeys.length > 3 ? '...' : ''}\n`;
          }
        }
        
        resultText += '\n';
      });

      // Add explanation of hybrid search benefits
      if (options.useGraphExpansion && meta.graphExpandedResults > 0) {
        resultText += `💡 **Graph Enhancement:** ${meta.graphExpandedResults} results were enhanced using knowledge graph context, improving relevance and discovering connected information.`;
      }

      return {
        content: [{
          type: 'text',
          text: resultText.trim()
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in hybrid_memory_search', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Get graph context for entities
 */
export const getGraphContext = {
  name: 'get_graph_context',
  description: 'Get detailed context and relationships for specific entities in the knowledge graph',
  inputSchema: {
    type: 'object',
    properties: {
      personaId: {
        type: 'string',
        description: 'UUID of the persona'
      },
      entityIds: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Array of entity IDs to get context for (1-50 entities)'
      },
      includeRelationships: {
        type: 'boolean',
        description: 'Include relationship information (default: true)'
      },
      maxRelationships: {
        type: 'number',
        description: 'Maximum relationships to return (1-100, default: 20)'
      },
      relationshipDepth: {
        type: 'number',
        description: 'Relationship traversal depth (1-3, default: 1)'
      }
    },
    required: ['personaId', 'entityIds']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(graphSchemas.getGraphContext, params, 'get_graph_context');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { personaId, ...contextParams } = validation.value;

      // Get graph context via API
      const result = await apiClient.post(`/api/personas/${personaId}/graph/context`, contextParams);

      if (!result.success) {
        logger.error('Graph context retrieval failed', {
          error: result.error,
          message: result.message,
          personaId
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to get graph context: ${result.message}\n\n💡 ${result.suggestion || 'Please check the persona ID and entity IDs.'}`
          }],
          isError: true
        };
      }

      const { context, options, meta } = result.data;
      logger.info('Graph context retrieved', {
        entitiesFound: meta.entitiesFound,
        relationshipsFound: meta.relationshipsFound,
        personaId
      });

      let resultText = `🌐 **Graph Context**\n\n`;
      resultText += `👤 **Persona:** ${personaId}\n`;
      resultText += `📊 **Entities:** ${meta.entitiesFound} found (${contextParams.entityIds.length} requested)\n`;
      resultText += `🔗 **Relationships:** ${meta.relationshipsFound}\n`;
      resultText += `🎯 **Direct Connections:** ${meta.directConnections}\n\n`;

      // Show entities
      if (context.entities && context.entities.length > 0) {
        resultText += `**🏷️ Entities:**\n`;
        context.entities.forEach((entity, index) => {
          resultText += `${index + 1}. **${entity.name}** (${entity.type})\n`;
          resultText += `   • ID: ${entity.id}\n`;
          resultText += `   • Confidence: ${(entity.confidence * 100).toFixed(1)}%\n`;
          if (entity.relationshipCount) {
            resultText += `   • Relationships: ${entity.relationshipCount}\n`;
          }
        });
        resultText += '\n';
      }

      // Show relationships
      if (options.includeRelationships && context.relationships && context.relationships.length > 0) {
        resultText += `**🔗 Relationships:**\n`;
        context.relationships.slice(0, 10).forEach((rel, index) => {
          const sourceName = context.entities.find(e => e.id === rel.source_entity_id)?.name || rel.source_entity_id;
          const targetName = context.entities.find(e => e.id === rel.target_entity_id)?.name || rel.target_entity_id;
          
          resultText += `${index + 1}. **${sourceName}** → *${rel.relationship_type}* → **${targetName}**\n`;
          resultText += `   • Strength: ${(rel.strength * 100).toFixed(1)}%\n`;
          if (rel.context) {
            resultText += `   • Context: ${rel.context.substring(0, 50)}${rel.context.length > 50 ? '...' : ''}\n`;
          }
        });
        
        if (context.relationships.length > 10) {
          resultText += `   ... and ${context.relationships.length - 10} more relationships\n`;
        }
        resultText += '\n';
      }

      // Show connections if available
      if (context.connections && context.connections.length > 0) {
        resultText += `**🌟 Key Connections:**\n`;
        context.connections.slice(0, 5).forEach((connection, index) => {
          const entitiesText = connection.entities && Array.isArray(connection.entities) 
            ? connection.entities.join(' ↔ ') 
            : 'Connection data';
          resultText += `${index + 1}. ${connection.description || entitiesText}\n`;
          if (connection.strength) {
            resultText += `   • Strength: ${(connection.strength * 100).toFixed(1)}%\n`;
          }
        });
      }

      return {
        content: [{
          type: 'text',
          text: resultText.trim()
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in get_graph_context', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Get persona knowledge graph statistics
 */
export const getGraphStats = {
  name: 'get_graph_stats',
  description: 'Get comprehensive statistics about a persona\'s knowledge graph',
  inputSchema: {
    type: 'object',
    properties: {
      personaId: {
        type: 'string',
        description: 'UUID of the persona'
      }
    },
    required: ['personaId']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(graphSchemas.getGraphStats, params, 'get_graph_stats');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { personaId } = validation.value;

      // Get graph stats via API
      const result = await apiClient.get(`/api/personas/${personaId}/graph/stats`);

      if (!result.success) {
        logger.error('Graph stats retrieval failed', {
          error: result.error,
          message: result.message,
          personaId
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to get graph statistics: ${result.message}\n\n💡 ${result.suggestion || 'Please check the persona ID.'}`
          }],
          isError: true
        };
      }

      const { knowledgeGraph, hybridFeatures, performance } = result.data;
      logger.info('Graph statistics retrieved', {
        totalEntities: knowledgeGraph.totalEntities,
        totalRelationships: knowledgeGraph.totalRelationships,
        personaId
      });

      let resultText = `📊 **Knowledge Graph Statistics**\n\n`;
      resultText += `👤 **Persona:** ${personaId}\n\n`;

      // Graph overview
      resultText += `**🌐 Graph Overview:**\n`;
      resultText += `• **Entities:** ${knowledgeGraph.totalEntities}\n`;
      resultText += `• **Relationships:** ${knowledgeGraph.totalRelationships}\n`;
      
      const graphDensity = typeof knowledgeGraph.graphDensity === 'number' 
        ? (knowledgeGraph.graphDensity * 100).toFixed(2) 
        : 'N/A';
      resultText += `• **Graph Density:** ${graphDensity}%\n`;
      
      const avgRelations = typeof knowledgeGraph.averageRelationshipsPerEntity === 'number'
        ? knowledgeGraph.averageRelationshipsPerEntity.toFixed(1)
        : 'N/A';
      resultText += `• **Avg Relations/Entity:** ${avgRelations}\n`;
      resultText += `• **Complexity:** ${knowledgeGraph.graphComplexity}\n\n`;

      // Entity type breakdown
      if (knowledgeGraph.entityTypes && knowledgeGraph.entityTypes.length > 0) {
        resultText += `**🏷️ Entity Types:**\n`;
        knowledgeGraph.entityTypes.forEach(type => {
          const percentage = typeof type.percentage === 'number' 
            ? type.percentage.toFixed(1) 
            : 'N/A';
          const typeName = type.type || 'Unknown Entity Type';
          resultText += `• ${typeName}: ${type.count} (${percentage}%)\n`;
        });
        resultText += '\n';
      }

      // Relationship type breakdown
      if (knowledgeGraph.relationshipTypes && knowledgeGraph.relationshipTypes.length > 0) {
        resultText += `**🔗 Relationship Types:**\n`;
        knowledgeGraph.relationshipTypes.forEach(type => {
          const percentage = typeof type.percentage === 'number' 
            ? type.percentage.toFixed(1) 
            : 'N/A';
          const typeName = type.type || 'Unknown Relationship Type';
          resultText += `• ${typeName}: ${type.count} (${percentage}%)\n`;
        });
        resultText += '\n';
      }

      // Hybrid features
      resultText += `**🚀 Hybrid Features:**\n`;
      resultText += `• **Graph Enabled:** ${hybridFeatures.graphEnabled ? '✅' : '❌'}\n`;
      resultText += `• **Entities Extracted:** ${hybridFeatures.entitiesExtracted}\n`;
      resultText += `• **Relationships Created:** ${hybridFeatures.relationshipsCreated}\n`;
      resultText += `• **Hybrid Searches:** ${hybridFeatures.hybridSearches}\n`;
      resultText += `• **Graph Expansions:** ${hybridFeatures.graphExpansions}\n\n`;

      // Performance metrics
      resultText += `**⚡ Performance:**\n`;
      resultText += `• **Avg Graph Processing:** ${performance.avgGraphProcessingTime}\n`;
      resultText += `• **Total Hybrid Searches:** ${performance.totalHybridSearches}\n`;
      resultText += `• **Total Graph Expansions:** ${performance.totalGraphExpansions}\n`;
      resultText += `• **Expansion Success Rate:** ${performance.expansionSuccessRate}\n`;

      // Health assessment
      if (knowledgeGraph.totalEntities === 0) {
        resultText += `\n💡 **Recommendation:** No entities found. Add some memories to start building the knowledge graph.`;
      } else if (knowledgeGraph.totalRelationships === 0) {
        resultText += `\n💡 **Recommendation:** Entities exist but no relationships. Add more related content to build connections.`;
      } else if (knowledgeGraph.graphComplexity === 'low') {
        resultText += `\n💡 **Recommendation:** Simple graph structure. Consider adding more diverse content to increase complexity.`;
      } else {
        resultText += `\n✅ **Status:** Knowledge graph is well-developed and ready for advanced queries.`;
      }

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in get_graph_stats', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Get all relationships in a persona's knowledge graph
 */
export const getPersonaRelationships = {
  name: 'get_persona_relationships',
  description: 'Get all relationships in a persona\'s knowledge graph with filtering and pagination',
  inputSchema: {
    type: 'object',
    properties: {
      personaId: {
        type: 'string',
        description: 'UUID of the persona'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of relationships to return (1-500, default: 50)'
      },
      offset: {
        type: 'number',
        description: 'Number of relationships to skip for pagination (default: 0)'
      },
      relationshipTypes: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Filter by specific relationship types'
      },
      entityTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['PERSON', 'CONCEPT', 'EVENT', 'OBJECT', 'PLACE']
        },
        description: 'Filter by entity types involved in relationships'
      },
      minStrength: {
        type: 'number',
        description: 'Minimum relationship strength (0-1, default: 0)'
      },
      maxStrength: {
        type: 'number',
        description: 'Maximum relationship strength (0-1, default: 1)'
      },
      includeEntityDetails: {
        type: 'boolean',
        description: 'Include detailed entity information (default: false)'
      },
      sortBy: {
        type: 'string',
        enum: ['strength', 'created_at', 'updated_at', 'relationship_type'],
        description: 'Sort field (default: strength)'
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort order (default: desc)'
      }
    },
    required: ['personaId']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(graphSchemas.getPersonaRelationships, params, 'get_persona_relationships');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { personaId, ...queryParams } = validation.value;

      // Get relationships via API
      const result = await apiClient.get(`/api/personas/${personaId}/graph/relationships`, queryParams);

      if (!result.success) {
        logger.error('Persona relationships retrieval failed', {
          error: result.error,
          message: result.message,
          personaId
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to get persona relationships: ${result.message}\n\n💡 ${result.suggestion || 'Please check the persona ID and try again.'}`
          }],
          isError: true
        };
      }

      const { relationships, meta, options } = result.data;
      logger.info('Persona relationships retrieved', {
        relationshipsCount: relationships.length,
        totalFound: meta.total,
        personaId
      });

      if (relationships.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `🔍 No relationships found for persona ${personaId}\n\n💡 This persona may not have any graph relationships yet. Try adding memories with entity content to build the knowledge graph.`
          }]
        };
      }

      let resultText = `🔗 **Persona Knowledge Graph Relationships**\n\n`;
      resultText += `👤 **Persona:** ${personaId}\n`;
      resultText += `📊 **Results:** ${meta.returned} of ${meta.total} relationships\n`;
      resultText += `📄 **Page:** ${Math.floor(options.offset / options.limit) + 1}\n`;
      resultText += `⚙️ **Sorted by:** ${options.sortBy} (${options.sortOrder})\n`;
      
      if (meta.statistics) {
        const stats = meta.statistics;
        if (stats.relationshipTypes && stats.relationshipTypes.length > 0) {
          resultText += `🏷️ **Types:** ${stats.relationshipTypes.join(', ')}\n`;
        }
        if (stats.entityTypes && stats.entityTypes.length > 0) {
          resultText += `📦 **Entity Types:** ${stats.entityTypes.join(', ')}\n`;
        }
        if (typeof stats.avgStrength === 'number') {
          resultText += `💪 **Avg Strength:** ${(stats.avgStrength * 100).toFixed(1)}%\n`;
        }
      }
      resultText += '\n';

      relationships.forEach((rel, index) => {
        const num = options.offset + index + 1;
        resultText += `**${num}. ${rel.relationshipType}**\n`;
        
        // Entity names or IDs
        const sourceName = rel.sourceEntity?.name || rel.sourceEntityId;
        const targetName = rel.targetEntity?.name || rel.targetEntityId;
        
        resultText += `• **Connection:** ${sourceName} → ${targetName}\n`;
        resultText += `• **Strength:** ${(rel.strength * 100).toFixed(1)}%\n`;
        resultText += `• **ID:** ${rel.id}\n`;
        
        if (rel.context && rel.context.trim().length > 0) {
          const context = rel.context.length > 100 ? rel.context.substring(0, 100) + '...' : rel.context;
          resultText += `• **Context:** ${context}\n`;
        }
        
        // Entity details if requested
        if (options.includeEntityDetails) {
          if (rel.sourceEntity) {
            resultText += `• **Source Entity:** ${rel.sourceEntity.name} (${rel.sourceEntity.type})\n`;
            if (rel.sourceEntity.confidence) {
              resultText += `  - Confidence: ${(rel.sourceEntity.confidence * 100).toFixed(1)}%\n`;
            }
          }
          if (rel.targetEntity) {
            resultText += `• **Target Entity:** ${rel.targetEntity.name} (${rel.targetEntity.type})\n`;
            if (rel.targetEntity.confidence) {
              resultText += `  - Confidence: ${(rel.targetEntity.confidence * 100).toFixed(1)}%\n`;
            }
          }
        }
        
        if (rel.createdAt) {
          resultText += `• **Created:** ${formatTimestamp(rel.createdAt, 'date')}\n`;
        }
        
        resultText += '\n';
      });

      // Pagination info
      if (meta.hasMore) {
        const nextOffset = options.offset + options.limit;
        resultText += `📖 **More Results:** Use offset=${nextOffset} to see the next page\n`;
      }

      // Statistics summary
      if (meta.statistics && meta.statistics.strongRelationships > 0) {
        resultText += `\n💪 **Strong Relationships:** ${meta.statistics.strongRelationships} relationships above 70% strength`;
      }

      return {
        content: [{
          type: 'text',
          text: resultText.trim()
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in get_persona_relationships', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Export all graph tools
export const graphTools = [
  exploreKnowledgeGraph,
  hybridMemorySearch,
  getGraphContext,
  getGraphStats,
  getPersonaRelationships
];
