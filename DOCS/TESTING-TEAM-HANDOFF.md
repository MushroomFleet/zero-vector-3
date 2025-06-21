# TESTING-TEAM-HANDOFF.md: Zero Vector 2.0 Testing Guide

## Overview

This document provides comprehensive testing instructions for Zero Vector 2.0's hybrid vector-graph capabilities. The testing team should execute these tests to validate the system's functionality, performance, and reliability before production deployment.

## Test Environment Setup

### Prerequisites
```bash
# 1. Ensure Node.js 18+ is installed
node --version

# 2. Install dependencies
cd zero-vector/server && npm install
cd ../../MCP && npm install

# 3. Set up test database
npm run setup-database

# 4. Configure environment variables for testing
cp .env.example .env.test
```

### Environment Variables for Testing
```bash
# Core system
NODE_ENV=test
PORT=3001
DB_PATH=./data/test_vectordb.sqlite

# Enable all v2.0 features for testing
GRAPH_ENABLED=true
FEATURE_HYBRID_SEARCH=true
FEATURE_ENTITY_EXTRACTION=true
FEATURE_GRAPH_EXPANSION=true

# Test-specific settings
ENTITY_CONFIDENCE_THRESHOLD=0.5
GRAPH_DEFAULT_DEPTH=2
DEFAULT_GRAPH_WEIGHT=0.3
MAX_GRAPH_PROCESSING_TIME_MS=5000

# Performance testing
ENABLE_GRAPH_METRICS=true
GRAPH_CACHE_ENABLED=true
```

## Unit Testing Specifications

### 1. Graph Database Service Tests

**File:** `tests/unit/GraphDatabaseService.test.js`

```javascript
describe('GraphDatabaseService', () => {
  // Test entity CRUD operations
  test('should create entity with valid data', async () => {
    const entity = {
      personaId: 'test-persona-1',
      type: 'PERSON',
      name: 'John Doe',
      properties: { age: 30 },
      confidence: 0.8
    };
    
    const result = await graphService.createEntity(entity.personaId, entity);
    
    expect(result.id).toBeDefined();
    expect(result.name).toBe('John Doe');
    expect(result.confidence).toBe(0.8);
  });

  test('should create relationship between entities', async () => {
    const relationship = {
      sourceEntityId: 'entity-1',
      targetEntityId: 'entity-2',
      relationshipType: 'KNOWS',
      strength: 0.7,
      context: 'Met at conference'
    };
    
    const result = await graphService.createRelationship('test-persona-1', relationship);
    
    expect(result.id).toBeDefined();
    expect(result.relationship_type).toBe('KNOWS');
    expect(result.strength).toBe(0.7);
  });

  test('should find related entities within depth limit', async () => {
    const results = await graphService.findRelatedEntities('entity-1', 2);
    
    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);
    // Validate depth constraint
    results.forEach(entity => {
      expect(entity.depth).toBeLessThanOrEqual(2);
    });
  });

  test('should handle invalid entity creation gracefully', async () => {
    const invalidEntity = {
      personaId: '',
      type: 'INVALID_TYPE',
      name: '',
      confidence: 1.5 // Invalid confidence > 1
    };
    
    await expect(graphService.createEntity(invalidEntity.personaId, invalidEntity))
      .rejects.toThrow();
  });
});
```

### 2. Entity Extractor Tests

**File:** `tests/unit/EntityExtractor.test.js`

```javascript
describe('EntityExtractor', () => {
  test('should extract person entities from text', async () => {
    const text = "John Smith works at Microsoft and knows Sarah Johnson.";
    const entities = await entityExtractor.extractEntities(text, 'test-persona-1');
    
    const personEntities = entities.filter(e => e.type === 'PERSON');
    expect(personEntities.length).toBeGreaterThanOrEqual(2);
    
    const names = personEntities.map(e => e.name);
    expect(names).toContain('John Smith');
    expect(names).toContain('Sarah Johnson');
  });

  test('should extract organization entities', async () => {
    const text = "Apple Inc. and Google are major tech companies.";
    const entities = await entityExtractor.extractEntities(text, 'test-persona-1');
    
    const orgEntities = entities.filter(e => e.type === 'ORGANIZATION');
    expect(orgEntities.length).toBeGreaterThanOrEqual(2);
  });

  test('should respect confidence threshold', async () => {
    const text = "Maybe John could be a person.";
    const entities = await entityExtractor.extractEntities(text, 'test-persona-1');
    
    entities.forEach(entity => {
      expect(entity.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  test('should limit entities per memory', async () => {
    const longText = Array(50).fill("Person Name").join(", ");
    const entities = await entityExtractor.extractEntities(longText, 'test-persona-1');
    
    expect(entities.length).toBeLessThanOrEqual(10); // MAX_ENTITIES_PER_MEMORY
  });
});
```

