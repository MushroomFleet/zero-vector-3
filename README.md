# Zero-Vector MCP Server v3.0

A comprehensive Model Context Protocol (MCP) server for Zero-Vector's hybrid vector-graph persona and memory management system with advanced LangGraph workflow capabilities. This v3.0 implementation combines semantic vector search with knowledge graph capabilities and sophisticated multi-agent workflow orchestration, featuring 24 fully operational specialized tools including LangGraph workflow management and human-in-the-loop processing.

**Status: All 24 tools fully functional and tested ✅**

## Features

### Persona Management (5 tools)
- **create_persona** - Create AI personas with configurable memory and behavior settings
- **list_personas** - List all personas with optional statistics and graph metrics
- **get_persona** - Retrieve detailed persona information including knowledge graph stats
- **update_persona** - Update persona configuration and settings
- **delete_persona** - Delete personas and associated memories/entities

### Memory Management (6 tools)
- **add_memory** - Add memories with automatic entity extraction and graph building
- **search_persona_memories** - Semantic search through persona memories with configurable content display
- **get_full_memory** - Retrieve complete content of specific memories without truncation
- **add_conversation** - Add user/assistant conversation exchanges with entity linking
- **get_conversation_history** - Retrieve complete conversation history with context
- **cleanup_persona_memories** - Clean up old or low-importance memories and entities

### Graph Management (4 tools)
- **explore_knowledge_graph** - Search entities and traverse relationships in persona knowledge graphs
- **hybrid_memory_search** - Enhanced memory search combining vector similarity with graph expansion
- **get_graph_context** - Retrieve detailed context and relationships for specific entities
- **get_graph_stats** - Comprehensive knowledge graph statistics and health metrics

### LangGraph Workflow Management (6 tools) - NEW in v3.0
- **execute_workflow** - Execute LangGraph workflows with custom configuration and persona-specific processing
- **get_workflow_status** - Monitor workflow execution status, progress, and detailed metadata
- **resume_workflow** - Resume interrupted workflows with human-in-the-loop approval support
- **cancel_workflow** - Cancel running workflows with proper cleanup and logging
- **list_active_workflows** - List and filter active workflows with comprehensive status information
- **get_workflow_metrics** - Get detailed performance metrics, analytics, and system health data

### Utilities (3 tools)
- **get_system_health** - Check Zero-Vector server health and hybrid system status
- **get_persona_stats** - Get persona, memory, and knowledge graph usage statistics
- **test_connection** - Test connectivity and authentication with feature detection

## Installation

### Prerequisites
- Node.js 18.0.0 or higher
- Zero-Vector v2 server running (port 3000) - existing system
- Zero-Vector v3 server running (port 3001) - LangGraph system
- Valid Zero-Vector API keys for both servers

### Setup

1. **Install dependencies:**
   ```bash
   cd MCP
   npm install
   ```

2. **Configure environment:**
   ```bash
   # Copy and edit .env file
   cp .env.example .env
   ```

3. **Set environment variables in `.env`:**
   ```env
   # Zero-Vector v2 Server (Original System)
   ZERO_VECTOR_BASE_URL=http://localhost:3000
   ZERO_VECTOR_API_KEY=your_zero_vector_2_api_key
   
   # Zero-Vector v3 Server (LangGraph System)
   ZERO_VECTOR_V3_BASE_URL=http://localhost:3001
   ZERO_VECTOR_V3_API_KEY=your_zero_vector_3_api_key
   
   # Zero Vector Features (auto-detected)
   GRAPH_ENABLED=true
   FEATURE_HYBRID_SEARCH=true
   FEATURE_ENTITY_EXTRACTION=true
   FEATURE_GRAPH_EXPANSION=true
   FEATURE_LANGGRAPH_WORKFLOWS=true
   
   # Optional configurations
   MCP_SERVER_NAME=zero-vector-mcp-v3
   MCP_SERVER_VERSION=3.0.0
   LOG_LEVEL=info
   NODE_ENV=development
   ```

