# Using Workflows in Zero-Vector-3: End-User Guide

## Overview

Zero-Vector-3 provides powerful workflow capabilities through its Model Context Protocol (MCP) interface. This guide shows you how to interact with advanced workflows without needing to understand the underlying technical implementation. You can execute sophisticated multi-step reasoning, cross-persona collaboration, and custom workflows through simple MCP tool calls.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Basic Workflow Execution](#basic-workflow-execution)
3. [Multi-Step Reasoning Workflows](#multi-step-reasoning-workflows)
4. [Cross-Persona Workflows](#cross-persona-workflows)
5. [Human Approval Workflows](#human-approval-workflows)
6. [Memory Maintenance Workflows](#memory-maintenance-workflows)
7. [Monitoring and Status](#monitoring-and-status)
8. [Advanced Usage](#advanced-usage)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

## Getting Started

### Prerequisites

1. **Zero-Vector-3 MCP Server**: Ensure the MCP server is running and connected
2. **User ID**: You'll need a unique user ID for personalized workflows
3. **API Access**: Verify you have access to the workflow tools

### Available Workflow Tools

The MCP server provides these workflow tools:

- `execute_workflow` - Execute any workflow type
- `get_workflow_status` - Check workflow progress
- `resume_workflow` - Resume interrupted workflows
- `cancel_workflow` - Cancel running workflows
- `list_active_workflows` - View all active workflows
- `get_workflow_metrics` - Get performance statistics

### Quick Start Example

Here's your first workflow execution:

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Explain machine learning to me",
    "user_id": "your_user_id_here",
    "persona": "helpful_assistant"
  }
}
```

## Basic Workflow Execution

### Default Conversation Workflow

The simplest way to use Zero-Vector-3 is through the default conversation workflow:

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "What are the benefits of renewable energy?",
    "user_id": "user123",
    "persona": "helpful_assistant",
    "workflow_type": "zero_vector_conversation"
  }
}
```

**What happens**: The system retrieves relevant information, processes it through your chosen persona, and provides a comprehensive response.

### Choosing Different Personas

Available personas and their specialties:

- `helpful_assistant` - General questions and explanations
- `technical_expert` - Programming, software, and technical topics
- `creative_writer` - Creative content, storytelling, writing assistance
- `data_analyst` - Data analysis, statistics, research insights
- `domain_specialist` - Specialized knowledge in specific fields

**Example with Technical Expert**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "How do I optimize database queries?",
    "user_id": "user123",
    "persona": "technical_expert"
  }
}
```

### Basic Configuration Options

You can customize workflow behavior with these configuration options:

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Your question here",
    "user_id": "user123",
    "persona": "helpful_assistant",
    "config": {
      "cache_enabled": true,
      "enable_memory_maintenance": true,
      "confidence_threshold": 0.7
    }
  }
}
```

**Configuration Options**:
- `cache_enabled` (true/false) - Use cached results for faster responses
- `enable_memory_maintenance` (true/false) - Allow automatic memory optimization
- `confidence_threshold` (0-1) - Minimum confidence for responses

## Multi-Step Reasoning Workflows

### When to Use Multi-Step Reasoning

Use this workflow for:
- Complex questions requiring analysis
- Problems that need to be broken down
- Topics requiring multiple perspectives
- Research-intensive queries

### Basic Multi-Step Reasoning

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "How would implementing universal basic income affect economic inequality and social mobility in developed countries?",
    "user_id": "user123",
    "persona": "data_analyst",
    "workflow_type": "multi_step_reasoning",
    "config": {
      "max_reasoning_steps": 5,
      "confidence_threshold": 0.8
    }
  }
}
```

### Advanced Multi-Step Configuration

For more complex reasoning:

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Analyze the long-term implications of quantum computing on cybersecurity, considering both threats and opportunities",
    "user_id": "user123",
    "persona": "technical_expert",
    "workflow_type": "multi_step_reasoning",
    "config": {
      "max_reasoning_steps": 7,
      "confidence_threshold": 0.85,
      "enable_approval": false,
      "cache_enabled": true
    }
  }
}
```

**Multi-Step Reasoning Config Options**:
- `max_reasoning_steps` (1-10) - Maximum analysis steps
- `confidence_threshold` (0-1) - Required confidence for each step
- `decomposition_strategy` - How to break down the question

### Understanding Multi-Step Results

The response will include:
- **Reasoning Steps**: Each sub-question analyzed
- **Confidence Scores**: How certain the AI is about each part
- **Synthesis**: Final integrated answer
- **Metadata**: Process details and quality metrics

## Cross-Persona Workflows

### When to Use Cross-Persona Workflows

Perfect for:
- Questions requiring multiple expert perspectives
- Comparative analysis
- Comprehensive topic coverage
- Balanced viewpoints on complex issues

### Basic Cross-Persona Usage

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Compare the advantages and disadvantages of different programming paradigms for building scalable web applications",
    "user_id": "user123",
    "workflow_type": "cross_persona",
    "config": {
      "max_personas": 3,
      "enable_approval": false
    }
  }
}
```

### Advanced Cross-Persona Configuration

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Provide a comprehensive analysis of climate change solutions from technical, economic, and policy perspectives",
    "user_id": "user123",
    "workflow_type": "cross_persona",
    "config": {
      "max_personas": 4,
      "synthesis_method": "weighted_consensus",
      "include_conflict_resolution": true,
      "confidence_threshold": 0.75
    }
  }
}
```

