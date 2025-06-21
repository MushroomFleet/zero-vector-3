# Zero-Vector-3 Workflows Quickstart Guide

Welcome to Zero-Vector-3! This guide provides practical examples of using the five workflow types through the MCP (Model Context Protocol) interface. Each workflow is designed for specific use cases and offers unique capabilities.

## Prerequisites

1. **Zero-Vector-3 Server Running**: Ensure your zero-vector-3 server is active
2. **MCP Server Connected**: The MCP server should be connected to zero-vector-3
3. **User Profile**: You'll need a user ID for personalized processing

## Available Workflow Types

- **`zero_vector_conversation`** - Standard conversational workflow with hybrid retrieval
- **`multi_step_reasoning`** - Complex reasoning workflow for analytical queries  
- **`human_approval`** - Workflow requiring human oversight for sensitive content
- **`memory_maintenance`** - Workflow focused on memory lifecycle management
- **`cross_persona_coordination`** - Advanced cross-persona workflow coordination

---

## 1. Zero Vector Conversation Workflow

**Best for**: General questions, explanations, information retrieval, casual conversations

### Example Scenario: "Explain Neural Networks"

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Can you explain how neural networks work? I'm a beginner but I understand basic programming concepts.",
    "persona": "helpful_assistant",
    "user_id": "user_12345",
    "workflow_type": "zero_vector_conversation",
    "config": {
      "enable_approval": false,
      "enable_memory_maintenance": true,
      "cache_enabled": true,
      "confidence_threshold": 0.7
    }
  }
}
```

**Expected Response**:
- Friendly, accessible explanation of neural networks
- Examples relevant to programming background
- Clear structure with analogies
- Retrieval from relevant educational content
- Memory storage for future conversations

**When to Use**:
- ✅ General information requests
- ✅ Educational explanations
- ✅ Casual conversations
- ✅ Quick fact-checking

---

## 2. Multi-Step Reasoning Workflow

**Best for**: Complex analysis, multi-faceted questions, research tasks, strategic thinking

### Example Scenario: "Environmental Impact Analysis"

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Analyze the environmental and economic impacts of electric vehicles, considering manufacturing, usage, and disposal phases. Compare with traditional vehicles and provide recommendations.",
    "persona": "research_analyst",
    "user_id": "user_12345",
    "workflow_type": "multi_step_reasoning",
    "config": {
      "enable_approval": false,
      "max_reasoning_steps": 5,
      "enable_memory_maintenance": false,
      "cache_enabled": true,
      "confidence_threshold": 0.8
    }
  }
}
```

**Expected Response**:
- **Step 1**: Manufacturing impact analysis
- **Step 2**: Usage phase comparison  
- **Step 3**: End-of-life disposal assessment
- **Step 4**: Economic cost-benefit analysis
- **Step 5**: Synthesis and recommendations
- Structured data presentation with evidence sources

**When to Use**:
- ✅ Complex research questions
- ✅ Multi-dimensional analysis
- ✅ Strategic decision support
- ✅ Academic research assistance
- ✅ Business analysis tasks

---

## 3. Human Approval Workflow

**Best for**: Sensitive topics, financial advice, medical questions, legal guidance, ethical dilemmas

### Example Scenario: "Investment Advice Request"

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Should I invest my entire life savings of $50,000 in Bitcoin? I'm 25 years old and this represents all my money.",
    "persona": "helpful_assistant",
    "user_id": "user_12345",
    "workflow_type": "human_approval",
    "config": {
      "enable_approval": true,
      "max_reasoning_steps": 3,
      "enable_memory_maintenance": true,
      "cache_enabled": true,
      "confidence_threshold": 0.9,
      "approval_timeout_ms": 300000
    }
  }
}
```

**Expected Process**:
1. **Risk Assessment**: High-risk financial advice detected
2. **Approval Request**: Human reviewer notified
3. **Pending State**: Workflow pauses for approval
4. **Approved Response**: Balanced, responsible financial guidance
5. **Safety Measures**: Clear disclaimers and risk warnings

**Approval Resume Example**:
```json
{
  "tool": "resume_workflow", 
  "arguments": {
    "thread_id": "thread_abc123",
    "workflow_id": "workflow_xyz789",
    "approval_result": {
      "approved": true,
      "feedback": "Provide balanced advice with strong risk warnings"
    }
  }
}
```

**When to Use**:
- ✅ Financial investment advice
- ✅ Medical symptom discussions
- ✅ Legal guidance requests
- ✅ Ethical dilemma resolution
- ✅ High-stakes decision support

---

## 4. Memory Maintenance Workflow

**Best for**: Performance optimization, memory cleanup, system maintenance, troubleshooting

### Example Scenario: "System Optimization"

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "My conversations have been feeling slow lately. Can you optimize my memory and clean up old data?",
    "persona": "helpful_assistant", 
    "user_id": "user_12345",
    "workflow_type": "memory_maintenance",
    "config": {
      "enable_approval": false,
      "max_reasoning_steps": 1,
      "enable_memory_maintenance": true,
      "cache_enabled": false,
      "confidence_threshold": 0.5
    }
  }
}
```

**Expected Process**:
1. **Memory Analysis**: Evaluate current memory usage
2. **Cleanup Operations**: Remove outdated/low-value memories
3. **Compression**: Optimize frequently accessed memories
4. **Archival**: Move old conversations to long-term storage
5. **Performance Report**: Summary of improvements

**Maintenance Results**:
- Archived conversations older than 30 days
- Compressed 150 frequent memories
- Deleted 45 low-confidence facts
- Resolved 12 memory conflicts
- Improved response time by 23%

**When to Use**:
- ✅ Performance optimization
- ✅ Regular system maintenance
- ✅ Memory cleanup requests
- ✅ Troubleshooting slow responses

