# Zero-Vector-3: LangGraph-Enhanced AI Persona Memory System

Zero-Vector-3 is an advanced AI persona memory management system that integrates LangGraph workflows with hybrid vector-graph databases to provide sophisticated multi-agent orchestration and enhanced memory capabilities.

## 🚀 Features

- **LangGraph Integration**: Sophisticated multi-agent workflows with state management and checkpointing
- **Hybrid Vector-Graph Search**: Advanced retrieval combining semantic similarity with graph relationships
- **Persona Memory Management**: AI personalities with persistent, context-aware memory systems
- **Entity Extraction & Graph Traversal**: Intelligent relationship discovery and knowledge expansion
- **Production-Ready Architecture**: Comprehensive logging, monitoring, and error handling
- **LangChain Compatibility**: Seamless integration with LangChain ecosystem

## 🏗️ Architecture

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   LangGraph Engine  │    │  Zero-Vector-3 Core  │    │   Express API       │
│   (Orchestration)   │────│  (Memory System)     │────│   (HTTP Interface)  │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
           │                          │                          │
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   Vector Database   │    │   Graph Database     │    │   Persona Engine    │
│   (Semantic Search) │    │   (Relationships)    │    │   (AI Personalities)│
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```

## 📋 Components

### Core Agents

1. **HybridRetrievalAgent**: Combines vector similarity search with graph relationship traversal
2. **PersonaMemoryAgent**: Manages persona-specific responses with memory integration
3. **ZeroVectorGraph**: Main LangGraph workflow orchestrating all agents

### Services

1. **LangChainVectorStoreAdapter**: Bridges Zero-Vector with LangChain VectorStore interface
2. **ZeroVectorStateManager**: Comprehensive state management with Zod validation
3. **Enhanced Logging**: Structured logging with performance metrics

### Key Features

- **State Management**: Zod-based state validation with comprehensive state transitions
- **Conditional Routing**: Intelligent workflow routing based on query complexity and content
- **Error Handling**: Robust error recovery with detailed logging
- **Performance Monitoring**: Built-in metrics and performance tracking
- **Human-in-the-Loop**: Optional approval workflows for sensitive content

## 🛠️ Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- PostgreSQL (for production checkpointing)
- Redis (optional, for caching)

### Setup

1. **Clone and navigate to the project**:
```bash
cd zero-vector-3/server
```

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Create logs directory**:
```bash
mkdir -p logs
```

5. **Start the server**:
```bash
npm start
```

## ⚙️ Configuration

### Environment Variables

```env
# Server Configuration
NODE_ENV=development
HOST=localhost
PORT=3001

# Security
JWT_SECRET=your-secret-key
API_KEY=your-api-key
CORS_ORIGIN=http://localhost:3000

# LangGraph Configuration
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-key
LANGSMITH_PROJECT=zero-vector-3

# External Services
OPENAI_API_KEY=your-openai-key
DATABASE_URL=postgresql://user:password@localhost:5432/zerovector3
REDIS_URL=redis://localhost:6379/0
```

### Configuration Structure

The system uses a centralized configuration system in `src/config/index.js` that loads environment variables and provides defaults for all system components.

## 🔧 Usage

### Basic Chat API

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello! How are you today?",
    "userId": "user123",
    "persona": "helpful_assistant",
    "conversationId": "conv456"
  }'
```

### Response Format

```json
{
  "response": "Hello! I'm doing well, thank you for asking...",
  "metadata": {
    "persona": "helpful_assistant",
    "processingTime": 245,
    "vectorResults": 3,
    "memoryContext": {
      "query_complexity": "simple",
      "result_confidence": 0.85
    },
    "workflowContext": {
      "steps": ["retrieve", "persona_process", "finalize"],
      "executionTime": 230
    }
  },
  "conversationId": "conv456",
  "requestId": "req_abc123"
}
```

### Available Endpoints

- `GET /health` - Health check and service status
- `POST /api/chat` - Main conversation endpoint
- `GET /api/conversations/:id` - Retrieve conversation history
- `GET /api/stats` - System performance statistics

## 🧠 Persona System

### Default Personas

1. **helpful_assistant** (Alex): Friendly, knowledgeable, patient
2. **technical_expert** (Taylor): Analytical, precise, detail-oriented  
3. **creative_mentor** (Morgan): Imaginative, inspiring, open-minded

### Persona Configuration

```javascript
{
  id: 'helpful_assistant',
  name: 'Alex',
  role: 'Helpful Assistant',
  personality: 'Friendly, knowledgeable, patient, encouraging',
  expertise: ['general knowledge', 'problem solving', 'research assistance'],
  communication_style: 'Warm and supportive, clear explanations',
  config: {
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    maxResponseTokens: 1000,
    temperature: 0.7
  }
}
```

## 🔄 Workflow Structure

### LangGraph Workflow