**Cross-Persona Config Options**:
- `max_personas` (2-5) - Number of expert perspectives
- `synthesis_method` - How to combine perspectives
- `include_conflict_resolution` - Address disagreements
- `perspective_depth` - Detail level for each viewpoint

### Understanding Cross-Persona Results

The response includes:
- **Individual Perspectives**: Each persona's specialized input
- **Expertise Areas**: What each persona contributed
- **Synthesis**: Integrated final answer
- **Conflict Resolution**: How disagreements were handled
- **Consensus Points**: Areas of agreement

## Human Approval Workflows

### When Human Approval is Needed

Automatic triggers for approval:
- Sensitive topics (financial, medical, legal advice)
- High-risk decisions
- Personal data processing
- Content requiring verification

### Manual Human Approval Request

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Should I invest my savings in cryptocurrency?",
    "user_id": "user123",
    "persona": "domain_specialist",
    "workflow_type": "human_approval",
    "config": {
      "enable_approval": true,
      "risk_assessment": "high",
      "approval_timeout": 300
    }
  }
}
```

**Approval Config Options**:
- `enable_approval` (true/false) - Force human review
- `risk_assessment` - Risk level (low/medium/high)
- `approval_timeout` - Seconds to wait for approval
- `sensitive_topics` - Custom sensitivity list

### Handling Approval Workflows

1. **Submit Request**: Execute workflow with approval enabled
2. **Wait for Review**: Workflow pauses for human review
3. **Check Status**: Monitor workflow status
4. **Resume or Cancel**: Based on approval decision

**Check approval status**:
```json
{
  "tool": "get_workflow_status",
  "arguments": {
    "workflow_id": "workflow_12345",
    "include_metadata": true
  }
}
```

**Resume after approval**:
```json
{
  "tool": "resume_workflow",
  "arguments": {
    "thread_id": "thread_67890",
    "approval_result": {
      "approved": true,
      "feedback": "Proceed with general guidance only"
    }
  }
}
```

## Memory Maintenance Workflows

### Automatic Memory Maintenance

Zero-Vector-3 automatically maintains your memory, but you can trigger maintenance manually:

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "user_id": "user123",
    "workflow_type": "memory_maintenance",
    "config": {
      "maintenance_type": "comprehensive",
      "archive_threshold_days": 30,
      "cleanup_low_confidence": true
    }
  }
}
```

### Maintenance Types

- `basic` - Quick cleanup and optimization
- `standard` - Regular maintenance with archival
- `comprehensive` - Deep analysis and reorganization
- `emergency` - Fix corrupted or inconsistent memory

### Memory Maintenance Configuration

```json
{
  "config": {
    "maintenance_type": "standard",
    "archive_threshold_days": 60,
    "cleanup_low_confidence": true,
    "compress_old_conversations": true,
    "resolve_conflicts": true,
    "update_relationships": true
  }
}
```

**Maintenance Options**:
- `archive_threshold_days` - Age for archiving old memories
- `cleanup_low_confidence` - Remove unreliable information
- `compress_old_conversations` - Summarize old chats
- `resolve_conflicts` - Fix contradictory information
- `update_relationships` - Refresh knowledge connections

## Monitoring and Status

### Checking Workflow Status

**Basic Status Check**:
```json
{
  "tool": "get_workflow_status",
  "arguments": {
    "workflow_id": "workflow_12345"
  }
}
```

**Detailed Status with Metadata**:
```json
{
  "tool": "get_workflow_status",
  "arguments": {
    "workflow_id": "workflow_12345",
    "thread_id": "thread_67890",
    "include_metadata": true
  }
}
```

### Understanding Status Responses

Status values and meanings:
- `running` - Workflow is currently executing
- `interrupted` - Paused for human approval
- `completed` - Successfully finished
- `failed` - Encountered an error
- `cancelled` - Manually stopped

### Listing Active Workflows

**View all your active workflows**:
```json
{
  "tool": "list_active_workflows",
  "arguments": {
    "user_id": "user123",
    "limit": 20
  }
}
```

