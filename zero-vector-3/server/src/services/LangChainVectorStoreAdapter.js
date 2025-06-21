const { VectorStore } = require('@langchain/core/vectorstores');
const { Document } = require('@langchain/core/documents');
const { Embeddings } = require('@langchain/core/embeddings');
const { logger, logError } = require('../utils/logger');

/**
 * Zero-Vector Embeddings Wrapper
 * Wraps Zero-Vector embedding service to work with LangChain
 */
class ZeroVectorEmbeddings extends Embeddings {
  constructor(embeddingService) {
    super({});
    this.embeddingService = embeddingService;
  }

  async embedDocuments(documents) {
    const embeddings = [];
    for (const doc of documents) {
      const result = await this.embeddingService.generateEmbedding(doc, {
        provider: this.embeddingService.defaultProvider,
        useCache: true
      });
      embeddings.push(result.vector);
    }
    return embeddings;
  }

  async embedQuery(query) {
    const result = await this.embeddingService.generateEmbedding(query, {
      provider: this.embeddingService.defaultProvider,
      useCache: true
    });
    return result.vector;
  }
}

/**
 * LangChain VectorStore Adapter
 * Bridges Zero-Vector HybridVectorStore with LangChain's VectorStore interface
 */
class LangChainVectorStoreAdapter extends VectorStore {
  constructor(hybridVectorStore, embeddingService) {
    const embeddings = new ZeroVectorEmbeddings(embeddingService);
    super(embeddings, {});
    this.hybridVectorStore = hybridVectorStore;
    this.embeddingService = embeddingService;
    this.embeddings = embeddings;
    
    logger.info('LangChain VectorStore adapter initialized', {
      vectorStoreType: hybridVectorStore.constructor.name,
      graphEnabled: hybridVectorStore.graphEnabled || false
    });
  }

  _vectorstoreType() {
    return 'zero-vector-hybrid';
  }

  /**
   * Add documents to the vector store
   */
  async addDocuments(documents, options = {}) {
    try {
      const results = [];
      
      for (const doc of documents) {
        // Extract metadata for vector store compatibility
        const metadata = {
          ...doc.metadata,
          source: doc.metadata.source || 'langchain',
          page_content: doc.pageContent,
          langchain_document: true
        };

        // Use the hybrid vector store's addVector method
        const result = await this.hybridVectorStore.addVector(
          doc.pageContent,
          null, // Let the vector store generate the embedding
          metadata,
          options
        );

        results.push({
          id: result.id,
          content: doc.pageContent,
          metadata: metadata
        });
      }

      logger.info('Added documents to vector store via LangChain adapter', {
        documentCount: documents.length,
        successCount: results.length
      });

      return results.map(r => r.id);

    } catch (error) {
      logError(error, {
        operation: 'langchainAddDocuments',
        documentCount: documents.length
      });
      throw error;
    }
  }