1. **Retrieve**: Hybrid vector-graph search for relevant information
2. **Route**: Intelligent routing based on query complexity and content sensitivity
3. **Reason** (optional): Multi-step reasoning for complex queries
4. **Human Approval** (optional): Human-in-the-loop for sensitive content
5. **Persona Process**: Generate persona-aware response with memory integration
6. **Finalize**: Complete workflow and return response

### State Management

The system uses a comprehensive state schema that tracks:

- **Messages**: Conversation history with metadata
- **User Profile**: User information and preferences
- **Vector Results**: Search results from hybrid retrieval
- **Memory Context**: Processing metadata and confidence scores
- **Workflow Context**: Execution steps and decision points
- **Execution Metadata**: Performance metrics and timing

## 📊 Monitoring & Logging

### Logging Levels

- **Error**: Application errors and exceptions
- **Warn**: Warnings and recoverable issues
- **Info**: General information and API requests
- **Debug**: Detailed debugging information
- **Trace**: Very detailed execution traces

### Performance Metrics

The system tracks comprehensive performance metrics:

- Response times for all operations
- Memory usage and CPU utilization
- Cache hit rates
- Agent execution statistics
- Error rates and recovery metrics

### Log Files

- `logs/combined.log`: All log entries
- `logs/error.log`: Error logs only
- `logs/performance.log`: Performance metrics

## 🔒 Security Features

- **Helmet.js**: Security headers and XSS protection
- **Rate Limiting**: Configurable request rate limits
- **CORS**: Cross-origin request security
- **Input Validation**: Comprehensive request validation
- **Error Sanitization**: Safe error responses without sensitive data

## 🚀 Production Deployment

### Docker Support

The system is designed for containerized deployment:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Considerations

- Use PostgreSQL for checkpointing in production
- Configure Redis for caching and session management
- Set up proper logging aggregation (ELK stack, etc.)
- Configure monitoring (Prometheus, Grafana)
- Use environment-specific configuration files

## 📈 Performance Optimization

### Built-in Optimizations

- **Caching**: Embedding and search result caching
- **Connection Pooling**: Database connection management
- **Memory Management**: Efficient state handling
- **Lazy Loading**: On-demand component initialization
- **Compression**: Response compression for API endpoints

### Monitoring

The system provides real-time performance monitoring:

```bash
curl http://localhost:3001/api/stats
```

Returns detailed statistics about:
- System resource usage
- Agent performance metrics
- Service health status
- Cache hit rates

## 🧪 Integration with Zero-Vector-2

This system is designed to integrate with existing zero-vector-2 components:

### Integration Points

1. **HybridVectorStore**: Uses existing vector storage implementation
2. **EmbeddingService**: Leverages existing embedding providers
3. **GraphDatabaseService**: Integrates with existing graph database
4. **PersonaMemoryManager**: Extends existing memory management

### Migration Path

1. Install zero-vector-3 alongside zero-vector-2
2. Configure shared database connections
3. Gradually migrate endpoints to LangGraph workflows
4. Maintain backward compatibility during transition

## 🤝 Development

### Project Structure

```
zero-vector-3/server/
├── src/
│   ├── agents/              # LangGraph agents
│   ├── config/              # Configuration management
│   ├── graphs/              # LangGraph workflows
│   ├── services/            # Core services
│   ├── state/               # State management
│   ├── utils/               # Utilities and helpers
│   └── server.js            # Main server file
├── logs/                    # Log files
├── package.json
├── .env.example
└── README.md
```

### Development Commands

```bash
npm start          # Start production server
npm run dev        # Start development server with hot reload
npm test           # Run test suite
npm run lint       # Run ESLint
npm run build      # Build for production
```

## 🔮 Future Enhancements

Based on the LangGraph-DEV-HANDOFF.md roadmap, planned enhancements include:

### Phase 2 Features
- Advanced multi-step reasoning agents
- Enhanced graph relationship discovery
- Real-time knowledge graph updates
- Improved persona consistency scoring

### Phase 3 Features  
- Human-in-the-loop approval workflows
- Advanced caching strategies
- Performance optimization
- Multi-modal reasoning capabilities

### Phase 4 Features
- Production infrastructure automation
- Advanced monitoring and alerting
- Horizontal scaling capabilities
- Enterprise security features

## 📄 License

MIT License - see LICENSE file for details.

## 🙋‍♂️ Support

For issues, questions, or contributions:

1. Check the existing documentation
2. Review the LangGraph-DEV-HANDOFF.md for detailed implementation guidance
3. Check the logs for debugging information
4. Create an issue with detailed information about your use case

## 🔗 Related Projects

- [LangGraph](https://github.com/langchain-ai/langgraph): Multi-agent workflow framework
- [LangChain](https://github.com/langchain-ai/langchain): LLM application framework
- [Zero-Vector-2](../zero-vector/): Original hybrid vector-graph system

---

**Zero-Vector-3** represents the next evolution in AI persona memory management, combining the power of LangGraph workflows with advanced hybrid vector-graph search capabilities to create truly intelligent, context-aware AI systems.
