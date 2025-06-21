# Advanced Workflows for Zero-Vector-3

## Overview

Zero-Vector-3 implements sophisticated LangGraph-based workflows that enable multi-step reasoning, cross-persona coordination, and advanced memory management. This document provides comprehensive guidance for developers to create, extend, and optimize custom workflows within the zero-vector-3 system.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Current Workflow Types](#current-workflow-types)
3. [Multi-Step Reasoning Workflows](#multi-step-reasoning-workflows)
4. [Cross-Persona Workflows](#cross-persona-workflows)
5. [Creating Custom Workflows](#creating-custom-workflows)
6. [Permanent Workflow Integration](#permanent-workflow-integration)
7. [Performance Optimization](#performance-optimization)
8. [Testing and Debugging](#testing-and-debugging)
9. [Advanced Patterns](#advanced-patterns)

## Architecture Overview

### Core Components

The Zero-Vector-3 workflow system is built on LangGraph and consists of:

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   LangGraph Nodes   │────│   State Management   │────│   Service Layer     │
│   (Workflow Steps)  │    │   (ZeroVectorState)  │    │   (Memory, Cache)   │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
           │                          │                          │
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   Routing Logic     │    │   Checkpointer       │    │   MCP Interface     │
│   (Conditional)     │    │   (Persistence)      │    │   (External Access) │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```

### State Schema

The workflow state is defined in `ZeroVectorState.js` and includes:

```javascript
const ZeroVectorState = {
  // Core messaging
  messages: [],              // Conversation history
  active_persona: '',        // Current persona ID
  user_profile: {},          // User context and preferences
  
  // Memory and retrieval
  vector_results: [],        // Hybrid retrieval results
  graph_relationships: [],   // Knowledge graph relationships
  memory_context: {},        // Memory metadata and context
  
  // Workflow control
  workflow_context: {},      // Workflow metadata and tracking
  current_step: '',          // Current workflow step
  reasoning_path: [],        // Decision history
  requires_approval: false,  // Human-in-the-loop flag
  
  // Advanced features
  execution_metadata: {},    // Performance and timing data
  features: {},              // Feature flags and configuration
  errors: [],                // Error tracking and recovery
  
  // Memory management
  memory_maintenance_required: false,
  memory_maintenance_reason: '',
  memory_maintenance_results: {},
  
  // Persona context
  persona_context: {}        // Persona-specific context
};
```

## Current Workflow Types

### 1. Zero Vector Conversation (Default)
Basic conversational workflow with hybrid retrieval and persona processing.

**Flow**: `retrieve → persona_process → finalize`

```javascript
// Usage via MCP
{
  "workflow_type": "zero_vector_conversation",
  "query": "Tell me about machine learning",
  "persona": "technical_expert",
  "user_id": "user123"
}
```

### 2. Multi-Step Reasoning
Complex reasoning workflow for queries requiring decomposition and analysis.

**Flow**: `retrieve → reason → persona_process → finalize`

```javascript
// Usage via MCP
{
  "workflow_type": "multi_step_reasoning",
  "query": "How would implementing quantum computing affect current AI architectures?",
  "config": {
    "max_reasoning_steps": 5,
    "confidence_threshold": 0.8
  }
}
```

### 3. Human Approval
Workflow requiring human oversight for sensitive or high-risk content.

**Flow**: `retrieve → human_approval → persona_process → finalize`

```javascript
// Usage via MCP
{
  "workflow_type": "human_approval",
  "query": "Generate a financial investment recommendation",
  "config": {
    "enable_approval": true,
    "risk_assessment": "high"
  }
}
```

### 4. Memory Maintenance
Background workflow for optimizing and maintaining memory systems.

**Flow**: `memory_maintenance → finalize`

```javascript
// Triggered automatically or via MCP
{
  "workflow_type": "memory_maintenance",
  "user_id": "user123",
  "config": {
    "maintenance_type": "comprehensive",
    "archive_threshold_days": 30
  }
}
```

## Multi-Step Reasoning Workflows

### Architecture

Multi-step reasoning workflows decompose complex queries into manageable sub-problems, process each step, and synthesize final results.

### Implementation Guide

#### 1. Create Custom Reasoning Agent

```javascript
// File: src/agents/AdvancedReasoningAgent.js
class AdvancedReasoningAgent {
  constructor(llm, config) {
    this.llm = llm;
    this.config = config;
    this.maxSteps = config.max_reasoning_steps || 5;
    this.confidenceThreshold = config.confidence_threshold || 0.7;
  }

  async __call__(state) {
    const query = state.messages[state.messages.length - 1].content;
    
    // Step 1: Analyze query complexity
    const complexity = await this.analyzeComplexity(query);
    
    // Step 2: Decompose into sub-queries
    const subQueries = await this.decompose(query, complexity);
    
    // Step 3: Process each sub-query
    const subResults = [];
    for (const subQuery of subQueries) {
      const result = await this.processSubQuery(subQuery, state);
      subResults.push(result);
      
      // Early termination if confidence is low
      if (result.confidence < this.confidenceThreshold) {
        break;
      }
    }
    
    // Step 4: Synthesize final answer
    const finalAnswer = await this.synthesize(subResults, query);
    
    // Update state
    return {
      ...state,
      messages: [...state.messages, {
        type: 'ai',
        content: finalAnswer.content,
        additional_kwargs: {
          reasoning_steps: subResults.length,
          confidence_score: finalAnswer.confidence,
          sub_queries: subQueries
        }
      }],
      reasoning_path: [...state.reasoning_path, 
        `Advanced reasoning with ${subResults.length} steps`
      ]
    };
  }

  async analyzeComplexity(query) {
    const indicators = {
      length: query.length,
      questionWords: (query.match(/\b(how|why|what|when|where|which)\b/gi) || []).length,
      conditionals: (query.match(/\b(if|when|unless|provided|assuming)\b/gi) || []).length,
      conjunctions: (query.match(/\b(and|or|but|however|therefore)\b/gi) || []).length,
      causality: (query.match(/\b(because|due to|results in|leads to)\b/gi) || []).length
    };

    let score = 0;
    if (indicators.length > 150) score += 2;
    if (indicators.questionWords > 2) score += 2;
    if (indicators.conditionals > 1) score += 3;
    if (indicators.conjunctions > 3) score += 2;
    if (indicators.causality > 0) score += 3;

    return {
      score,
      level: score >= 8 ? 'very_complex' : score >= 5 ? 'complex' : 'moderate',
      indicators,
      estimated_steps: Math.min(Math.ceil(score / 2), this.maxSteps)
    };
  }

  async decompose(query, complexity) {
    const prompt = `
    Decompose this complex query into ${complexity.estimated_steps} logical sub-questions:
    Query: "${query}"
    
    Return as JSON array of sub-questions, ordered from foundational to specific:
    `;

    const response = await this.llm.invoke(prompt);
    try {
      return JSON.parse(response.content);
    } catch {
      // Fallback decomposition
      return [query];
    }
  }

  async processSubQuery(subQuery, state) {
    // Use vector search for relevant context
    const vectorResults = state.vector_results || [];
    const relevantContext = vectorResults
      .filter(result => this.calculateRelevance(subQuery, result.content) > 0.5)
      .slice(0, 3);

    const prompt = `
    Context: ${relevantContext.map(r => r.content).join('\n')}
    
    Sub-question: ${subQuery}
    
    Provide a focused answer with confidence score (0-1):
    `;

    const response = await this.llm.invoke(prompt);
    
    return {
      sub_query: subQuery,
      answer: response.content,
      confidence: this.extractConfidence(response.content),
      context_used: relevantContext.length
    };
  }

  async synthesize(subResults, originalQuery) {
    const answersText = subResults
      .map((r, i) => `${i + 1}. ${r.sub_query}\nAnswer: ${r.answer}`)
      .join('\n\n');

    const prompt = `
    Original question: "${originalQuery}"
    
    Sub-question analysis:
    ${answersText}
    
    Synthesize a comprehensive answer that integrates all insights:
    `;

    const response = await this.llm.invoke(prompt);
    
    return {
      content: response.content,
      confidence: Math.min(...subResults.map(r => r.confidence)) * 0.9,
      synthesis_quality: this.assessSynthesisQuality(subResults, response.content)
    };
  }

  calculateRelevance(query, content) {
    // Simple relevance calculation - in production use embeddings
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase().split(/\s+/);
    const overlap = queryWords.filter(word => contentWords.includes(word)).length;
    return overlap / queryWords.length;
  }

  extractConfidence(text) {
    // Extract confidence if explicitly mentioned, otherwise estimate
    const confMatch = text.match(/confidence[:\s]*([0-9.]+)/i);
    if (confMatch) {
      return parseFloat(confMatch[1]);
    }
    
    // Estimate based on certainty language
    const uncertainWords = ['maybe', 'possibly', 'might', 'could', 'unsure'];
    const certainWords = ['definitely', 'certainly', 'clearly', 'obviously'];
    
    const lowerText = text.toLowerCase();
    const uncertainCount = uncertainWords.filter(word => lowerText.includes(word)).length;
    const certainCount = certainWords.filter(word => lowerText.includes(word)).length;
    
    return Math.max(0.3, Math.min(0.95, 0.7 + (certainCount - uncertainCount) * 0.1));
  }

  assessSynthesisQuality(subResults, synthesis) {
    // Quality metrics for synthesis
    return {
      completeness: subResults.length / this.maxSteps,
      coherence: synthesis.length > 100 ? 0.8 : 0.5,
      integration_score: Math.min(1.0, subResults.length * 0.2)
    };
  }
}

module.exports = AdvancedReasoningAgent;
```

#### 2. Register Reasoning Workflow

```javascript
// In ZeroVectorGraph.js - Add new node
graph.addNode("advanced_reason", this.advancedReasonNode.bind(this));

// Add conditional routing
graph.addConditionalEdges(
  "retrieve",
  this.routeAfterRetrieval.bind(this),
  {
    "simple": "persona_process",
    "complex": "reason",
    "very_complex": "advanced_reason", // New route
    "sensitive": "human_approval",
    "maintenance": "memory_maintenance",
    "error": "error_handler"
  }
);

// Implement the node
async advancedReasonNode(state) {
  const timer = createTimer('advanced_reason_node');
  
  try {
    logWorkflow(state.workflow_context?.workflow_id, 'advanced_reason_start', {
      queryComplexity: state.memory_context?.query_complexity
    });

    const updatedState = ZeroVectorStateManager.updateWorkflowContext(state, {
      ...state.workflow_context,
      current_step: 'advanced_reason',
      completed_steps: [...(state.workflow_context?.completed_steps || []), 'retrieve'],
      reasoning_path: [...(state.workflow_context?.reasoning_path || []), 
        'Applying advanced multi-step reasoning']
    });

    // Execute advanced reasoning
    const reasoningAgent = new AdvancedReasoningAgent(
      this.llm, 
      this.config.advancedReasoning || {}
    );
    
    const result = await reasoningAgent.__call__(updatedState);

    const perfData = timer.end({ reasoningApplied: true });
    logWorkflow(state.workflow_context?.workflow_id, 'advanced_reason_completed', {
      duration: perfData.duration
    });

    return result;

  } catch (error) {
    timer.end({ error: true });
    logError(error, { operation: 'advancedReasonNode' });
    
    return ZeroVectorStateManager.addError(state, {
      code: 'ADVANCED_REASON_ERROR',
      message: error.message,
      step: 'advanced_reason',
      recoverable: true
    });
  }
}
```

## Cross-Persona Workflows

### Architecture

Cross-persona workflows enable multiple AI personas to collaborate on complex tasks, each contributing their specialized expertise.

### Implementation Guide

#### 1. Create Persona Coordination Agent

```javascript
// File: src/agents/PersonaCoordinationAgent.js
class PersonaCoordinationAgent {
  constructor(personaMemoryAgent, config) {
    this.personaMemoryAgent = personaMemoryAgent;
    this.config = config;
    this.availablePersonas = config.available_personas || [
      'helpful_assistant',
      'technical_expert',
      'creative_writer',
      'data_analyst',
      'domain_specialist'
    ];
  }

  async __call__(state) {
    const query = state.messages[state.messages.length - 1].content;
    
    // Step 1: Analyze required expertise
    const requiredExpertise = await this.analyzeExpertiseNeeds(query);
    
    // Step 2: Select appropriate personas
    const selectedPersonas = await this.selectPersonas(requiredExpertise);
    
    // Step 3: Coordinate persona responses
    const personaResponses = [];
    for (const persona of selectedPersonas) {
      const response = await this.getPersonaResponse(persona, query, state, personaResponses);
      personaResponses.push(response);
    }
    
    // Step 4: Synthesize multi-persona response
    const finalResponse = await this.synthesizeResponses(personaResponses, query);
    
    // Update state
    return {
      ...state,
      messages: [...state.messages, {
        type: 'ai',
        content: finalResponse.content,
        additional_kwargs: {
          collaboration_type: 'multi_persona',
          personas_involved: selectedPersonas,
          expertise_areas: requiredExpertise,
          synthesis_quality: finalResponse.quality
        }
      }],
      persona_context: {
        ...baseState.persona_context,
        ...newState.persona_context,
        composed_workflow_history: [
          ...(baseState.persona_context?.composed_workflow_history || []),
          {
            workflow_type: newState.workflow_context?.workflow_type,
            completed_at: new Date().toISOString(),
            output_summary: newState.messages[newState.messages.length - 1]?.content.substring(0, 100)
          }
        ]
      },
      execution_metadata: {
        ...baseState.execution_metadata,
        composed_workflows: (baseState.execution_metadata?.composed_workflows || 0) + 1,
        total_execution_time: (baseState.execution_metadata?.total_execution_time || 0) + 
                              (newState.execution_metadata?.execution_time_ms || 0)
      }
    };
  }

  synthesizeComposedResults(results, originalState) {
    const composedResponse = {
      content: this.generateComposedSummary(results),
      metadata: {
        workflow_count: results.length,
        total_execution_time: results.reduce((sum, r) => 
          sum + (r.execution_metadata?.execution_time_ms || 0), 0),
        composition_quality: this.assessCompositionQuality(results)
      }
    };

    return {
      ...originalState,
      messages: [...originalState.messages, {
        type: 'ai',
        content: composedResponse.content,
        additional_kwargs: {
          workflow_composition: true,
          composed_workflows: results.map(r => r.workflow_context?.workflow_type),
          composition_metadata: composedResponse.metadata
        }
      }],
      workflow_context: {
        ...originalState.workflow_context,
        composed: true,
        composition_results: results.length,
        final_synthesis: composedResponse.metadata
      }
    };
  }

  generateComposedSummary(results) {
    let summary = `## Comprehensive Analysis Results\n\n`;
    
    results.forEach((result, index) => {
      const workflowType = result.workflow_context?.workflow_type || 'unknown';
      const lastMessage = result.messages[result.messages.length - 1];
      
      summary += `### ${index + 1}. ${workflowType.replace(/_/g, ' ').toUpperCase()}\n`;
      summary += `${lastMessage?.content || 'No output generated'}\n\n`;
    });

    summary += `### Integrated Insights\n`;
    summary += this.extractCrossWorkflowInsights(results);

    return summary;
  }

  extractCrossWorkflowInsights(results) {
    // Find common themes across different workflow outputs
    const allOutputs = results
      .map(r => r.messages[r.messages.length - 1]?.content || '')
      .filter(content => content.length > 0);

    if (allOutputs.length === 0) {
      return 'No significant insights could be extracted from the workflow composition.';
    }

    // Simple keyword extraction across workflows
    const commonKeywords = this.findCommonKeywords(allOutputs);
    const conflictingPoints = this.identifyConflicts(allOutputs);

    let insights = `The analysis reveals several key themes: ${commonKeywords.join(', ')}. `;
    
    if (conflictingPoints.length > 0) {
      insights += `Some conflicting perspectives were identified, particularly around: ${conflictingPoints.join(', ')}. `;
    }

    insights += `This multi-workflow approach provides a comprehensive view that individual workflows alone could not achieve.`;

    return insights;
  }

  findCommonKeywords(outputs) {
    const allWords = outputs
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 4);

    const wordCounts = {};
    allWords.forEach(word => {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    });

    return Object.entries(wordCounts)
      .filter(([word, count]) => count >= Math.ceil(outputs.length / 2))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  identifyConflicts(outputs) {
    // Simple conflict identification
    const conflictIndicators = ['however', 'but', 'contrary', 'different', 'opposed'];
    
    return outputs
      .filter(output => 
        conflictIndicators.some(indicator => 
          output.toLowerCase().includes(indicator)
        )
      )
      .map(output => {
        const sentences = output.split(/[.!?]+/);
        return sentences.find(sentence => 
          conflictIndicators.some(indicator => 
            sentence.toLowerCase().includes(indicator)
          )
        )?.trim().substring(0, 50);
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  assessCompositionQuality(results) {
    const totalWorkflows = results.length;
    const successfulWorkflows = results.filter(r => !r.errors || r.errors.length === 0).length;
    const avgExecutionTime = results.reduce((sum, r) => 
      sum + (r.execution_metadata?.execution_time_ms || 0), 0) / totalWorkflows;

    return {
      success_rate: successfulWorkflows / totalWorkflows,
      avg_execution_time_ms: avgExecutionTime,
      composition_efficiency: Math.min(1.0, totalWorkflows / 5), // Optimal at 5 workflows
      output_coherence: this.assessOutputCoherence(results)
    };
  }

  assessOutputCoherence(results) {
    // Simple coherence assessment
    const outputs = results.map(r => r.messages[r.messages.length - 1]?.content || '');
    const avgLength = outputs.reduce((sum, output) => sum + output.length, 0) / outputs.length;
    
    return {
      avg_output_length: avgLength,
      consistency_score: outputs.every(output => output.length > 50) ? 0.8 : 0.5,
      coverage_breadth: Math.min(1.0, outputs.length / 3)
    };
  }
}

module.exports = WorkflowComposer;
```

### Dynamic Workflow Routing

```javascript
// File: zero-vector-3/server/src/patterns/DynamicRouter.js
class DynamicWorkflowRouter {
  constructor(workflowRegistry, routingRules) {
    this.workflows = workflowRegistry;
    this.rules = routingRules;
    this.routingHistory = new Map();
  }

  // Dynamically route based on query analysis and context
  async routeWorkflow(state) {
    const query = state.messages[state.messages.length - 1].content;
    const routingDecision = await this.analyzeAndRoute(query, state);
    
    // Store routing decision for analysis
    this.routingHistory.set(state.workflow_context?.workflow_id, {
      query,
      decision: routingDecision,
      timestamp: new Date().toISOString(),
      context: this.extractRoutingContext(state)
    });

    return routingDecision;
  }

  async analyzeAndRoute(query, state) {
    // Multi-factor routing analysis
    const factors = {
      complexity: await this.analyzeComplexity(query),
      domain: await this.analyzeDomain(query),
      urgency: await this.analyzeUrgency(query, state),
      user_preference: this.getUserPreference(state),
      historical_performance: await this.getHistoricalPerformance(query, state)
    };

    // Apply routing rules
    for (const rule of this.rules) {
      if (await this.evaluateRule(rule, factors, state)) {
        return {
          workflow_type: rule.target_workflow,
          confidence: rule.confidence || 0.8,
          routing_factors: factors,
          rule_applied: rule.name
        };
      }
    }

    // Default routing
    return {
      workflow_type: 'zero_vector_conversation',
      confidence: 0.5,
      routing_factors: factors,
      rule_applied: 'default'
    };
  }

  async analyzeComplexity(query) {
    const indicators = {
      length: query.length,
      questions: (query.match(/\?/g) || []).length,
      concepts: (query.match(/\b(concept|theory|principle|methodology)\b/gi) || []).length,
      comparisons: (query.match(/\b(compare|contrast|versus|vs|difference)\b/gi) || []).length,
      analysis_words: (query.match(/\b(analyze|evaluate|assess|determine|investigate)\b/gi) || []).length
    };

    let score = 0;
    if (indicators.length > 200) score += 3;
    if (indicators.questions > 2) score += 2;
    if (indicators.concepts > 1) score += 2;
    if (indicators.comparisons > 0) score += 3;
    if (indicators.analysis_words > 1) score += 2;

    return {
      score,
      level: score >= 8 ? 'very_high' : score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low',
      indicators
    };
  }

  async analyzeDomain(query) {
    const domains = {
      technical: ['programming', 'software', 'algorithm', 'system', 'code', 'technical'],
      creative: ['creative', 'design', 'art', 'writing', 'story', 'imagination'],
      analytical: ['data', 'analysis', 'statistics', 'research', 'metrics', 'study'],
      business: ['business', 'strategy', 'market', 'finance', 'management', 'operations'],
      academic: ['academic', 'research', 'study', 'theory', 'scientific', 'literature']
    };

    const queryLower = query.toLowerCase();
    const detected = {};

    for (const [domain, keywords] of Object.entries(domains)) {
      const matches = keywords.filter(keyword => queryLower.includes(keyword));
      if (matches.length > 0) {
        detected[domain] = {
          confidence: matches.length / keywords.length,
          matched_terms: matches
        };
      }
    }

    return detected;
  }

  async analyzeUrgency(query, state) {
    const urgencyIndicators = [
      'urgent', 'immediately', 'asap', 'quickly', 'fast', 'emergency',
      'deadline', 'time-sensitive', 'critical', 'important'
    ];

    const queryLower = query.toLowerCase();
    const urgencyScore = urgencyIndicators.filter(indicator => 
      queryLower.includes(indicator)
    ).length;

    return {
      score: urgencyScore,
      level: urgencyScore >= 3 ? 'high' : urgencyScore >= 1 ? 'medium' : 'low',
      requires_fast_path: urgencyScore >= 2
    };
  }

  getUserPreference(state) {
    return {
      preferred_workflow: state.user_profile?.preferences?.default_workflow || 'zero_vector_conversation',
      complexity_preference: state.user_profile?.preferences?.complexity_level || 'adaptive',
      response_style: state.user_profile?.preferences?.response_style || 'balanced'
    };
  }

  async getHistoricalPerformance(query, state) {
    const userId = state.user_profile?.id;
    if (!userId) return { available: false };

    // In production, query actual performance metrics
    // For now, return mock data
    return {
      available: true,
      best_performing_workflow: 'multi_step_reasoning',
      avg_satisfaction: 0.85,
      common_workflows: ['zero_vector_conversation', 'multi_step_reasoning']
    };
  }

  async evaluateRule(rule, factors, state) {
    // Evaluate routing rule conditions
    for (const condition of rule.conditions) {
      if (!await this.evaluateCondition(condition, factors, state)) {
        return false;
      }
    }
    return true;
  }

  async evaluateCondition(condition, factors, state) {
    switch (condition.type) {
      case 'complexity_threshold':
        return factors.complexity.score >= condition.threshold;
      
      case 'domain_match':
        return Object.keys(factors.domain).includes(condition.domain);
      
      case 'urgency_level':
        return factors.urgency.level === condition.level;
      
      case 'user_preference':
        return state.user_profile?.preferences?.[condition.preference] === condition.value;
      
      case 'query_pattern':
        const query = state.messages[state.messages.length - 1].content;
        return new RegExp(condition.pattern, 'i').test(query);
      
      default:
        return false;
    }
  }

  extractRoutingContext(state) {
    return {
      user_id: state.user_profile?.id,
      active_persona: state.active_persona,
      message_count: state.messages?.length || 0,
      has_errors: (state.errors?.length || 0) > 0,
      workflow_history: state.workflow_context?.completed_steps || []
    };
  }

  // Analytics and optimization
  getRoutingAnalytics() {
    const decisions = Array.from(this.routingHistory.values());
    
    return {
      total_routings: decisions.length,
      workflow_distribution: this.calculateWorkflowDistribution(decisions),
      avg_confidence: this.calculateAverageConfidence(decisions),
      most_applied_rules: this.getMostAppliedRules(decisions),
      complexity_trends: this.getComplexityTrends(decisions)
    };
  }

  calculateWorkflowDistribution(decisions) {
    const distribution = {};
    decisions.forEach(decision => {
      const workflow = decision.decision.workflow_type;
      distribution[workflow] = (distribution[workflow] || 0) + 1;
    });
    return distribution;
  }

  calculateAverageConfidence(decisions) {
    if (decisions.length === 0) return 0;
    const totalConfidence = decisions.reduce((sum, d) => sum + d.decision.confidence, 0);
    return totalConfidence / decisions.length;
  }

  getMostAppliedRules(decisions) {
    const ruleCounts = {};
    decisions.forEach(decision => {
      const rule = decision.decision.rule_applied;
      ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
    });
    
    return Object.entries(ruleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rule, count]) => ({ rule, count }));
  }

  getComplexityTrends(decisions) {
    const trends = {
      low: 0, medium: 0, high: 0, very_high: 0
    };
    
    decisions.forEach(decision => {
      const level = decision.decision.routing_factors?.complexity?.level || 'low';
      trends[level] = (trends[level] || 0) + 1;
    });
    
    return trends;
  }
}

// Example routing rules configuration
const defaultRoutingRules = [
  {
    name: 'high_complexity_reasoning',
    conditions: [
      { type: 'complexity_threshold', threshold: 8 }
    ],
    target_workflow: 'multi_step_reasoning',
    confidence: 0.9
  },
  {
    name: 'multi_domain_cross_persona',
    conditions: [
      { type: 'query_pattern', pattern: '(compare|contrast|different perspectives)' }
    ],
    target_workflow: 'cross_persona',
    confidence: 0.85
  },
  {
    name: 'urgent_simple_response',
    conditions: [
      { type: 'urgency_level', level: 'high' },
      { type: 'complexity_threshold', threshold: 3 }
    ],
    target_workflow: 'zero_vector_conversation',
    confidence: 0.8
  },
  {
    name: 'technical_domain_expert',
    conditions: [
      { type: 'domain_match', domain: 'technical' },
      { type: 'complexity_threshold', threshold: 5 }
    ],
    target_workflow: 'technical_expert_workflow',
    confidence: 0.85
  }
];

module.exports = { DynamicWorkflowRouter, defaultRoutingRules };
```

## Conclusion

This Advanced Workflows documentation provides a comprehensive foundation for extending Zero-Vector-3 with sophisticated multi-step reasoning and cross-persona collaboration capabilities. The key takeaways include:

### Key Benefits

1. **Multi-Step Reasoning**: Break down complex queries into manageable sub-problems for more accurate and thorough responses
2. **Cross-Persona Collaboration**: Leverage multiple AI personas to provide diverse perspectives and expertise
3. **Custom Workflow Creation**: Flexible framework for creating domain-specific workflows
4. **Performance Optimization**: Built-in caching and parallel processing for production-scale deployment
5. **Dynamic Routing**: Intelligent workflow selection based on query analysis and user context

### Implementation Path

1. **Start Simple**: Begin with basic multi-step reasoning for complex queries
2. **Add Cross-Persona**: Implement persona coordination for multi-perspective analysis
3. **Create Custom Workflows**: Develop domain-specific workflows for your use cases
4. **Optimize Performance**: Add caching and parallel processing for scale
5. **Dynamic Intelligence**: Implement smart routing and workflow composition

### Best Practices

- **Test Incrementally**: Validate each workflow component before integration
- **Monitor Performance**: Track execution times and quality metrics
- **User Feedback**: Incorporate user satisfaction into workflow optimization
- **Error Handling**: Implement robust error recovery at every step
- **Documentation**: Maintain clear documentation for custom workflows

### Next Steps

1. Implement the basic multi-step reasoning workflow
2. Test with various query complexities and domains
3. Add cross-persona capabilities for comparative analysis
4. Create custom workflows for your specific use cases
5. Deploy with performance monitoring and optimization

This framework transforms Zero-Vector-3 from a simple conversational system into a sophisticated AI orchestration platform capable of handling complex, multi-faceted queries with the depth and nuance of human expert collaboration.
        ...state.persona_context,
        collaboration_history: personaResponses,
        coordination_metadata: {
          selected_personas: selectedPersonas,
          expertise_analysis: requiredExpertise,
          synthesis_timestamp: new Date().toISOString()
        }
      }
    };
  }

  async analyzeExpertiseNeeds(query) {
    // Expertise domains mapping
    const expertiseDomains = {
      technical: ['programming', 'software', 'algorithm', 'technical', 'code', 'system'],
      creative: ['creative', 'writing', 'story', 'design', 'artistic', 'imagination'],
      analytical: ['data', 'analysis', 'statistics', 'research', 'metrics', 'insights'],
      general: ['help', 'explain', 'question', 'information', 'general'],
      domain_specific: ['legal', 'medical', 'financial', 'scientific', 'academic']
    };

    const queryLower = query.toLowerCase();
    const detected = {};

    for (const [domain, keywords] of Object.entries(expertiseDomains)) {
      const matches = keywords.filter(keyword => queryLower.includes(keyword));
      if (matches.length > 0) {
        detected[domain] = {
          confidence: matches.length / keywords.length,
          matched_keywords: matches
        };
      }
    }

    return detected;
  }

  async selectPersonas(expertiseNeeds) {
    // Persona capability mapping
    const personaCapabilities = {
      'helpful_assistant': ['general', 'help', 'explanation'],
      'technical_expert': ['technical', 'programming', 'systems'],
      'creative_writer': ['creative', 'writing', 'storytelling'],
      'data_analyst': ['analytical', 'statistics', 'research'],
      'domain_specialist': ['domain_specific', 'specialized_knowledge']
    };

    const selected = [];
    const expertiseKeys = Object.keys(expertiseNeeds);

    // Always include helpful_assistant as coordinator
    if (expertiseKeys.length > 1) {
      selected.push('helpful_assistant');
    }

    // Select specialists based on expertise needs
    for (const [persona, capabilities] of Object.entries(personaCapabilities)) {
      const relevance = capabilities.filter(cap => expertiseKeys.includes(cap)).length;
      if (relevance > 0 && !selected.includes(persona)) {
        selected.push(persona);
      }
    }

    // Ensure at least one persona is selected
    if (selected.length === 0) {
      selected.push('helpful_assistant');
    }

    return selected.slice(0, this.config.max_personas || 3);
  }

  async getPersonaResponse(persona, query, state, previousResponses) {
    // Create persona-specific context
    const personaState = {
      ...state,
      active_persona: persona,
      messages: [...state.messages],
      persona_context: {
        ...state.persona_context,
        collaboration_mode: true,
        other_personas: previousResponses.map(r => ({
          persona: r.persona,
          summary: r.content.substring(0, 200)
        })),
        assigned_expertise: await this.getPersonaExpertise(persona)
      }
    };

    // Get persona-specific response
    const response = await this.personaMemoryAgent.__call__(personaState);
    
    return {
      persona: persona,
      content: response.messages[response.messages.length - 1].content,
      expertise_applied: await this.getPersonaExpertise(persona),
      context_used: response.persona_context?.memories_retrieved || 0,
      confidence: this.extractConfidence(response.messages[response.messages.length - 1].content)
    };
  }

  async synthesizeResponses(personaResponses, originalQuery) {
    // Create synthesis prompt
    const responseSummary = personaResponses
      .map(r => `**${r.persona}** (${r.expertise_applied.join(', ')}):\n${r.content}`)
      .join('\n\n');

    const synthesisPrompt = `
    Original query: "${originalQuery}"
    
    Multiple expert perspectives:
    ${responseSummary}
    
    Synthesize these perspectives into a comprehensive, coherent response that:
    1. Integrates insights from all experts
    2. Resolves any contradictions
    3. Provides a balanced, well-rounded answer
    4. Maintains clarity and accessibility
    
    Final integrated response:
    `;

    // In a real implementation, this would use an LLM
    // For now, we'll create a structured synthesis
    
    const synthesis = await this.performSynthesis(personaResponses, originalQuery);
    
    return {
      content: synthesis,
      quality: this.assessSynthesisQuality(personaResponses, synthesis),
      integration_score: personaResponses.length / this.availablePersonas.length
    };
  }

  async performSynthesis(responses, query) {
    // Enhanced synthesis logic
    const mainPoints = responses.map(r => this.extractMainPoints(r.content));
    const conflictResolution = this.resolveConflicts(responses);
    
    let synthesis = `Based on multiple expert perspectives:\n\n`;
    
    // Add unique insights from each persona
    responses.forEach(response => {
      const uniqueInsights = this.extractUniqueInsights(response, responses);
      if (uniqueInsights.length > 0) {
        synthesis += `**${response.persona} insights**: ${uniqueInsights.join(', ')}\n\n`;
      }
    });
    
    // Add conflict resolution if needed
    if (conflictResolution.conflicts.length > 0) {
      synthesis += `**Resolving different perspectives**: ${conflictResolution.resolution}\n\n`;
    }
    
    // Add synthesized conclusion
    synthesis += `**Integrated conclusion**: `;
    synthesis += this.generateConclusion(responses, query);
    
    return synthesis;
  }

  async getPersonaExpertise(persona) {
    const expertise = {
      'helpful_assistant': ['general_assistance', 'coordination', 'synthesis'],
      'technical_expert': ['programming', 'systems_design', 'technical_analysis'],
      'creative_writer': ['creative_thinking', 'narrative_structure', 'communication'],
      'data_analyst': ['data_interpretation', 'statistical_analysis', 'insights'],
      'domain_specialist': ['specialized_knowledge', 'domain_expertise', 'deep_analysis']
    };
    
    return expertise[persona] || ['general'];
  }

  extractMainPoints(content) {
    // Simple main point extraction
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    return sentences.slice(0, 3); // Top 3 main points
  }

  extractUniqueInsights(response, allResponses) {
    // Find insights unique to this response
    const others = allResponses.filter(r => r.persona !== response.persona);
    const otherContent = others.map(r => r.content.toLowerCase()).join(' ');
    
    const sentences = response.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.filter(sentence => {
      const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const uniqueWords = words.filter(word => !otherContent.includes(word));
      return uniqueWords.length > words.length * 0.3; // 30% unique words threshold
    }).slice(0, 2);
  }

  resolveConflicts(responses) {
    // Detect and resolve conflicts between persona responses
    const conflicts = [];
    
    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        const conflict = this.detectConflict(responses[i], responses[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }
    
    const resolution = conflicts.length > 0 
      ? this.generateConflictResolution(conflicts)
      : 'All expert perspectives align well.';
    
    return { conflicts, resolution };
  }

  detectConflict(response1, response2) {
    // Simple conflict detection based on opposing keywords
    const opposingPairs = [
      ['should', 'should not'],
      ['recommended', 'not recommended'],
      ['yes', 'no'],
      ['effective', 'ineffective'],
      ['good', 'bad']
    ];
    
    const content1 = response1.content.toLowerCase();
    const content2 = response2.content.toLowerCase();
    
    for (const [positive, negative] of opposingPairs) {
      if (content1.includes(positive) && content2.includes(negative) ||
          content1.includes(negative) && content2.includes(positive)) {
        return {
          persona1: response1.persona,
          persona2: response2.persona,
          type: 'opposing_recommendations',
          details: `${response1.persona} suggests ${positive} while ${response2.persona} suggests ${negative}`
        };
      }
    }
    
    return null;
  }

  generateConflictResolution(conflicts) {
    return `Different experts have varying perspectives on some aspects. This reflects the complexity of the topic and suggests considering multiple approaches based on specific circumstances.`;
  }

  generateConclusion(responses, query) {
    const highConfidenceResponses = responses.filter(r => r.confidence > 0.7);
    const consensusPoints = this.findConsensusPoints(responses);
    
    let conclusion = `The expert consensus suggests: ${consensusPoints.join(', ')}. `;
    
    if (highConfidenceResponses.length > 0) {
      conclusion += `The most confident recommendations come from ${highConfidenceResponses.map(r => r.persona).join(' and ')}.`;
    }
    
    return conclusion;
  }

  findConsensusPoints(responses) {
    // Find common themes across responses
    const allWords = responses
      .map(r => r.content.toLowerCase().split(/\s+/))
      .flat()
      .filter(word => word.length > 4);
    
    const wordCounts = {};
    allWords.forEach(word => {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    });
    
    const consensus = Object.entries(wordCounts)
      .filter(([word, count]) => count >= Math.ceil(responses.length / 2))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);
    
    return consensus.length > 0 ? consensus : ['comprehensive analysis'];
  }

  extractConfidence(text) {
    // Extract confidence score (reuse from AdvancedReasoningAgent)
    const confMatch = text.match(/confidence[:\s]*([0-9.]+)/i);
    if (confMatch) {
      return parseFloat(confMatch[1]);
    }
    
    const uncertainWords = ['maybe', 'possibly', 'might', 'could', 'unsure'];
    const certainWords = ['definitely', 'certainly', 'clearly', 'obviously'];
    
    const lowerText = text.toLowerCase();
    const uncertainCount = uncertainWords.filter(word => lowerText.includes(word)).length;
    const certainCount = certainWords.filter(word => lowerText.includes(word)).length;
    
    return Math.max(0.3, Math.min(0.95, 0.7 + (certainCount - uncertainCount) * 0.1));
  }

  assessSynthesisQuality(responses, synthesis) {
    return {
      completeness: responses.length / this.config.max_personas || 3,
      coherence: synthesis.length > 200 ? 0.8 : 0.5,
      integration_score: Math.min(1.0, responses.length * 0.25),
      conflict_resolution: synthesis.includes('perspective') ? 0.8 : 0.6
    };
  }
}

module.exports = PersonaCoordinationAgent;
```

#### 2. Register Cross-Persona Workflow

```javascript
// Add to ZeroVectorGraph.js
graph.addNode("cross_persona", this.crossPersonaNode.bind(this));

// Add routing logic
routeAfterRetrieval(state) {
  // Check if query requires multiple perspectives
  if (this.requiresMultiplePersonas(state)) {
    return "cross_persona";
  }
  // ... existing routing logic
}

requiresMultiplePersonas(state) {
  const query = state.messages[state.messages.length - 1].content;
  const indicators = [
    'compare', 'contrast', 'different perspectives', 'multiple views',
    'various approaches', 'expert opinions', 'comprehensive analysis'
  ];
  
  return indicators.some(indicator => 
    query.toLowerCase().includes(indicator)
  );
}

async crossPersonaNode(state) {
  const timer = createTimer('cross_persona_node');
  
  try {
    const coordinationAgent = new PersonaCoordinationAgent(
      this.personaMemoryAgent,
      this.config.crossPersona || {}
    );
    
    const result = await coordinationAgent.__call__(state);
    
    const perfData = timer.end({ personasInvolved: true });
    logWorkflow(state.workflow_context?.workflow_id, 'cross_persona_completed', {
      duration: perfData.duration
    });

    return result;

  } catch (error) {
    timer.end({ error: true });
    return ZeroVectorStateManager.addError(state, {
      code: 'CROSS_PERSONA_ERROR',
      message: error.message,
      step: 'cross_persona',
      recoverable: true
    });
  }
}
```

## Creating Custom Workflows

### Step-by-Step Guide

#### 1. Define Workflow Requirements

Before creating a custom workflow, define:

- **Purpose**: What specific problem does this workflow solve?
- **Input Requirements**: What data/context is needed?
- **Processing Steps**: What are the logical workflow stages?
- **Output Format**: How should results be structured?
- **Error Handling**: What failure modes need handling?

#### 2. Create Custom Agent

```javascript
// File: src/agents/CustomWorkflowAgent.js
class CustomWorkflowAgent {
  constructor(dependencies, config) {
    this.dependencies = dependencies;
    this.config = config;
    // Initialize any required services
  }

  async __call__(state) {
    try {
      // Step 1: Validate input state
      const validation = this.validateInput(state);
      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors.join(', ')}`);
      }

      // Step 2: Process according to workflow logic
      const processedState = await this.processWorkflow(state);

      // Step 3: Generate output
      const output = await this.generateOutput(processedState);

      // Step 4: Update state
      return this.updateState(state, output);

    } catch (error) {
      return this.handleError(state, error);
    }
  }

  validateInput(state) {
    // Implement validation logic
    const errors = [];
    
    if (!state.messages || state.messages.length === 0) {
      errors.push('Messages are required');
    }
    
    if (!state.user_profile || !state.user_profile.id) {
      errors.push('User profile with ID is required');
    }
    
    // Add custom validation rules
    if (this.config.required_fields) {
      for (const field of this.config.required_fields) {
        if (!state[field]) {
          errors.push(`Required field missing: ${field}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  async processWorkflow(state) {
    // Implement custom workflow logic
    const steps = this.config.workflow_steps || [];
    let currentState = { ...state };
    
    for (const step of steps) {
      currentState = await this.executeStep(step, currentState);
    }
    
    return currentState;
  }

  async executeStep(step, state) {
    // Execute individual workflow step
    switch (step.type) {
      case 'data_transform':
        return await this.transformData(step.config, state);
      case 'external_api':
        return await this.callExternalAPI(step.config, state);
      case 'validation':
        return await this.validateStep(step.config, state);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  async generateOutput(state) {
    // Format output according to workflow requirements
    return {
      content: this.formatResponse(state),
      metadata: this.extractMetadata(state),
      quality_score: this.assessQuality(state)
    };
  }

  updateState(state, output) {
    return {
      ...state,
      messages: [...state.messages, {
        type: 'ai',
        content: output.content,
        additional_kwargs: {
          workflow_type: 'custom',
          metadata: output.metadata,
          quality_score: output.quality_score
        }
      }],
      workflow_context: {
        ...state.workflow_context,
        custom_output: output,
        completed_at: new Date().toISOString()
      }
    };
  }

  handleError(state, error) {
    return {
      ...state,
      errors: [...(state.errors || []), {
        code: 'CUSTOM_WORKFLOW_ERROR',
        message: error.message,
        step: 'custom_workflow',
        recoverable: true,
        timestamp: new Date().toISOString()
      }]
    };
  }

  // Helper methods
  async transformData(config, state) {
    // Implement data transformation logic
    return state;
  }

  async callExternalAPI(config, state) {
    // Implement external API calls
    return state;
  }

  async validateStep(config, state) {
    // Implement step validation
    return state;
  }

  formatResponse(state) {
    // Format the final response
    return "Custom workflow completed successfully.";
  }

  extractMetadata(state) {
    // Extract relevant metadata
    return {
      execution_time: Date.now() - (state.execution_metadata?.start_time || Date.now()),
      steps_completed: state.workflow_context?.completed_steps?.length || 0
    };
  }

  assessQuality(state) {
    // Assess output quality
    return 0.8; // Default quality score
  }
}

module.exports = CustomWorkflowAgent;
```

#### 3. Register Custom Workflow

```javascript
// In ZeroVectorGraph.js
const CustomWorkflowAgent = require('../agents/CustomWorkflowAgent');

// Add to constructor
this.customWorkflowAgent = new CustomWorkflowAgent(
  { /* dependencies */ },
  this.config.customWorkflow || {}
);

// Add node to graph
graph.addNode("custom_workflow", this.customWorkflowNode.bind(this));

// Add routing logic
routeAfterRetrieval(state) {
  if (state.workflow_context?.workflow_type === 'custom') {
    return "custom_workflow";
  }
  // ... existing routing
}

// Implement node
async customWorkflowNode(state) {
  const timer = createTimer('custom_workflow_node');
  
  try {
    const result = await this.customWorkflowAgent.__call__(state);
    
    const perfData = timer.end({ customWorkflow: true });
    logWorkflow(state.workflow_context?.workflow_id, 'custom_workflow_completed', {
      duration: perfData.duration
    });

    return result;

  } catch (error) {
    timer.end({ error: true });
    return ZeroVectorStateManager.addError(state, {
      code: 'CUSTOM_WORKFLOW_ERROR',
      message: error.message,
      step: 'custom_workflow',
      recoverable: true
    });
  }
}
```

## Permanent Workflow Integration

### Adding Workflows to the Server

#### 1. Update Configuration

```javascript
// File: zero-vector-3/server/src/config/index.js
module.exports = {
  // ... existing config
  
  workflows: {
    // Advanced reasoning configuration
    advancedReasoning: {
      max_reasoning_steps: 7,
      confidence_threshold: 0.75,
      decomposition_strategy: 'hierarchical'
    },
    
    // Cross-persona configuration
    crossPersona: {
      available_personas: [
        'helpful_assistant',
        'technical_expert',
        'creative_writer',
        'data_analyst',
        'domain_specialist',
        'research_specialist'
      ],
      max_personas: 3,
      synthesis_method: 'weighted_consensus'
    },
    
    // Custom workflow templates
    customWorkflows: {
      'data_analysis': {
        workflow_steps: [
          { type: 'data_transform', config: { format: 'structured' } },
          { type: 'validation', config: { strict: true } },
          { type: 'external_api', config: { service: 'analytics' } }
        ],
        required_fields: ['data_source', 'analysis_type']
      },
      
      'content_generation': {
        workflow_steps: [
          { type: 'research', config: { depth: 'comprehensive' } },
          { type: 'outline', config: { structure: 'hierarchical' } },
          { type: 'generation', config: { tone: 'professional' } },
          { type: 'review', config: { quality_check: true } }
        ],
        required_fields: ['topic', 'target_audience']
      }
    }
  }
};
```

#### 2. Update Service Manager

```javascript
// File: zero-vector-3/server/src/services/ServiceManager.js
const AdvancedReasoningAgent = require('../agents/AdvancedReasoningAgent');
const PersonaCoordinationAgent = require('../agents/PersonaCoordinationAgent');
const CustomWorkflowAgent = require('../agents/CustomWorkflowAgent');

class ServiceManager {
  constructor() {
    // ... existing initialization
    this.workflowAgents = new Map();
  }

  async initialize() {
    // ... existing initialization
    
    // Initialize workflow agents
    await this.initializeWorkflowAgents();
  }

  async initializeWorkflowAgents() {
    try {
      // Advanced reasoning agent
      this.workflowAgents.set('advanced_reasoning', 
        new AdvancedReasoningAgent(
          this.llm, 
          this.config.workflows.advancedReasoning
        )
      );

      // Cross-persona coordination agent
      this.workflowAgents.set('cross_persona',
        new PersonaCoordinationAgent(
          this.personaMemoryAgent,
          this.config.workflows.crossPersona
        )
      );

      // Custom workflow agents
      for (const [name, config] of Object.entries(this.config.workflows.customWorkflows)) {
        this.workflowAgents.set(`custom_${name}`,
          new CustomWorkflowAgent(
            { /* dependencies */ },
            config
          )
        );
      }

      logger.info('Workflow agents initialized', {
        count: this.workflowAgents.size,
        agents: Array.from(this.workflowAgents.keys())
      });

    } catch (error) {
      logger.error('Failed to initialize workflow agents', { error: error.message });
      throw error;
    }
  }

  getWorkflowAgent(type) {
    return this.workflowAgents.get(type);
  }

  listAvailableWorkflows() {
    return Array.from(this.workflowAgents.keys());
  }
}
```

#### 3. Update API Endpoints

```javascript
// File: zero-vector-3/server/src/routes/langgraph.js

// Add workflow discovery endpoint
router.get('/workflow-types', async (req, res) => {
  try {
    const graph = await initializeLangGraph();
    const availableWorkflows = serviceManager.listAvailableWorkflows();
    
    const workflowTypes = {
      built_in: [
        'zero_vector_conversation',
        'multi_step_reasoning', 
        'human_approval',
        'memory_maintenance'
      ],
      advanced: availableWorkflows.filter(w => w.startsWith('advanced_')),
      custom: availableWorkflows.filter(w => w.startsWith('custom_')),
      cross_persona: availableWorkflows.filter(w => w.includes('persona'))
    };

    res.json({
      success: true,
      data: {
        workflow_types: workflowTypes,
        total_count: Object.values(workflowTypes).flat().length,
        capabilities: {
          multi_step_reasoning: true,
          cross_persona_collaboration: true,
          custom_workflows: true,
          human_approval: true,
          memory_maintenance: true
        }
      }
    });

  } catch (error) {
    logger.error('Error listing workflow types', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced execute endpoint with workflow type validation
router.post('/execute', async (req, res) => {
  try {
    const { workflow_context = {} } = req.body;
    const workflowType = workflow_context.workflow_type || 'zero_vector_conversation';
    
    // Validate workflow type
    const availableWorkflows = serviceManager.listAvailableWorkflows();
    const allWorkflowTypes = [
      'zero_vector_conversation',
      'multi_step_reasoning',
      'human_approval', 
      'memory_maintenance',
      ...availableWorkflows
    ];
    
    if (!allWorkflowTypes.includes(workflowType)) {
      return res.status(400).json({
        success: false,
        error: `Unknown workflow type: ${workflowType}. Available types: ${allWorkflowTypes.join(', ')}`
      });
    }

    // ... rest of existing execute logic
    
  } catch (error) {
    // ... existing error handling
  }
});
```

## Performance Optimization

### Caching Strategies

#### 1. Workflow Result Caching

```javascript
// File: zero-vector-3/server/src/services/WorkflowCacheManager.js
class WorkflowCacheManager {
  constructor(redisClient, config) {
    this.redis = redisClient;
    this.config = config;
    this.defaultTTL = config.cache_ttl || 3600; // 1 hour
  }

  // Cache workflow results
  async cacheWorkflowResult(workflowId, result) {
    const cacheKey = `workflow:result:${workflowId}`;
    await this.redis.setex(
      cacheKey, 
      this.defaultTTL, 
      JSON.stringify(result)
    );
  }

  // Cache intermediate workflow states
  async cacheWorkflowState(workflowId, step, state) {
    const cacheKey = `workflow:state:${workflowId}:${step}`;
    await this.redis.setex(
      cacheKey,
      this.config.state_cache_ttl || 1800, // 30 minutes
      JSON.stringify(state)
    );
  }

  // Cache persona responses for cross-persona workflows
  async cachePersonaResponse(persona, queryHash, response) {
    const cacheKey = `persona:response:${persona}:${queryHash}`;
    await this.redis.setex(
      cacheKey,
      this.config.persona_cache_ttl || 7200, // 2 hours
      JSON.stringify(response)
    );
  }

  // Get cached results
  async getCachedWorkflowResult(workflowId) {
    const cacheKey = `workflow:result:${workflowId}`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  async getCachedWorkflowState(workflowId, step) {
    const cacheKey = `workflow:state:${workflowId}:${step}`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  async getCachedPersonaResponse(persona, queryHash) {
    const cacheKey = `persona:response:${persona}:${queryHash}`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  // Cache invalidation
  async invalidateWorkflowCache(workflowId) {
    const pattern = `workflow:*:${workflowId}*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // Performance metrics
  async getWorkflowCacheStats() {
    const info = await this.redis.info('memory');
    const keyCount = await this.redis.dbsize();
    
    return {
      memory_usage: this.parseMemoryInfo(info),
      key_count: keyCount,
      cache_hit_rate: await this.calculateHitRate()
    };
  }

  parseMemoryInfo(info) {
    const lines = info.split('\r\n');
    const memoryLine = lines.find(line => line.startsWith('used_memory_human'));
    return memoryLine ? memoryLine.split(':')[1] : 'unknown';
  }

  async calculateHitRate() {
    // Simplified hit rate calculation
    // In production, implement proper hit/miss tracking
    return 0.75; // Mock 75% hit rate
  }
}

module.exports = WorkflowCacheManager;
```

#### 2. Optimize Graph Execution

```javascript
// In ZeroVectorGraph.js - Add performance optimization
class ZeroVectorGraph {
  constructor(components) {
    // ... existing constructor
    this.workflowCache = new WorkflowCacheManager(
      components.redisClient,
      components.config?.cache || {}
    );
  }

  async retrieveNode(state) {
    const timer = createTimer('retrieve_node_optimized');
    
    try {
      // Check for cached results first
      const queryHash = this.generateQueryHash(state.messages[state.messages.length - 1].content);
      const cachedResults = await this.workflowCache.getCachedWorkflowState(
        state.workflow_context?.workflow_id,
        'retrieve'
      );

      if (cachedResults && this.isCacheValid(cachedResults)) {
        logWorkflow(state.workflow_context?.workflow_id, 'retrieve_cache_hit');
        return {
          ...state,
          ...cachedResults,
          memory_context: {
            ...cachedResults.memory_context,
            cached: true,
            cache_timestamp: new Date().toISOString()
          }
        };
      }

      // Execute retrieval if not cached
      const result = await this.hybridRetrievalAgent.__call__(state);
      
      // Cache the results
      await this.workflowCache.cacheWorkflowState(
        state.workflow_context?.workflow_id,
        'retrieve',
        {
          vector_results: result.vector_results,
          graph_relationships: result.graph_relationships,
          memory_context: result.memory_context
        }
      );

      const perfData = timer.end({ cached: false });
      return result;

    } catch (error) {
      timer.end({ error: true });
      throw error;
    }
  }

  generateQueryHash(query) {
    // Simple hash function - in production use crypto.createHash
    return query.toLowerCase().replace(/\s+/g, '_').substring(0, 50);
  }

  isCacheValid(cachedData) {
    if (!cachedData.memory_context?.cache_timestamp) return false;
    
    const cacheAge = Date.now() - new Date(cachedData.memory_context.cache_timestamp).getTime();
    const maxAge = this.config.cache?.max_age || 3600000; // 1 hour
    
    return cacheAge < maxAge;
  }
}
```

### Parallel Processing

```javascript
// File: zero-vector-3/server/src/utils/ParallelProcessor.js
class ParallelProcessor {
  constructor(maxConcurrency = 3) {
    this.maxConcurrency = maxConcurrency;
  }

  // Process multiple persona responses in parallel
  async processPersonasInParallel(personas, queryFn, state) {
    const chunks = this.chunkArray(personas, this.maxConcurrency);
    const results = [];

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(persona => 
        this.processWithTimeout(queryFn(persona, state), 30000) // 30s timeout
      );
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      results.push(...chunkResults);
    }

    return results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
  }

  // Process reasoning steps in parallel where possible
  async processReasoningStepsInParallel(steps, processFn, state) {
    const independentSteps = this.identifyIndependentSteps(steps);
    const dependentSteps = steps.filter(step => !independentSteps.includes(step));

    // Process independent steps in parallel
    const independentPromises = independentSteps.map(step =>
      this.processWithTimeout(processFn(step, state), 15000) // 15s timeout
    );

    const independentResults = await Promise.allSettled(independentPromises);

    // Process dependent steps sequentially
    const dependentResults = [];
    for (const step of dependentSteps) {
      try {
        const result = await processFn(step, state);
        dependentResults.push({ status: 'fulfilled', value: result });
      } catch (error) {
        dependentResults.push({ status: 'rejected', reason: error });
      }
    }

    return [
      ...independentResults.filter(r => r.status === 'fulfilled').map(r => r.value),
      ...dependentResults.filter(r => r.status === 'fulfilled').map(r => r.value)
    ];
  }

  async processWithTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Process timeout')), timeoutMs)
      )
    ]);
  }

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  identifyIndependentSteps(steps) {
    // Simple independence detection - in production implement dependency analysis
    return steps.filter((step, index) => 
      !step.depends_on || step.depends_on.length === 0
    );
  }
}

module.exports = ParallelProcessor;
```

## Testing and Debugging

### Unit Tests for Workflows

```javascript
// File: zero-vector-3/server/tests/workflows.test.js
const { describe, it, expect, beforeEach } = require('@jest/globals');
const ZeroVectorGraph = require('../src/graphs/ZeroVectorGraph');
const AdvancedReasoningAgent = require('../src/agents/AdvancedReasoningAgent');
const PersonaCoordinationAgent = require('../src/agents/PersonaCoordinationAgent');

describe('Advanced Workflows', () => {
  let mockServiceManager;
  let zeroVectorGraph;

  beforeEach(() => {
    mockServiceManager = {
      hybridRetrievalAgent: {
        __call__: jest.fn().mockResolvedValue({
          vector_results: [{ content: 'test result', metadata: {} }],
          graph_relationships: [],
          memory_context: { query_complexity: 'moderate' }
        })
      },
      personaMemoryAgent: {
        __call__: jest.fn().mockResolvedValue({
          messages: [{ type: 'ai', content: 'Test response' }],
          persona_context: { memories_retrieved: 5 }
        })
      },
      llm: {
        invoke: jest.fn().mockResolvedValue({
          content: 'Test LLM response'
        })
      },
      checkpointer: null,
      config: {
        advancedReasoning: {
          max_reasoning_steps: 3,
          confidence_threshold: 0.7
        },
        crossPersona: {
          available_personas: ['helpful_assistant', 'technical_expert'],
          max_personas: 2
        }
      }
    };

    zeroVectorGraph = new ZeroVectorGraph(mockServiceManager);
  });

  describe('Multi-Step Reasoning', () => {
    it('should decompose complex queries', async () => {
      const reasoningAgent = new AdvancedReasoningAgent(
        mockServiceManager.llm,
        mockServiceManager.config.advancedReasoning
      );

      const mockState = {
        messages: [{ content: 'How does machine learning affect software development and what are the implications for future programming paradigms?' }],
        vector_results: [],
        reasoning_path: []
      };

      // Mock LLM response for decomposition
      mockServiceManager.llm.invoke.mockResolvedValueOnce({
        content: '["What is machine learning?", "How does ML affect software development?", "What are future programming paradigm implications?"]'
      });

      const result = await reasoningAgent.__call__(mockState);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].type).toBe('ai');
      expect(result.messages[1].additional_kwargs.reasoning_steps).toBeGreaterThan(0);
    });

    it('should handle confidence thresholds', async () => {
      const reasoningAgent = new AdvancedReasoningAgent(
        mockServiceManager.llm,
        { ...mockServiceManager.config.advancedReasoning, confidence_threshold: 0.9 }
      );

      const complexity = await reasoningAgent.analyzeComplexity(
        'How does quantum computing work?'
      );

      expect(complexity).toHaveProperty('score');
      expect(complexity).toHaveProperty('level');
      expect(complexity).toHaveProperty('estimated_steps');
    });
  });

  describe('Cross-Persona Workflows', () => {
    it('should coordinate multiple personas', async () => {
      const coordinationAgent = new PersonaCoordinationAgent(
        mockServiceManager.personaMemoryAgent,
        mockServiceManager.config.crossPersona
      );

      const mockState = {
        messages: [{ content: 'Compare different programming approaches and creative writing techniques' }],
        user_profile: { id: 'test_user' },
        persona_context: {}
      };

      const result = await coordinationAgent.__call__(mockState);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].additional_kwargs.collaboration_type).toBe('multi_persona');
      expect(result.persona_context.collaboration_history).toBeDefined();
    });

    it('should select appropriate personas', async () => {
      const coordinationAgent = new PersonaCoordinationAgent(
        mockServiceManager.personaMemoryAgent,
        mockServiceManager.config.crossPersona
      );

      const expertiseNeeds = await coordinationAgent.analyzeExpertiseNeeds(
        'I need help with programming and creative writing'
      );

      const selectedPersonas = await coordinationAgent.selectPersonas(expertiseNeeds);

      expect(selectedPersonas).toContain('technical_expert');
      expect(selectedPersonas.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Workflow Integration', () => {
    it('should execute complete workflow graph', async () => {
      const graph = zeroVectorGraph.createGraph();

      const testState = {
        messages: [{ content: 'Test workflow execution' }],
        active_persona: 'helpful_assistant',
        user_profile: { id: 'test_user' },
        workflow_context: { workflow_type: 'zero_vector_conversation' }
      };

      const result = await graph.invoke(testState);

      expect(result.messages).toHaveLength(2);
      expect(result.workflow_context).toBeDefined();
    });

    it('should handle workflow errors gracefully', async () => {
      // Mock an error in the retrieval agent
      mockServiceManager.hybridRetrievalAgent.__call__.mockRejectedValueOnce(
        new Error('Retrieval failed')
      );

      const graph = zeroVectorGraph.createGraph();

      const testState = {
        messages: [{ content: 'Test error handling' }],
        active_persona: 'helpful_assistant',
        user_profile: { id: 'test_user' }
      };

      const result = await graph.invoke(testState);

      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
```

### Debugging Tools

```javascript
// File: zero-vector-3/server/src/utils/WorkflowDebugger.js
class WorkflowDebugger {
  constructor(logger) {
    this.logger = logger;
    this.debugMode = process.env.WORKFLOW_DEBUG === 'true';
  }

  // Trace workflow execution
  traceWorkflow(workflowId, step, data) {
    if (!this.debugMode) return;

    this.logger.debug('workflow_trace', {
      workflow_id: workflowId,
      step,
      timestamp: new Date().toISOString(),
      data: this.sanitizeData(data)
    });
  }

  // Log state transitions
  logStateTransition(workflowId, fromStep, toStep, state) {
    if (!this.debugMode) return;

    this.logger.debug('state_transition', {
      workflow_id: workflowId,
      transition: `${fromStep} → ${toStep}`,
      state_size: JSON.stringify(state).length,
      message_count: state.messages?.length || 0,
      errors: state.errors?.length || 0
    });
  }

  // Performance analysis
  analyzePerformance(workflowId, metrics) {
    if (!this.debugMode) return;

    const analysis = {
      total_time: metrics.execution_time_ms,
      step_count: metrics.step_count,
      avg_step_time: metrics.execution_time_ms / (metrics.step_count || 1),
      cache_efficiency: metrics.cache_hits / (metrics.cache_hits + metrics.cache_misses || 1),
      memory_usage: this.estimateMemoryUsage(metrics)
    };

    this.logger.debug('performance_analysis', {
      workflow_id: workflowId,
      analysis
    });

    return analysis;
  }

  // Export workflow execution trace
  exportTrace(workflowId) {
    // Implementation for exporting detailed workflow traces
    // Useful for debugging complex workflows
    return {
      workflow_id: workflowId,
      export_timestamp: new Date().toISOString(),
      trace_data: 'Detailed trace data would be here'
    };
  }

  sanitizeData(data) {
    // Remove sensitive information from debug logs
    const sanitized = { ...data };
    
    if (sanitized.user_profile) {
      sanitized.user_profile = { id: sanitized.user_profile.id };
    }
    
    if (sanitized.messages) {
      sanitized.messages = sanitized.messages.map(msg => ({
        type: msg.type,
        content_length: msg.content?.length || 0
      }));
    }

    return sanitized;
  }

  estimateMemoryUsage(metrics) {
    // Simple memory usage estimation
    return {
      estimated_mb: (metrics.state_size || 0) / (1024 * 1024),
      message_overhead: (metrics.message_count || 0) * 0.1,
      vector_cache_size: (metrics.vector_results?.length || 0) * 0.01
    };
  }
}

module.exports = WorkflowDebugger;
```

## Advanced Patterns

### Workflow Composition

```javascript
// File: zero-vector-3/server/src/patterns/WorkflowComposer.js
class WorkflowComposer {
  constructor(availableWorkflows) {
    this.workflows = availableWorkflows;
  }

  // Compose multiple workflows into a single execution
  async composeWorkflows(workflowSpecs, state) {
    const results = [];
    let currentState = { ...state };

    for (const spec of workflowSpecs) {
      const result = await this.executeWorkflowStep(spec, currentState);
      results.push(result);
      
      // Update state with results from previous workflow
      currentState = this.mergeStates(currentState, result);
    }

    return this.synthesizeComposedResults(results, state);
  }

  async executeWorkflowStep(spec, state) {
    const workflow = this.workflows.get(spec.type);
    if (!workflow) {
      throw new Error(`Workflow type not found: ${spec.type}`);
    }

    // Create isolated state for this workflow step
    const workflowState = {
      ...state,
      workflow_context: {
        ...state.workflow_context,
        composed_step: spec,
        parent_workflow: state.workflow_context?.workflow_id
      }
    };

    return await workflow.__call__(workflowState);
  }

  mergeStates(baseState, newState) {
    return {
      ...baseState,
      messages: [...baseState.messages, ...newState.messages.slice(1)], // Skip duplicate human message
      vector_results: [...(baseState.vector_results || []), ...(newState.vector_results || [])],
      reasoning_path: [...(baseState.reasoning_path || []), ...(newState.reasoning_path || [])],
      persona_context: {