  /**
   * Add vectors directly
   */
  async addVectors(vectors, documents, options = {}) {
    try {
      const results = [];
      
      for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        const doc = documents[i];
        
        const metadata = {
          ...doc.metadata,
          source: doc.metadata.source || 'langchain',
          page_content: doc.pageContent,
          langchain_document: true
        };

        const result = await this.hybridVectorStore.addVector(
          doc.pageContent,
          vector,
          metadata,
          options
        );

        results.push({
          id: result.id,
          content: doc.pageContent,
          metadata: metadata
        });
      }

      logger.info('Added vectors to vector store via LangChain adapter', {
        vectorCount: vectors.length,
        successCount: results.length
      });

      return results.map(r => r.id);

    } catch (error) {
      logError(error, {
        operation: 'langchainAddVectors',
        vectorCount: vectors.length
      });
      throw error;
    }
  }

  /**
   * Similarity search with LangChain Document format
   */
  async similaritySearch(query, k = 4, filter = {}, options = {}) {
    try {
      // Generate query embedding if needed
      let queryEmbedding;
      if (typeof query === 'string') {
        const embeddingResult = await this.embeddingService.generateEmbedding(query, {
          provider: options.provider || this.embeddingService.defaultProvider,
          useCache: true
        });
        queryEmbedding = embeddingResult.vector;
      } else {
        queryEmbedding = query;
      }

      // Use hybrid search if enabled
      const searchOptions = {
        limit: k,
        threshold: options.threshold || 0.7,
        metric: 'cosine',
        filters: filter,
        includeValues: false,
        includeMetadata: true,
        useIndex: true,
        useGraphExpansion: options.useGraphExpansion !== false,
        graphDepth: options.graphDepth || 2,
        graphWeight: options.graphWeight || 0.3,
        personaId: filter.personaId || filter.persona_id
      };

      const results = await this.hybridVectorStore.hybridSearch(queryEmbedding, searchOptions);

      // Convert to LangChain Document format
      const documents = results.map(result => new Document({
        pageContent: result.content || result.metadata.page_content,
        metadata: {
          ...result.metadata,
          similarity: result.similarity,
          id: result.id,
          source: result.metadata.source || 'zero-vector',
          graphExpanded: result.graphExpanded,
          graphBoosted: result.graphBoosted
        }
      }));

      logger.debug('Similarity search completed via LangChain adapter', {
        query: typeof query === 'string' ? query.substring(0, 50) : 'vector',
        resultCount: documents.length,
        avgSimilarity: results.length > 0 
          ? (results.reduce((sum, r) => sum + r.similarity, 0) / results.length).toFixed(3)
          : 0,
        graphExpansionUsed: results.some(r => r.graphExpanded || r.graphBoosted)
      });

      return documents;

    } catch (error) {
      logError(error, {
        operation: 'langchainSimilaritySearch',
        query: typeof query === 'string' ? query.substring(0, 100) : 'vector',
        k,
        filter
      });
      throw error;
    }
  }

  /**
   * Similarity search with scores
   */
  async similaritySearchWithScore(query, k = 4, filter = {}, options = {}) {
    try {
      const documents = await this.similaritySearch(query, k, filter, options);
      
      // Return documents with scores
      return documents.map(doc => [
        doc,
        doc.metadata.similarity || 0
      ]);

    } catch (error) {
      logError(error, {
        operation: 'langchainSimilaritySearchWithScore',
        query: typeof query === 'string' ? query.substring(0, 100) : 'vector',
        k,
        filter
      });
      throw error;
    }
  }

  /**
   * Maximum marginal relevance search
   */
  async maxMarginalRelevanceSearch(query, options = {}) {
    try {
      const {
        k = 4,
        fetchK = 20,
        lambda = 0.5,
        filter = {}
      } = options;

      // First, get more results than needed
      const initialResults = await this.similaritySearch(query, fetchK, filter, options);
      
      if (initialResults.length === 0) {
        return [];
      }

      // Implement MMR algorithm
      const selected = [];
      const remaining = [...initialResults];
      
      // Select the first (most similar) document
      if (remaining.length > 0) {
        selected.push(remaining.shift());
      }
      
      // Select remaining documents based on MMR criteria
      while (selected.length < k && remaining.length > 0) {
        let bestIndex = 0;
        let bestScore = -Infinity;
        
        for (let i = 0; i < remaining.length; i++) {
          const candidate = remaining[i];
          const relevanceScore = candidate.metadata.similarity || 0;
          
          // Calculate maximum similarity to already selected documents
          let maxSimilarity = 0;
          for (const selectedDoc of selected) {
            // Simple cosine similarity approximation based on relevance scores
            const similarity = Math.min(
              relevanceScore,
              selectedDoc.metadata.similarity || 0
            );
            maxSimilarity = Math.max(maxSimilarity, similarity);
          }
          
          // MMR score: balance between relevance and diversity
          const mmrScore = lambda * relevanceScore - (1 - lambda) * maxSimilarity;
          
          if (mmrScore > bestScore) {
            bestScore = mmrScore;
            bestIndex = i;
          }
        }
        
        selected.push(remaining.splice(bestIndex, 1)[0]);
      }

      logger.debug('MMR search completed via LangChain adapter', {
        query: typeof query === 'string' ? query.substring(0, 50) : 'vector',
        requestedK: k,
        fetchK,
        lambda,
        selectedCount: selected.length
      });

      return selected;

    } catch (error) {
      logError(error, {
        operation: 'langchainMaxMarginalRelevanceSearch',
        query: typeof query === 'string' ? query.substring(0, 100) : 'vector',
        options
      });
      throw error;
    }
  }

  /**
   * Delete documents by IDs
   */
  async delete(options = {}) {
    try {
      const { ids, filter } = options;
      
      if (ids && ids.length > 0) {
        // Delete specific IDs
        let deletedCount = 0;
        for (const id of ids) {
          try {
            await this.hybridVectorStore.deleteVector(id);
            deletedCount++;
          } catch (error) {
            logger.warn('Failed to delete vector', { id, error: error.message });
          }
        }
        
        logger.info('Deleted vectors by IDs via LangChain adapter', {
          requestedIds: ids.length,
          deletedCount
        });
        
        return deletedCount;
      } else if (filter) {
        // Delete by filter - would need to implement in HybridVectorStore
        logger.warn('Delete by filter not yet implemented in HybridVectorStore');
        return 0;
      }
      
      return 0;

    } catch (error) {
      logError(error, {
        operation: 'langchainDelete',
        options
      });
      throw error;
    }
  }

  /**
   * Get vector store statistics
   */
  async getStats() {
    try {
      const hybridStats = this.hybridVectorStore.getStats();
      
      return {
        vectorCount: hybridStats.vectorCount,
        indexedCount: hybridStats.indexedCount || 0,
        graphEnabled: hybridStats.graphEnabled || false,
        hybridFeatures: hybridStats.hybrid || {},
        langchainAdapter: {
          adapterVersion: '1.0.0',
          documentsAdded: hybridStats.documentsAdded || 0,
          searchesPerformed: hybridStats.searchesPerformed || 0
        }
      };

    } catch (error) {
      logError(error, {
        operation: 'langchainGetStats'
      });
      return {
        vectorCount: 0,
        indexedCount: 0,
        graphEnabled: false,
        error: error.message
      };
    }
  }

  /**
   * Create a LangChain retriever from this vector store
   */
  asRetriever(options = {}) {
    const {
      searchType = 'similarity',
      searchKwargs = {}
    } = options;

    return {
      getRelevantDocuments: async (query) => {
        switch (searchType) {
          case 'similarity':
            return await this.similaritySearch(query, searchKwargs.k || 4, searchKwargs.filter || {}, searchKwargs);
          
          case 'similarity_score_threshold':
            const docs = await this.similaritySearchWithScore(query, searchKwargs.k || 4, searchKwargs.filter || {}, searchKwargs);
            const threshold = searchKwargs.scoreThreshold || 0.7;
            return docs.filter(([doc, score]) => score >= threshold).map(([doc]) => doc);
          
          case 'mmr':
            return await this.maxMarginalRelevanceSearch(query, searchKwargs);
          
          default:
            throw new Error(`Unknown search type: ${searchType}`);
        }
      }
    };
  }

  /**
   * Static factory method
   */
  static fromHybridVectorStore(hybridVectorStore, embeddingService) {
    return new LangChainVectorStoreAdapter(hybridVectorStore, embeddingService);
  }
}

module.exports = LangChainVectorStoreAdapter;