### 3. Hybrid Vector Store Tests

**File:** `tests/unit/HybridVectorStore.test.js`

```javascript
describe('HybridVectorStore', () => {
  test('should maintain vector store functionality', async () => {
    const vector = new Float32Array(1536).fill(0.1);
    const metadata = { personaId: 'test-persona-1', originalContent: 'Test content' };
    
    const result = await hybridStore.addVector(vector, 'test-vector-1', metadata);
    expect(result.success).toBe(true);
    
    const searchResults = await hybridStore.search(vector, { limit: 5 });
    expect(searchResults.length).toBeGreaterThan(0);
  });

  test('should perform hybrid search with graph expansion', async () => {
    const queryVector = new Float32Array(1536).fill(0.2);
    const options = {
      useGraphExpansion: true,
      graphDepth: 2,
      limit: 5
    };
    
    const results = await hybridStore.hybridSearch(queryVector, options);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('similarity');
    expect(results[0]).toHaveProperty('graphExpanded');
  });

  test('should fall back to vector-only search when graph disabled', async () => {
    const queryVector = new Float32Array(1536).fill(0.2);
    const options = { useGraphExpansion: false };
    
    const results = await hybridStore.hybridSearch(queryVector, options);
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.graphExpanded).toBeFalsy();
    });
  });

  test('should respect performance timeout limits', async () => {
    const startTime = Date.now();
    const queryVector = new Float32Array(1536).fill(0.3);
    
    await hybridStore.hybridSearch(queryVector, { useGraphExpansion: true });
    
    const executionTime = Date.now() - startTime;
    expect(executionTime).toBeLessThan(5000); // MAX_GRAPH_PROCESSING_TIME_MS
  });
});
```

### 4. Feature Flags Tests

**File:** `tests/unit/featureFlags.test.js`

```javascript
describe('FeatureFlags', () => {
  test('should return correct flag states', () => {
    expect(featureFlags.isEnabled('hybridSearch')).toBe(true);
    expect(featureFlags.isEnabled('graphEnabled')).toBe(true);
    expect(featureFlags.isEnabled('nonexistentFlag')).toBe(false);
  });

  test('should handle runtime overrides', () => {
    featureFlags.setRuntimeOverride('hybridSearch', false, 'Test override');
    expect(featureFlags.isEnabled('hybridSearch')).toBe(false);
    
    featureFlags.removeRuntimeOverride('hybridSearch');
    expect(featureFlags.isEnabled('hybridSearch')).toBe(true);
  });

  test('should execute emergency rollback', () => {
    const rollback = featureFlags.emergencyRollback('Test emergency');
    
    expect(rollback.disabledFlags).toContain('hybridSearch');
    expect(rollback.disabledFlags).toContain('graphEnabled');
    expect(featureFlags.isEnabled('hybridSearch')).toBe(false);
  });

  test('should validate hybrid mode detection', () => {
    expect(featureFlags.isHybridModeEnabled()).toBe(true);
    
    featureFlags.setRuntimeOverride('graphEnabled', false);
    expect(featureFlags.isHybridModeEnabled()).toBe(false);
  });
});
```

## Integration Testing Plans

### 1. End-to-End Memory Addition with Graph Processing

**Test:** `tests/integration/memoryAdditionWithGraph.test.js`