**Filter by workflow type**:
```json
{
  "tool": "list_active_workflows",
  "arguments": {
    "user_id": "user123",
    "workflow_type": "multi_step_reasoning",
    "status": "running"
  }
}
```

### Performance Metrics

**Get workflow performance data**:
```json
{
  "tool": "get_workflow_metrics",
  "arguments": {
    "time_range": "24h",
    "user_id": "user123",
    "include_detailed": true
  }
}
```

**Time Range Options**:
- `1h` - Last hour
- `24h` - Last 24 hours  
- `7d` - Last week
- `30d` - Last month

## Advanced Usage

### Chaining Workflows

You can run multiple workflows in sequence by using thread IDs:

**Step 1 - Initial Analysis**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "What are the main challenges in renewable energy adoption?",
    "user_id": "user123",
    "persona": "technical_expert",
    "workflow_type": "multi_step_reasoning"
  }
}
```

**Step 2 - Follow-up with Different Perspective**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Now analyze the economic and policy aspects of these challenges",
    "user_id": "user123",
    "thread_id": "thread_from_step1",
    "workflow_type": "cross_persona"
  }
}
```

### Custom Configuration Profiles

Create reusable configuration profiles:

**Research Profile**:
```json
{
  "config": {
    "max_reasoning_steps": 7,
    "confidence_threshold": 0.85,
    "cache_enabled": true,
    "enable_memory_maintenance": true,
    "max_personas": 3,
    "include_conflict_resolution": true
  }
}
```

**Quick Response Profile**:
```json
{
  "config": {
    "max_reasoning_steps": 3,
    "confidence_threshold": 0.7,
    "cache_enabled": true,
    "enable_approval": false,
    "max_personas": 1
  }
}
```

### Workflow Cancellation

**Cancel a running workflow**:
```json
{
  "tool": "cancel_workflow",
  "arguments": {
    "workflow_id": "workflow_12345",
    "reason": "No longer needed"
  }
}
```

## Troubleshooting

### Common Issues and Solutions

#### Issue: Workflow Takes Too Long

**Problem**: Workflow runs for several minutes without response

**Solutions**:
1. Check if workflow requires human approval
2. Reduce `max_reasoning_steps` 
3. Use simpler workflow types
4. Enable caching for faster responses

```json
{
  "config": {
    "max_reasoning_steps": 3,
    "cache_enabled": true,
    "confidence_threshold": 0.6
  }
}
```

#### Issue: Low Quality Responses

**Problem**: Answers are too brief or lack detail

**Solutions**:
1. Use multi-step reasoning for complex topics
2. Try cross-persona workflows for comprehensive coverage
3. Increase confidence threshold
4. Use specialized personas

```json
{
  "workflow_type": "multi_step_reasoning",
  "persona": "domain_specialist",
  "config": {
    "confidence_threshold": 0.85,
    "max_reasoning_steps": 5
  }
}
```

#### Issue: Workflow Fails with Errors

**Problem**: Workflow returns error messages

**Solutions**:
1. Check workflow status for error details
2. Verify user_id is correct
3. Ensure query is not empty
4. Try simpler workflow configuration

**Check error details**:
```json
{
  "tool": "get_workflow_status",
  "arguments": {
    "workflow_id": "workflow_12345",
    "include_metadata": true
  }
}
```

#### Issue: Inconsistent Results

**Problem**: Same question gives different answers

**Solutions**:
1. Enable caching for consistent results
2. Use higher confidence thresholds
3. Run memory maintenance
4. Specify the same persona consistently

```json
{
  "config": {
    "cache_enabled": true,
    "confidence_threshold": 0.8
  },
  "persona": "technical_expert"
}
```

### Error Codes and Meanings

- `INVALID_QUERY` - Question is empty or malformed
- `USER_NOT_FOUND` - User ID doesn't exist
- `WORKFLOW_TIMEOUT` - Execution took too long
- `APPROVAL_REQUIRED` - Human review needed
- `MEMORY_ERROR` - Issue accessing user memory
- `SYSTEM_OVERLOAD` - Server is busy, try again later

### Getting Help

If you continue experiencing issues:

1. **Check System Status**: Verify Zero-Vector-3 server is running
2. **Review Logs**: Check workflow execution logs
3. **Simplify Request**: Try with basic configuration
4. **Contact Support**: Provide workflow ID and error details

## Best Practices

### Choosing the Right Workflow

**For Simple Questions**:
- Use: `zero_vector_conversation`
- Persona: `helpful_assistant`
- Config: Default settings

**For Complex Analysis**:
- Use: `multi_step_reasoning`
- Persona: Relevant specialist
- Config: Higher reasoning steps and confidence

**For Multiple Perspectives**:
- Use: `cross_persona`
- Config: 3-4 personas maximum
- Enable conflict resolution