## Usage

### Testing the Server

```bash
# Test connection to both Zero-Vector servers
npm run test:connection

# List all available tools (24 total)
npm run list:tools

# Check version
npm run version
```

### Running the Server

```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start
```

### Integration with Cline

Add to your Cline MCP configuration:

```json
{
  "mcpServers": {
    "zero-vector-v3": {
      "command": "node",
      "args": ["C:/path/to/your/MCP/src/index.js"],
      "env": {
        "ZERO_VECTOR_BASE_URL": "http://localhost:3000",
        "ZERO_VECTOR_API_KEY": "your_zero_vector_2_api_key",
        "ZERO_VECTOR_V3_BASE_URL": "http://localhost:3001",
        "ZERO_VECTOR_V3_API_KEY": "your_zero_vector_3_api_key"
      }
    }
  }
}
```

## Tool Examples

### Traditional Operations (v2.0 compatibility)

#### Create a Persona
```javascript
{
  "name": "Assistant",
  "description": "Helpful AI assistant with memory",
  "systemPrompt": "You are a helpful assistant with access to knowledge graphs.",
  "temperature": 0.7,
  "maxTokens": 2048,
  "maxMemorySize": 1000
}
```

#### Add a Memory (with Entity Extraction)
```javascript
{
  "personaId": "uuid-here",
  "content": "John Smith from Microsoft called about the Azure project. He mentioned working with Sarah Johnson on cloud architecture.",
  "type": "conversation",
  "importance": 0.8
}
```

#### Hybrid Memory Search (v2.0)
```javascript
{
  "personaId": "uuid-here",
  "query": "cloud architecture project",
  "limit": 5,
  "useGraphExpansion": true,
  "graphDepth": 2,
  "threshold": 0.7
}
```

### LangGraph Workflow Operations (v3.0)

#### Execute Basic Workflow
```javascript
{
  "query": "Tell me about machine learning fundamentals",
  "persona": "technical_expert",
  "user_id": "user123",
  "workflow_type": "zero_vector_conversation",
  "config": {
    "enable_approval": false,
    "cache_enabled": true,
    "confidence_threshold": 0.8,
    "max_reasoning_steps": 5
  }
}
```

#### Execute Multi-Step Reasoning Workflow
```javascript
{
  "query": "Compare machine learning approaches for natural language processing and recommend the best approach for a chatbot system",
  "persona": "technical_expert", 
  "user_id": "user456",
  "workflow_type": "multi_step_reasoning",
  "config": {
    "enable_approval": true,
    "max_reasoning_steps": 10,
    "confidence_threshold": 0.9,
    "enable_memory_maintenance": true
  },
  "thread_id": "conversation_abc123"
}
```

#### Resume Interrupted Workflow (Human-in-the-Loop)
```javascript
{
  "thread_id": "conversation_abc123",
  "workflow_id": "workflow_xyz789",
  "approval_result": {
    "approved": true,
    "feedback": "Proceed with the recommended approach, but add more details about implementation complexity",
    "modifications": {
      "add_implementation_details": true,
      "focus_areas": ["complexity", "scalability", "cost"]
    }
  }
}
```

#### Get Workflow Status
```javascript
{
  "workflow_id": "workflow_xyz789",
  "thread_id": "conversation_abc123",
  "include_metadata": true
}
```

#### List Active Workflows
```javascript
{
  "user_id": "user123",
  "status": "running",
  "workflow_type": "multi_step_reasoning",
  "limit": 10
}
```

#### Get Workflow Performance Metrics
```javascript
{
  "time_range": "24h",
  "workflow_type": "zero_vector_conversation",
  "user_id": "user123",
  "include_detailed": true
}
```

