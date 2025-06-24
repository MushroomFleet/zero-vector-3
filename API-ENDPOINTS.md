# Zero-Vector API Endpoints

This document lists all available API endpoints for the Zero-Vector system, organized by server and functionality. The endpoints are extracted from the MCP (Model Context Protocol) server implementation that provides external access to Zero-Vector capabilities.

## System Architecture

The Zero-Vector system consists of two servers:
- **Zero-Vector v2**: Original hybrid vector-graph memory system (port 3000)
- **Zero-Vector v3**: Advanced LangGraph workflow system (port 3001)

---

## Hybrid Vector-Graph Memory
*Zero-Vector v2 Server Endpoints (localhost:3000)*

### Health & System Monitoring

| Method | Endpoint | Description | MCP Tool |
|--------|----------|-------------|----------|
| `GET` | `/health` | Basic server health check | `test_connection`, `get_system_health` |
| `GET` | `/health/detailed` | Detailed system health with metrics | `get_system_health` |

### Persona Management

| Method | Endpoint | Description | MCP Tool |
|--------|----------|-------------|----------|
| `GET` | `/api/personas` | List all personas with optional filters | `list_personas` |
| `POST` | `/api/personas` | Create a new persona | `create_persona` |
| `GET` | `/api/personas/{personaId}` | Get specific persona details | `get_persona` |
| `PUT` | `/api/personas/{personaId}` | Update persona configuration | `update_persona` |
| `DELETE` | `/api/personas/{personaId}` | Delete persona and all data | `delete_persona` |
| `GET` | `/api/personas/_stats` | Get statistics for all personas | `get_persona_stats` |
| `GET` | `/api/personas/{personaId}/stats` | Get statistics for specific persona | `get_persona_stats` |

### Memory Operations

| Method | Endpoint | Description | MCP Tool |
|--------|----------|-------------|----------|
| `POST` | `/api/personas/{personaId}/memories` | Add memory to persona | `add_memory` |
| `POST` | `/api/personas/{personaId}/memories/search` | Search persona memories (vector similarity) | `search_persona_memories` |
| `GET` | `/api/personas/{personaId}/memories/{memoryId}` | Get full memory content by ID | `get_full_memory` |
| `POST` | `/api/personas/{personaId}/conversations` | Add conversation exchange | `add_conversation` |
| `GET` | `/api/personas/{personaId}/conversations/{conversationId}` | Get conversation history | `get_conversation_history` |
| `DELETE` | `/api/personas/{personaId}/memories/cleanup` | Clean up old/low-importance memories | `cleanup_persona_memories` |

### Knowledge Graph Operations

| Method | Endpoint | Description | MCP Tool |
|--------|----------|-------------|----------|
| `POST` | `/api/personas/{personaId}/graph/entities/search` | Search entities in knowledge graph | `explore_knowledge_graph` |
| `GET` | `/api/personas/{personaId}/graph/entities/{entityId}/related` | Get related entities for specific entity | `explore_knowledge_graph` |
| `POST` | `/api/personas/{personaId}/memories/search/hybrid` | Hybrid search (vector + graph expansion) | `hybrid_memory_search` |
| `POST` | `/api/personas/{personaId}/graph/context` | Get detailed context for entities | `get_graph_context` |
| `GET` | `/api/personas/{personaId}/graph/stats` | Get knowledge graph statistics | `get_graph_stats` |
| `GET` | `/api/personas/{personaId}/graph/relationships` | Get all relationships with filtering | `get_persona_relationships` |

---

## LangGraph Workflows
*Zero-Vector v3 Server Endpoints (localhost:3001)*

### Workflow Execution

| Method | Endpoint | Description | MCP Tool |
|--------|----------|-------------|----------|
| `POST` | `/api/v3/langgraph/execute` | Execute LangGraph workflow with configuration | `execute_workflow` |
| `GET` | `/api/v3/langgraph/status` | Get workflow execution status and metadata | `get_workflow_status` |
| `POST` | `/api/v3/langgraph/resume` | Resume interrupted workflow (human-in-the-loop) | `resume_workflow` |
| `POST` | `/api/v3/langgraph/cancel` | Cancel running workflow | `cancel_workflow` |

### Workflow Management

| Method | Endpoint | Description | MCP Tool |
|--------|----------|-------------|----------|
| `GET` | `/api/v3/langgraph/workflows` | List active workflows with filtering | `list_active_workflows` |
| `GET` | `/api/v3/langgraph/metrics` | Get workflow performance metrics | `get_workflow_metrics` |

---

## Endpoint Details

### Authentication
All API endpoints require authentication via API key:
- **Header**: `X-API-Key: {your_api_key}`
- **v2 Server**: Uses `ZERO_VECTOR_API_KEY`
- **v3 Server**: Uses `ZERO_VECTOR_V3_API_KEY`

### Common Query Parameters

#### Pagination & Filtering
- `limit`: Maximum results to return
- `offset`: Number of results to skip
- `include_metadata`: Include detailed metadata in response

#### Memory Search Parameters
- `threshold`: Minimum similarity threshold (0-1)
- `memoryTypes`: Filter by memory types (`conversation`, `fact`, `preference`, `context`, `system`)
- `content_preview_length`: Length of content preview in results

#### Graph Parameters
- `entityTypes`: Filter by entity types (`PERSON`, `CONCEPT`, `EVENT`, `OBJECT`, `PLACE`)
- `minConfidence`: Minimum entity confidence threshold
- `includeRelated`: Include related entities in results
- `maxDepth`: Maximum relationship traversal depth