**For Sensitive Topics**:
- Use: Any workflow with `enable_approval: true`
- Config: Appropriate risk assessment
- Set reasonable timeout

### Optimizing Performance

**Enable Caching**:
```json
{
  "config": {
    "cache_enabled": true
  }
}
```

**Use Appropriate Complexity**:
- Simple questions: 1-3 reasoning steps
- Complex analysis: 5-7 reasoning steps
- Research queries: 3-5 personas

**Monitor Resource Usage**:
- Check workflow metrics regularly
- Cancel unnecessary long-running workflows
- Use memory maintenance periodically

### Writing Effective Queries

**Be Specific**:
- ❌ "Tell me about AI"
- ✅ "Explain how transformer neural networks work in natural language processing"

**Provide Context**:
- ❌ "How do I fix this?"
- ✅ "How do I fix memory leaks in a Node.js application handling large datasets?"

**Use Clear Intent**:
- ❌ "Compare stuff"
- ✅ "Compare the advantages and disadvantages of SQL vs NoSQL databases for e-commerce applications"

### Managing Memory and Privacy

**Regular Maintenance**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "user_id": "user123",
    "workflow_type": "memory_maintenance",
    "config": {
      "maintenance_type": "standard"
    }
  }
}
```

**Privacy-Conscious Usage**:
- Use approval workflows for sensitive topics
- Regularly clean up old conversations
- Be mindful of personal information in queries

### Workflow Naming and Organization

**Use Descriptive Thread IDs** (when supported):
- Include topic and date
- Example: "renewable_energy_analysis_2024_06"

**Track Important Workflows**:
- Save workflow IDs for complex analyses
- Document configuration that works well
- Monitor long-running processes

## Examples and Use Cases

### Research and Analysis

**Academic Research**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Analyze the impact of social media on adolescent mental health, considering psychological, social, and technological factors",
    "user_id": "researcher123",
    "workflow_type": "cross_persona",
    "config": {
      "max_personas": 4,
      "confidence_threshold": 0.85,
      "include_conflict_resolution": true
    }
  }
}
```

### Technical Problem Solving

**Software Architecture**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Design a microservices architecture for a high-traffic e-commerce platform, considering scalability, reliability, and cost optimization",
    "user_id": "developer456",
    "persona": "technical_expert",
    "workflow_type": "multi_step_reasoning",
    "config": {
      "max_reasoning_steps": 6,
      "confidence_threshold": 0.8
    }
  }
}
```

### Creative Projects

**Content Creation**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Develop a comprehensive content strategy for a sustainable fashion brand targeting millennials and Gen Z",
    "user_id": "marketer789",
    "persona": "creative_writer",
    "workflow_type": "cross_persona",
    "config": {
      "max_personas": 3,
      "synthesis_method": "creative_fusion"
    }
  }
}
```

### Business Analysis

**Market Research**:
```json
{
  "tool": "execute_workflow",
  "arguments": {
    "query": "Evaluate the market opportunity for AI-powered personal fitness coaching apps in the European market",
    "user_id": "analyst101",
    "persona": "data_analyst",
    "workflow_type": "multi_step_reasoning",
    "config": {
      "max_reasoning_steps": 5,
      "confidence_threshold": 0.75,
      "enable_approval": true
    }
  }
}
```

## Conclusion

Zero-Vector-3 workflows provide powerful AI capabilities accessible through simple MCP tool calls. By understanding the different workflow types and configuration options, you can:

- **Get Better Results**: Choose the right workflow for your needs
- **Save Time**: Use caching and appropriate complexity levels
- **Ensure Quality**: Leverage multi-step reasoning and cross-persona collaboration
- **Maintain Privacy**: Use approval workflows for sensitive topics
- **Scale Your Usage**: Monitor and optimize performance

### Quick Reference

**Workflow Types**:
- `zero_vector_conversation` - Default, general questions
- `multi_step_reasoning` - Complex analysis
- `cross_persona` - Multiple perspectives  
- `human_approval` - Sensitive content review
- `memory_maintenance` - System optimization

**Key Configuration Options**:
- `max_reasoning_steps` (1-10) - Analysis depth
- `confidence_threshold` (0-1) - Quality requirements
- `max_personas` (2-5) - Number of perspectives
- `cache_enabled` (true/false) - Performance optimization
- `enable_approval` (true/false) - Human oversight

**Essential Tools**:
- `execute_workflow` - Run any workflow
- `get_workflow_status` - Monitor progress
- `list_active_workflows` - View running workflows
- `cancel_workflow` - Stop workflows
- `get_workflow_metrics` - Performance data

Start with simple conversations and gradually explore more advanced workflows as you become comfortable with the system. The AI will learn your preferences and provide increasingly personalized and useful responses.