```javascript
describe('Memory Addition with Graph Processing', () => {
  test('should add memory and extract entities', async () => {
    const memoryData = {
      content: 'John Smith from Microsoft called about the Azure project. He mentioned working with Sarah Johnson on cloud architecture.',
      type: 'conversation',
      importance: 0.8
    };
    
    // Add memory via API
    const response = await request(app)
      .post('/api/personas/test-persona-1/memories')
      .send(memoryData)
      .expect(201);
    
    // Verify memory was stored
    expect(response.body.data.id).toBeDefined();
    
    // Verify entities were extracted
    const entitiesResponse = await request(app)
      .post('/api/personas/test-persona-1/graph/entities/search')
      .send({ query: 'John Smith', limit: 10 })
      .expect(200);
    
    const entities = entitiesResponse.body.data.entities;
    expect(entities.some(e => e.name === 'John Smith')).toBe(true);
    expect(entities.some(e => e.name === 'Microsoft')).toBe(true);
  });

  test('should create relationships between entities', async () => {
    // Add second memory mentioning same people
    const memoryData = {
      content: 'Sarah Johnson confirmed the meeting with John Smith for next week.',
      type: 'fact',
      importance: 0.7
    };
    
    await request(app)
      .post('/api/personas/test-persona-1/memories')
      .send(memoryData)
      .expect(201);
    
    // Check for relationships
    const contextResponse = await request(app)
      .post('/api/personas/test-persona-1/graph/context')
      .send({ 
        entityIds: ['john-smith-entity-id'], 
        includeRelationships: true 
      })
      .expect(200);
    
    const relationships = contextResponse.body.data.context.relationships;
    expect(relationships.length).toBeGreaterThan(0);
  });
});
```

### 2. Hybrid Memory Search Accuracy

**Test:** `tests/integration/hybridSearchAccuracy.test.js`

```javascript
describe('Hybrid Search Accuracy', () => {
  beforeAll(async () => {
    // Set up test memories with known entities and relationships
    await setupTestPersonaWithMemories();
  });

  test('should improve search results with graph expansion', async () => {
    const searchQuery = 'cloud architecture';
    
    // Vector-only search
    const vectorResults = await request(app)
      .post('/api/personas/test-persona-1/memories/search')
      .send({ 
        query: searchQuery, 
        useGraphExpansion: false,
        limit: 5 
      })
      .expect(200);
    
    // Hybrid search with graph expansion
    const hybridResults = await request(app)
      .post('/api/personas/test-persona-1/memories/search/hybrid')
      .send({ 
        query: searchQuery, 
        useGraphExpansion: true,
        limit: 5 
      })
      .expect(200);
    
    // Hybrid should find more relevant results
    expect(hybridResults.body.data.memories.length).toBeGreaterThanOrEqual(
      vectorResults.body.data.memories.length
    );
    
    // Check for graph enhancement indicators
    const graphEnhanced = hybridResults.body.data.memories.filter(m => m.graphExpanded);
    expect(graphEnhanced.length).toBeGreaterThan(0);
  });

  test('should respect similarity thresholds in hybrid mode', async () => {
    const results = await request(app)
      .post('/api/personas/test-persona-1/memories/search/hybrid')
      .send({ 
        query: 'completely unrelated topic xyz123',
        threshold: 0.8,
        useGraphExpansion: true 
      })
      .expect(200);
    
    results.body.data.memories.forEach(memory => {
      expect(memory.similarity).toBeGreaterThanOrEqual(0.8);
    });
  });
});
```

### 3. API Endpoint Graph Functionality

**Test:** `tests/integration/graphApiEndpoints.test.js`

```javascript
describe('Graph API Endpoints', () => {
  test('GET /api/personas/:id/graph/stats should return statistics', async () => {
    const response = await request(app)
      .get('/api/personas/test-persona-1/graph/stats')
      .expect(200);
    
    const { knowledgeGraph, hybridFeatures, performance } = response.body.data;
    
    expect(knowledgeGraph).toHaveProperty('totalEntities');
    expect(knowledgeGraph).toHaveProperty('totalRelationships');
    expect(knowledgeGraph).toHaveProperty('graphDensity');
    expect(hybridFeatures).toHaveProperty('graphEnabled');
    expect(performance).toHaveProperty('avgGraphProcessingTime');
  });

  test('POST /api/personas/:id/graph/entities/search should find entities', async () => {
    const response = await request(app)
      .post('/api/personas/test-persona-1/graph/entities/search')
      .send({ query: 'John', limit: 10 })
      .expect(200);
    
    const { entities, meta } = response.body.data;
    
    expect(entities).toBeInstanceOf(Array);
    expect(meta).toHaveProperty('count');
    expect(meta).toHaveProperty('types');
    
    entities.forEach(entity => {
      expect(entity).toHaveProperty('id');
      expect(entity).toHaveProperty('name');
      expect(entity).toHaveProperty('type');
      expect(entity).toHaveProperty('confidence');
    });
  });

  test('should handle entity not found gracefully', async () => {
    const response = await request(app)
      .post('/api/personas/test-persona-1/graph/entities/search')
      .send({ query: 'nonexistent_entity_xyz123' })
      .expect(200);
    
    expect(response.body.data.entities).toHaveLength(0);
  });
});
```