#### Workflow Parameters
- `workflow_type`: Type of workflow (`zero_vector_conversation`, `multi_step_reasoning`, `human_approval`, `memory_maintenance`, `cross_persona_coordination`)
- `enable_approval`: Enable human-in-the-loop approval
- `cache_enabled`: Enable performance caching

### Request/Response Format

#### Standard Request Headers
```
Content-Type: application/json
X-API-Key: {api_key}
User-Agent: Zero-Vector-MCP-Clean/3.0.0
```

#### Standard Response Format
```json
{
  "status": "success|error",
  "data": { ... },
  "meta": {
    "count": 10,
    "total": 100,
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "message": "Optional message"
}
```

#### Error Response Format
```json
{
  "status": "error",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message"
  },
  "suggestion": "Helpful suggestion for fixing the error"
}
```

### Example API Calls

#### Create Persona (v2)
```bash
POST /api/personas
Content-Type: application/json
X-API-Key: your_api_key

{
  "name": "Assistant",
  "description": "Helpful AI assistant",
  "systemPrompt": "You are a helpful assistant.",
  "temperature": 0.7,
  "maxTokens": 2048,
  "maxMemorySize": 1000
}
```

#### Execute Workflow (v3)
```bash
POST /api/v3/langgraph/execute
Content-Type: application/json
X-API-Key: your_v3_api_key

{
  "messages": [
    {
      "type": "human",
      "content": "Tell me about machine learning"
    }
  ],
  "active_persona": "technical_expert",
  "user_profile": {
    "id": "user123",
    "preferences": {}
  },
  "workflow_context": {
    "workflow_type": "zero_vector_conversation",
    "workflow_id": "workflow_123",
    "config": {
      "enable_approval": false,
      "cache_enabled": true
    }
  }
}
```

#### Hybrid Memory Search (v2)
```bash
POST /api/personas/{personaId}/memories/search/hybrid
Content-Type: application/json
X-API-Key: your_api_key

{
  "query": "machine learning algorithms",
  "limit": 5,
  "threshold": 0.7,
  "useGraphExpansion": true,
  "graphDepth": 2,
  "graphWeight": 0.3,
  "includeContext": true
}
```

### Rate Limiting & Performance

#### Default Limits
- **Requests per minute**: 60 (authenticated)
- **Concurrent requests**: 10
- **Request timeout**: 30 seconds
- **Retry attempts**: 3 (with exponential backoff)

#### Performance Optimizations
- **Caching**: Workflow results and frequent queries cached
- **Connection pooling**: HTTP client reuses connections
- **Batch operations**: Multiple memories can be processed together
- **Async processing**: Long-running workflows processed asynchronously

### Error Codes

#### Common HTTP Status Codes
- `200`: Success
- `400`: Bad Request (validation error)
- `401`: Unauthorized (invalid/missing API key)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource doesn't exist)
- `409`: Conflict (resource already exists)
- `429`: Too Many Requests (rate limited)
- `500`: Internal Server Error
- `503`: Service Unavailable

#### Application Error Codes
- `PERSONA_NOT_FOUND`: Requested persona doesn't exist
- `MEMORY_NOT_FOUND`: Requested memory doesn't exist
- `VALIDATION_ERROR`: Input validation failed
- `WORKFLOW_INTERRUPTED`: Workflow requires human approval
- `GRAPH_ERROR`: Knowledge graph operation failed
- `NETWORK_ERROR`: Unable to connect to server

### Server Configuration

#### Environment Variables
```bash
# Zero-Vector v2 Server
ZERO_VECTOR_BASE_URL=http://localhost:3000
ZERO_VECTOR_API_KEY=your_v2_api_key

# Zero-Vector v3 Server
ZERO_VECTOR_V3_BASE_URL=http://localhost:3001
ZERO_VECTOR_V3_API_KEY=your_v3_api_key

# Optional Configuration
ZERO_VECTOR_TIMEOUT=30000
ZERO_VECTOR_RETRY_ATTEMPTS=3
```

#### Health Check Endpoints
- **v2 Health**: `GET http://localhost:3000/health`
- **v3 Health**: `GET http://localhost:3001/health`

---

## Integration Notes

### MCP Server Integration
This API documentation is based on the MCP (Model Context Protocol) server implementation that provides 25 tools across 5 categories:

1. **Persona Management** (5 tools) - Create, read, update, delete personas
2. **Memory Operations** (6 tools) - Add, search, retrieve memories and conversations
3. **Graph Operations** (5 tools) - Explore knowledge graphs and entity relationships
4. **Workflow Management** (6 tools) - Execute and monitor LangGraph workflows
5. **System Utilities** (3 tools) - Health checks and statistics

### Multi-Server Architecture
The system seamlessly routes requests between v2 and v3 servers:
- **Traditional operations** (personas, memories, graphs) → v2 server
- **Workflow operations** (LangGraph execution) → v3 server
- **Health and stats** → Both servers (aggregated)

### Workflow Types
Available LangGraph workflow types:
- `zero_vector_conversation`: Standard conversation with memory
- `multi_step_reasoning`: Complex multi-step reasoning tasks
- `human_approval`: Workflows requiring human-in-the-loop approval
- `memory_maintenance`: Automated memory cleanup and optimization
- `cross_persona_coordination`: Multi-persona collaborative workflows

### Feature Flags
The system supports various feature flags:
- `GRAPH_ENABLED`: Enable knowledge graph functionality
- `FEATURE_HYBRID_SEARCH`: Enable hybrid vector-graph search
- `FEATURE_ENTITY_EXTRACTION`: Enable automatic entity extraction
- `FEATURE_LANGGRAPH_WORKFLOWS`: Enable LangGraph workflow capabilities

---

*Generated from Zero-Vector MCP Server v3.0 - Last updated: December 2024*