#### Cancel Running Workflow
```javascript
{
  "workflow_id": "workflow_xyz789",
  "thread_id": "conversation_abc123",
  "reason": "User requested cancellation due to changed requirements"
}
```

### Advanced Content Access (v2.0 Enhanced)

#### Get Full Memory Content
```javascript
{
  "personaId": "uuid-here",
  "memoryId": "memory-uuid-from-search",
  "include_metadata": true
}
```

#### Search with Custom Content Preview
```javascript
{
  "personaId": "uuid-here",
  "query": "white hat tales",
  "limit": 5,
  "content_preview_length": 500,
  "threshold": 0.3
}
```

## Architecture

### Multi-Server Integration (v3.0)

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   External AI       │    │   MCP Server v3.0    │    │   Zero-Vector v3    │
│   Systems/Clients   │────│   (24 Tools)         │────│   (LangGraph)       │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
                                      │
                           ┌──────────────────────┐
                           │   Zero-Vector v2     │
                           │   (Original System)  │
                           └──────────────────────┘
```

### Workflow Processing Flow

```
Query → MCP Server → Zero-Vector v3 → LangGraph Workflow → Agents → Response
                           ↓
                    State Management
                           ↓
                    Human Approval (if needed)
                           ↓
                    Memory Integration → Zero-Vector v2
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZERO_VECTOR_BASE_URL` | `http://localhost:3000` | Zero-Vector v2 server URL |
| `ZERO_VECTOR_API_KEY` | *required* | API key for v2 server |
| `ZERO_VECTOR_V3_BASE_URL` | `http://localhost:3001` | Zero-Vector v3 server URL |
| `ZERO_VECTOR_V3_API_KEY` | *required* | API key for v3 server |
| `ZERO_VECTOR_TIMEOUT` | `30000` | Request timeout (ms) |
| `ZERO_VECTOR_RETRY_ATTEMPTS` | `3` | Retry attempts for failed requests |
| `MCP_SERVER_NAME` | `zero-vector-mcp-v3` | MCP server name |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

### Workflow Types
- **zero_vector_conversation** - Standard conversation processing with persona and memory
- **multi_step_reasoning** - Complex multi-step reasoning with approval gates
- **human_approval** - Human-in-the-loop workflows requiring approval
- **memory_maintenance** - Automated memory cleanup and optimization

### Memory Types
- **conversation** - Chat exchanges
- **fact** - Factual information
- **preference** - User preferences
- **context** - Contextual information
- **system** - System-generated content

## Technical Implementation

### MCP Protocol Compliance
All 24 tools implement standardized MCP response format:
- **Consistent Response Structure** - All tools return proper `{ content: [{ type: 'text', text: '...' }] }` format
- **Error Standardization** - Unified error handling with `isError: true` flag for failed operations
- **Validation Integration** - Input validation with detailed error messages and suggestions
- **Protocol Compatibility** - Full compliance with MCP SDK requirements and validation schemas

### Recent Improvements
- ✅ **Workflow Tools Validation Fix** - Resolved MCP response format issues for all 6 LangGraph workflow tools
- ✅ **Response Format Standardization** - All tools now use consistent MCP-compliant response structure
- ✅ **Enhanced Error Messages** - Improved error handling with actionable feedback and troubleshooting guidance
- ✅ **Protocol Validation** - Complete validation against MCP SDK requirements for reliable integration

## Error Handling

The server provides comprehensive error handling with:
- **Input validation** - All parameters validated against schemas
- **Multi-server support** - Automatic failover and routing
- **API error mapping** - Clear error messages with suggestions
- **Retry logic** - Automatic retries for transient failures
- **Workflow interruption** - Graceful handling of interrupted workflows
- **Graceful degradation** - Informative error responses
- **MCP compliance** - Standardized response format across all tools

## Logging

Structured logging with Winston:
- **Console output** - Colored logs for development
- **Configurable levels** - Debug, info, warn, error
- **Context tracking** - Tool execution and performance metrics
- **Workflow tracing** - Complete workflow execution tracking
- **Multi-server logging** - Separate logs for v2 and v3 operations

