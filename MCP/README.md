# Zero-Vector MCP Server v2.0

A comprehensive Model Context Protocol (MCP) server for Zero-Vector's hybrid vector-graph persona and memory management system. This v2.0 implementation combines semantic vector search with knowledge graph capabilities for enhanced AI memory and relationship understanding, now featuring 18 specialized tools including advanced content access controls.

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

### Utilities (3 tools)
- **get_system_health** - Check Zero-Vector server health and hybrid system status
- **get_persona_stats** - Get persona, memory, and knowledge graph usage statistics
- **test_connection** - Test connectivity and authentication with feature detection

## Installation

### Prerequisites
- Node.js 18.0.0 or higher
- Zero-Vector server running and accessible
- Valid Zero-Vector API key

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
   # Zero-Vector Server Configuration
   ZERO_VECTOR_BASE_URL=http://localhost:3000
   ZERO_VECTOR_API_KEY=your_api_key_here
   
   # Zero Vector 2.0 Hybrid Features (auto-detected)
   GRAPH_ENABLED=true
   FEATURE_HYBRID_SEARCH=true
   FEATURE_ENTITY_EXTRACTION=true
   FEATURE_GRAPH_EXPANSION=true
   
   # Optional configurations
   MCP_SERVER_NAME=zero-vector-mcp-v2
   MCP_SERVER_VERSION=2.0.0
   LOG_LEVEL=info
   NODE_ENV=development
   ```

## Usage

### Testing the Server

```bash
# Test connection to Zero-Vector server
npm run test:connection

# List available tools
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
    "zero-vector-clean": {
      "command": "node",
      "args": ["C:/path/to/your/MCP/src/index.js"],
      "env": {
        "ZERO_VECTOR_BASE_URL": "http://localhost:3000",
        "ZERO_VECTOR_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Tool Examples

### Create a Persona
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

### Add a Memory (with Entity Extraction)
```javascript
{
  "personaId": "uuid-here",
  "content": "John Smith from Microsoft called about the Azure project. He mentioned working with Sarah Johnson on cloud architecture.",
  "type": "conversation",
  "importance": 0.8
}
```

### Search Memories
```javascript
{
  "personaId": "uuid-here",
  "query": "user preferences",
  "limit": 10,
  "threshold": 0.3
}
```

### Hybrid Memory Search (v2.0)
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

### Explore Knowledge Graph
```javascript
{
  "personaId": "uuid-here",
  "query": "John Smith",
  "limit": 10,
  "includeRelationships": true,
  "entityTypes": ["PERSON", "ORGANIZATION"]
}
```

### Get Graph Context
```javascript
{
  "personaId": "uuid-here",
  "entityIds": ["entity-uuid-1", "entity-uuid-2"],
  "includeRelationships": true,
  "maxDepth": 2
}
```

### Advanced Content Access (New in v2.0)

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
  "content_preview_length": 500,  // Show 500 characters instead of default 150
  "threshold": 0.3
}
```

#### Search with Full Content Display
```javascript
{
  "personaId": "uuid-here",
  "query": "complete stories",
  "limit": 3,
  "show_full_content": true,  // Display complete content without truncation
  "threshold": 0.4
}
```

#### Search with No Content Limits
```javascript
{
  "personaId": "uuid-here",
  "query": "narrative content",
  "limit": 10,
  "content_preview_length": 0,  // 0 = no truncation
  "threshold": 0.3
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZERO_VECTOR_BASE_URL` | `http://localhost:3000` | Zero-Vector server URL |
| `ZERO_VECTOR_API_KEY` | *required* | API key for authentication |
| `ZERO_VECTOR_TIMEOUT` | `30000` | Request timeout (ms) |
| `ZERO_VECTOR_RETRY_ATTEMPTS` | `3` | Retry attempts for failed requests |
| `MCP_SERVER_NAME` | `zero-vector-mcp-clean` | MCP server name |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

### Memory Types
- **conversation** - Chat exchanges
- **fact** - Factual information
- **preference** - User preferences
- **context** - Contextual information
- **system** - System-generated content

## Error Handling

The server provides comprehensive error handling with:
- **Input validation** - All parameters validated against schemas
- **API error mapping** - Clear error messages with suggestions
- **Retry logic** - Automatic retries for transient failures
- **Graceful degradation** - Informative error responses

## Logging

Structured logging with Winston:
- **Console output** - Colored logs for development
- **Configurable levels** - Debug, info, warn, error
- **Context tracking** - Tool execution and performance metrics

## Performance

Optimized for efficiency:
- **Streamlined codebase** - Focused on essential operations
- **Efficient API client** - Connection pooling and retry logic
- **Minimal dependencies** - Reduced overhead and faster startup

## Zero Vector 2.0 Enhancements

This v2.0 version adds:
- ✅ **Hybrid Vector-Graph** - Combines semantic search with knowledge graphs
- ✅ **Entity Extraction** - Automatic entity recognition and relationship mapping
- ✅ **Graph Tools** - 4 new tools for knowledge graph exploration and context
- ✅ **Enhanced Memory** - Graph-expanded memory search with relationship traversal
- ✅ **Backward Compatible** - All v1.0 tools work unchanged with added capabilities
- ✅ **Feature Detection** - Automatically detects and uses available v2.0 features

## Troubleshooting

### Connection Issues
```bash
# Test connectivity
npm run test:connection

# Check Zero-Vector server status
curl http://localhost:3000/health
```

### Authentication Problems
- Verify `ZERO_VECTOR_API_KEY` in `.env`
- Check API key is active in Zero-Vector server
- Ensure proper permissions

### Memory/Persona Not Found
- Verify UUID format and existence
- Check persona is active
- Ensure API key has access permissions

## Development

### Project Structure
```
MCP/
├── src/
│   ├── index.js          # Main MCP server
│   ├── config.js         # Configuration
│   ├── apiClient.js      # HTTP client
│   ├── tools/
│   │   ├── personas.js   # Persona management
│   │   ├── memories.js   # Memory operations
│   │   ├── graph.js      # Graph management (v2.0)
│   │   └── utilities.js  # System utilities
│   └── utils/
│       ├── logger.js     # Logging utility
│       └── validation.js # Input validation
├── .env                  # Environment config
├── package.json         # Dependencies
└── README.md           # Documentation
```

### Adding New Tools
1. Define tool in appropriate module
2. Add validation schema
3. Implement handler function
4. Export in tool array
5. Update documentation

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check Zero-Vector server logs
2. Verify configuration and connectivity
3. Review tool documentation
4. Enable debug logging for detailed output