## Performance Testing Requirements

### 1. Search Performance Benchmarks

**Target:** Hybrid search should complete in <300ms for 90th percentile

```javascript
describe('Search Performance', () => {
  test('hybrid search performance under load', async () => {
    const searchPromises = [];
    const queryVector = new Float32Array(1536).fill(0.1);
    
    // Generate 100 concurrent searches
    for (let i = 0; i < 100; i++) {
      searchPromises.push(
        hybridStore.hybridSearch(queryVector, { 
          useGraphExpansion: true,
          limit: 5 
        })
      );
    }
    
    const startTime = Date.now();
    const results = await Promise.all(searchPromises);
    const totalTime = Date.now() - startTime;
    
    expect(results.length).toBe(100);
    expect(totalTime / 100).toBeLessThan(300); // Average <300ms
    
    // 90th percentile check (would need more sophisticated timing)
    console.log(`Average search time: ${totalTime / 100}ms`);
  });
});
```

### 2. Memory Addition Performance

**Target:** <10% degradation from v1.0 baseline

```javascript
describe('Memory Addition Performance', () => {
  test('should maintain performance with graph processing enabled', async () => {
    const memories = generateTestMemories(1000);
    
    // Baseline: vector-only mode
    const baselineStart = Date.now();
    for (const memory of memories.slice(0, 500)) {
      await addMemoryVectorOnly(memory);
    }
    const baselineTime = Date.now() - baselineStart;
    
    // Test: hybrid mode with graph processing
    const hybridStart = Date.now();
    for (const memory of memories.slice(500)) {
      await addMemoryHybridMode(memory);
    }
    const hybridTime = Date.now() - hybridStart;
    
    const degradation = (hybridTime - baselineTime) / baselineTime;
    expect(degradation).toBeLessThan(0.10); // <10% degradation
  });
});
```

### 3. System Resource Usage

```javascript
describe('Resource Usage', () => {
  test('should not exceed memory limits under load', async () => {
    const initialMemory = process.memoryUsage();
    
    // Simulate heavy graph processing
    await performIntensiveGraphOperations();
    
    const finalMemory = process.memoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    
    // Memory increase should be reasonable (adjust based on system)
    expect(memoryIncrease).toBeLessThan(500 * 1024 * 1024); // <500MB
  });
});
```

## MCP Tools Testing Guidelines

### 1. Graph Tools Functionality

**Test each MCP tool:**

```bash
# Test explore_knowledge_graph
node MCP/src/index.js --test-tool explore_knowledge_graph \
  --params '{"personaId":"test-persona-1","query":"John Smith","limit":5}'

# Test hybrid_memory_search  
node MCP/src/index.js --test-tool hybrid_memory_search \
  --params '{"personaId":"test-persona-1","query":"cloud project","useGraphExpansion":true}'

# Test get_graph_context
node MCP/src/index.js --test-tool get_graph_context \
  --params '{"personaId":"test-persona-1","entityIds":["entity-1"],"includeRelationships":true}'

# Test get_graph_stats
node MCP/src/index.js --test-tool get_graph_stats \
  --params '{"personaId":"test-persona-1"}'
```

### 2. Tool Input Validation

```javascript
describe('MCP Tool Validation', () => {
  test('should validate required parameters', async () => {
    const result = await callMCPTool('explore_knowledge_graph', {
      // Missing required personaId
      query: 'test query'
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('personaId');
  });

  test('should handle invalid parameter types', async () => {
    const result = await callMCPTool('hybrid_memory_search', {
      personaId: 'test-persona-1',
      query: 'test',
      limit: 'invalid_number' // Should be number
    });
    
    expect(result.isError).toBe(true);
  });
});
```

## Migration Testing Procedures

### 1. Database Migration Validation

```bash
# 1. Backup current database
cp ./data/vectordb.sqlite ./data/vectordb_backup.sqlite

# 2. Run migration script
node scripts/migrate-to-hybrid.js --dry-run

# 3. Verify migration results
node scripts/validate-migration.js

# 4. Test rollback capability
node scripts/rollback-migration.js --to-version=1.0
```

### 2. Data Integrity Checks