## Performance

Optimized for efficiency:
- **Streamlined codebase** - Focused on essential operations
- **Efficient API client** - Connection pooling and retry logic
- **Multi-server routing** - Intelligent routing between v2 and v3
- **Workflow caching** - Performance optimization for repeated operations
- **Minimal dependencies** - Reduced overhead and faster startup

## Zero Vector v3.0 Enhancements

This v3.0 version adds:
- ✅ **LangGraph Workflows** - 6 new tools for advanced workflow management
- ✅ **Multi-Agent Orchestration** - Sophisticated agent coordination and reasoning
- ✅ **Human-in-the-Loop** - Approval workflows with resume capabilities
- ✅ **Performance Monitoring** - Real-time metrics and analytics
- ✅ **Thread Continuity** - Persistent conversation state across sessions
- ✅ **Multi-Server Support** - Seamless integration between v2 and v3 systems
- ✅ **Backward Compatible** - All v2.0 tools work unchanged with added capabilities
- ✅ **Production Ready** - Authentication, monitoring, and enterprise features

## Troubleshooting

### Connection Issues
```bash
# Test connectivity to both servers
npm run test:connection

# Check Zero-Vector v2 server status
curl http://localhost:3000/health

# Check Zero-Vector v3 server status  
curl http://localhost:3001/health
```

### Authentication Problems
- Verify both `ZERO_VECTOR_API_KEY` and `ZERO_VECTOR_V3_API_KEY` in `.env`
- Check API keys are active in respective Zero-Vector servers
- Ensure proper permissions for workflow operations

### Workflow Issues
- Check workflow status with `get_workflow_status`
- Review workflow metrics for performance issues
- Use `cancel_workflow` to clean up stuck workflows
- Enable debug logging for detailed workflow tracing

### Memory/Persona Not Found
- Verify UUID format and existence
- Check persona is active on correct server (v2 vs v3)
- Ensure API key has access permissions

## Development

### Project Structure
```
MCP/
├── src/
│   ├── index.js          # Main MCP server (24 tools)
│   ├── config.js         # Multi-server configuration
│   ├── apiClient.js      # Multi-server HTTP client
│   ├── tools/
│   │   ├── personas.js   # Persona management (5 tools)
│   │   ├── memories.js   # Memory operations (6 tools)
│   │   ├── graph.js      # Graph management (4 tools)
│   │   ├── workflows.js  # LangGraph workflows (6 tools) - NEW
│   │   └── utilities.js  # System utilities (3 tools)
│   └── utils/
│       ├── logger.js     # Enhanced logging utility
│       └── validation.js # Input validation
├── .env                  # Environment config (multi-server)
├── package.json         # Dependencies
└── README.md           # This documentation
```

### Adding New Tools
1. Define tool in appropriate module
2. Add validation schema
3. Implement handler function with multi-server support
4. Export in tool array
5. Update documentation and examples

## Workflow Development

### Creating Custom Workflows
1. Define workflow type in Zero-Vector v3 configuration
2. Implement workflow logic using LangGraph
3. Add MCP tool wrapper for external access
4. Test with approval and monitoring features

### Performance Optimization
- Use workflow caching for repeated operations
- Monitor metrics with `get_workflow_metrics`
- Implement proper error handling and retries
- Consider thread-based conversation continuity

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check both Zero-Vector server logs (v2 and v3)
2. Verify multi-server configuration and connectivity
3. Review workflow documentation and examples
4. Enable debug logging for detailed output
5. Use workflow monitoring tools for troubleshooting

## Version History

- **v3.0** - LangGraph workflow integration, multi-server support, 24 tools
- **v2.0** - Hybrid vector-graph capabilities, entity extraction, 18 tools
- **v1.0** - Basic persona and memory management, 14 tools