---

## 5. Cross-Persona Coordination Workflow

**Best for**: Multi-disciplinary questions, complex projects requiring multiple expertise areas, collaborative analysis

### Example Scenario: "Elderly Mobile App Design"

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "I need to design a mobile app for elderly users to manage their medications. Cover both the technical implementation using React Native and the user experience design principles for accessibility.",
    "persona": "helpful_assistant",
    "user_id": "user_12345", 
    "workflow_type": "cross_persona_coordination",
    "config": {
      "enable_approval": false,
      "max_reasoning_steps": 3,
      "enable_memory_maintenance": true,
      "cache_enabled": true,
      "confidence_threshold": 0.7
    }
  }
}
```

**Expected Process**:
1. **Analysis Phase**: Identify need for technical AND UX expertise
2. **Technical Expert**: React Native implementation details
3. **UX Designer**: Accessibility principles for elderly users
4. **Synthesis**: Integrated comprehensive solution

**Cross-Persona Response Flow**:
```
Helpful Assistant: "This requires both technical and design expertise..."
    ↓ Handoff
Technical Expert: "For React Native implementation, consider..."
    ↓ Handoff  
UX Designer: "For elderly users, accessibility means..."
    ↓ Synthesis
Helpful Assistant: "Combining both perspectives..."
```

**When to Use**:
- ✅ Multi-disciplinary projects
- ✅ Technical + creative requirements
- ✅ Business + technical analysis
- ✅ Research + implementation needs
- ✅ Strategic + tactical planning

---

## Advanced Usage Patterns

### Chaining Workflows

For complex projects, chain multiple workflows:

1. **Research Phase**: `multi_step_reasoning` for analysis
2. **Implementation Phase**: `cross_persona_coordination` for execution
3. **Review Phase**: `human_approval` for validation

### Thread Continuity

Use `thread_id` to maintain conversation context:

```json
{
  "query": "Continue our previous discussion about the mobile app",
  "thread_id": "thread_abc123",
  "workflow_type": "cross_persona_coordination"
}
```

### Performance Optimization

**Enable Caching**:
```json
"config": {
  "cache_enabled": true,
  "confidence_threshold": 0.8
}
```

**Memory Management**:
```json
"config": {
  "enable_memory_maintenance": true
}
```

## Configuration Guide

### Key Parameters

- **`confidence_threshold`**: Higher values (0.8-0.9) for critical decisions, lower (0.5-0.7) for exploratory tasks
- **`max_reasoning_steps`**: 3-5 for most tasks, 7-10 for very complex analysis
- **`enable_approval`**: Always true for sensitive content
- **`cache_enabled`**: True for performance, false for real-time data needs

### Persona Selection

- **`helpful_assistant`**: General conversations, explanations
- **`technical_expert`**: Programming, system architecture, debugging
- **`research_analyst`**: Data analysis, research, strategic thinking
- **`creative_writer`**: Content creation, storytelling, creative projects

## Troubleshooting

### Common Issues

**Slow Response Times**:
- Run `memory_maintenance` workflow
- Enable caching in config
- Reduce `max_reasoning_steps`

**Incomplete Responses**:
- Increase `confidence_threshold`
- Use `multi_step_reasoning` for complex queries
- Check if `human_approval` is blocking progress

**Workflow Interruptions**:
- Check approval status with `get_workflow_status`
- Resume with `resume_workflow` if needed
- Use `cancel_workflow` to restart

### Monitoring Tools

**Check Status**:
```json
{
  "tool": "get_workflow_status",
  "arguments": {
    "workflow_id": "workflow_xyz789",
    "include_metadata": true
  }
}
```

**List Active Workflows**:
```json
{
  "tool": "list_active_workflows", 
  "arguments": {
    "user_id": "user_12345",
    "limit": 10
  }
}
```

**Performance Metrics**:
```json
{
  "tool": "get_workflow_metrics",
  "arguments": {
    "time_range": "24h",
    "user_id": "user_12345",
    "include_detailed": true
  }
}
```

## Best Practices

### Workflow Selection

1. **Start Simple**: Use `zero_vector_conversation` for most queries
2. **Escalate Complexity**: Move to `multi_step_reasoning` for analysis
3. **Safety First**: Use `human_approval` for sensitive topics
4. **Optimize Performance**: Run `memory_maintenance` regularly
5. **Leverage Expertise**: Use `cross_persona_coordination` for multi-domain tasks

### Configuration Tips

- **Development**: Lower thresholds, more reasoning steps
- **Production**: Higher thresholds, optimized for performance
- **Sensitive Data**: Always enable approval workflows
- **High Volume**: Enable caching and memory maintenance

### Error Prevention

- Always specify `user_id` for personalization
- Use appropriate `persona` for your task type
- Set realistic `max_reasoning_steps` (avoid timeout)
- Include `thread_id` for conversation continuity

---

## Quick Reference

| Workflow Type | Best For | Key Config | Response Time |
|---------------|----------|------------|---------------|
| `zero_vector_conversation` | General Q&A | `confidence_threshold: 0.7` | Fast (1-3s) |
| `multi_step_reasoning` | Complex analysis | `max_reasoning_steps: 5` | Medium (5-15s) |
| `human_approval` | Sensitive content | `enable_approval: true` | Variable (depends on approval) |
| `memory_maintenance` | Performance | `cache_enabled: false` | Medium (5-10s) |
| `cross_persona_coordination` | Multi-expertise | `confidence_threshold: 0.7` | Medium (5-20s) |

Ready to start using Zero-Vector-3 workflows? Pick a scenario that matches your needs and adapt the examples above. The system is designed to be intuitive while providing powerful capabilities for complex AI interactions.