```javascript
describe('Migration Data Integrity', () => {
  test('should preserve all existing memories', async () => {
    const preMigrationCount = await getMemoryCount();
    
    await runMigration();
    
    const postMigrationCount = await getMemoryCount();
    expect(postMigrationCount).toBe(preMigrationCount);
  });

  test('should create graph entities for existing memories', async () => {
    const memoriesWithContent = await getMemoriesWithContent();
    
    await runMigration();
    
    const extractedEntities = await getExtractedEntities();
    expect(extractedEntities.length).toBeGreaterThan(0);
    
    // Verify entities link back to memories
    for (const entity of extractedEntities) {
      expect(entity.vector_id).toBeDefined();
    }
  });
});
```

## API Testing with Sample Requests

### 1. Graph Entity Search

```bash
curl -X POST http://localhost:3000/api/personas/test-persona-1/graph/entities/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "query": "John Smith",
    "limit": 10,
    "entityTypes": ["PERSON"],
    "minConfidence": 0.7
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "entities": [
      {
        "id": "entity-uuid",
        "name": "John Smith",
        "type": "PERSON",
        "confidence": 0.85,
        "properties": {},
        "relationshipCount": 3,
        "created_at": 1703097600000
      }
    ],
    "meta": {
      "count": 1,
      "types": ["PERSON"]
    }
  }
}
```

### 2. Hybrid Memory Search

```bash
curl -X POST http://localhost:3000/api/personas/test-persona-1/memories/search/hybrid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "query": "cloud architecture project",
    "limit": 5,
    "threshold": 0.7,
    "useGraphExpansion": true,
    "graphDepth": 2,
    "graphWeight": 0.3
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "memories": [
      {
        "id": "memory-uuid",
        "similarity": 0.85,
        "graphExpanded": true,
        "graphBoosted": true,
        "metadata": {
          "memoryType": "conversation",
          "importance": 0.8,
          "originalContent": "Discussion about cloud architecture..."
        },
        "graphContext": [
          {
            "name": "John Smith",
            "type": "PERSON"
          }
        ]
      }
    ],
    "meta": {
      "count": 5,
      "avgSimilarity": "0.825",
      "expansionRate": "1.2",
      "graphExpandedResults": 3
    },
    "options": {
      "useGraphExpansion": true
    }
  }
}
```

### 3. Graph Statistics

```bash
curl -X GET http://localhost:3000/api/personas/test-persona-1/graph/stats \
  -H "Authorization: Bearer $API_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "knowledgeGraph": {
      "totalEntities": 156,
      "totalRelationships": 234,
      "graphDensity": 0.15,
      "averageRelationshipsPerEntity": 1.5,
      "graphComplexity": "medium",
      "entityTypes": [
        {"type": "PERSON", "count": 45, "percentage": 28.8},
        {"type": "CONCEPT", "count": 67, "percentage": 42.9}
      ],
      "relationshipTypes": [
        {"type": "MENTIONS", "count": 123, "percentage": 52.6},
        {"type": "RELATES_TO", "count": 111, "percentage": 47.4}
      ]
    },
    "hybridFeatures": {
      "graphEnabled": true,
      "entitiesExtracted": 156,
      "relationshipsCreated": 234,
      "hybridSearches": 1247,
      "graphExpansions": 892
    },
    "performance": {
      "avgGraphProcessingTime": "45ms",
      "totalHybridSearches": 1247,
      "totalGraphExpansions": 892,
      "expansionSuccessRate": "89.2%"
    }
  }
}
```

## Rollback Test Scenarios

### 1. Feature Flag Rollback

```javascript
describe('Feature Flag Rollback', () => {
  test('should disable hybrid features via environment variables', async () => {
    // Set rollback environment
    process.env.GRAPH_ENABLED = 'false';
    process.env.FEATURE_HYBRID_SEARCH = 'false';
    
    // Restart application components
    await restartApplication();
    
    // Verify fallback to v1.0 behavior
    const searchResponse = await request(app)
      .post('/api/personas/test-persona-1/memories/search')
      .send({ query: 'test' })
      .expect(200);
    
    // Should not contain graph expansion features
    expect(searchResponse.body.data).not.toHaveProperty('graphContext');
  });

  test('should handle emergency rollback', async () => {
    const rollback = featureFlags.emergencyRollback('Performance issues detected');
    
    expect(rollback.disabledFlags).toContain('hybridSearch');
    expect(rollback.disabledFlags).toContain('graphEnabled');
    
    // Verify system continues to function
    const healthResponse = await request(app)
      .get('/health')
      .expect(200);
    
    expect(healthResponse.body.status).toBe('healthy');
  });
});
```

### 2. Database Rollback

```bash
# Test database rollback procedure
# 1. Create checkpoint before testing
sqlite3 ./data/vectordb.sqlite ".backup ./data/checkpoint.sqlite"

# 2. Test rollback script
node scripts/rollback-migration.js --checkpoint=./data/checkpoint.sqlite

# 3. Verify data integrity after rollback
node scripts/verify-rollback.js
```

## Test Data Setup

### Sample Test Data Creation

```javascript
// Setup comprehensive test data
async function setupTestData() {
  const personaId = 'test-persona-1';
  
  // Create test persona
  await createTestPersona(personaId);
  
  // Add memories with known entities and relationships
  const memories = [
    {
      content: 'John Smith from Microsoft called about the Azure cloud project. He mentioned working with Sarah Johnson on the architecture.',
      type: 'conversation',
      importance: 0.8
    },
    {
      content: 'Sarah Johnson confirmed the meeting with John Smith scheduled for next Tuesday at Microsoft headquarters.',
      type: 'fact', 
      importance: 0.7
    },
    {
      content: 'The Azure project requires integration with existing cloud infrastructure. Security protocols must be reviewed.',
      type: 'context',
      importance: 0.6
    },
    {
      content: 'John prefers morning meetings and always brings detailed technical documentation to discussions.',
      type: 'preference',
      importance: 0.5
    }
  ];
  
  for (const memory of memories) {
    await addMemory(personaId, memory);
  }
  
  // Allow time for graph processing
  await new Promise(resolve => setTimeout(resolve, 2000));
}
```

## Success Criteria Validation

### Performance Benchmarks
- [ ] Hybrid search completes in <300ms for 90th percentile
- [ ] Memory addition shows <10% performance degradation
- [ ] Graph traversal completes within 5-second timeout
- [ ] System memory usage remains stable under load

### Functionality Validation  
- [ ] All existing v1.0 features work unchanged
- [ ] Entity extraction accuracy >80% on test data
- [ ] Graph expansion improves search relevance by >15%
- [ ] MCP tools provide expected graph functionality

### Reliability Testing
- [ ] Zero data loss during migration
- [ ] System uptime >99.5% during deployment
- [ ] Feature flags enable safe rollback
- [ ] Emergency rollback restores v1.0 functionality

### API Compatibility
- [ ] All existing API endpoints maintain backward compatibility
- [ ] New graph endpoints return expected data structures
- [ ] Error handling provides informative messages
- [ ] Rate limiting works with new features

## Test Execution Timeline

### Phase 1: Unit Testing (Days 1-2)
- Execute all unit tests for new components
- Verify 90%+ code coverage for graph services
- Validate feature flag functionality
- Test error handling and edge cases

### Phase 2: Integration Testing (Days 3-4)
- End-to-end memory addition with graph processing
- Hybrid search accuracy and performance
- API endpoint functionality
- MCP tool integration

### Phase 3: Performance Testing (Days 5-6)
- Load testing with concurrent users
- Memory usage and performance profiling
- Database query optimization validation
- Timeout and rate limiting verification

### Phase 4: Migration Testing (Day 7)
- Full migration from v1.0 to v2.0
- Data integrity validation
- Rollback procedure testing
- Production deployment simulation

## Test Reporting

### Required Test Reports
1. **Unit Test Coverage Report** - Code coverage metrics and test results
2. **Performance Benchmark Report** - Response times, throughput, resource usage
3. **Migration Validation Report** - Data integrity, entity extraction accuracy
4. **API Compatibility Report** - Backward compatibility verification
5. **Feature Flag Test Report** - Rollback capability and emergency procedures

### Issue Severity Classification
- **Critical:** System failure, data loss, or security vulnerability
- **High:** Feature not working, significant performance degradation
- **Medium:** Minor functionality issues, usability problems
- **Low:** Cosmetic issues, documentation gaps

### Sign-off Criteria
- [ ] All critical and high severity issues resolved
- [ ] Performance benchmarks met
- [ ] Migration procedures validated
- [ ] Rollback capabilities confirmed
- [ ] Production deployment approved

This comprehensive testing guide ensures thorough validation of Zero Vector 2.0's hybrid vector-graph capabilities while maintaining system reliability and performance standards.
