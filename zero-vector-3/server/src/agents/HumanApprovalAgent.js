const { logger, logError, logAgent, createTimer } = require('../utils/logger');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');

/**
 * Human Approval Agent
 * Handles human-in-the-loop approval workflows for sensitive operations
 * Implements patterns from LangGraph-DEV-HANDOFF.md Phase 3
 */

// Approval schemas
const ApprovalRequestSchema = z.object({
  id: z.string().default(() => uuidv4()),
  user_id: z.string(),
  content: z.string(),
  proposed_response: z.string().optional(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  risk_score: z.number().min(0).max(1),
  sensitive_topics: z.array(z.string()).default([]),
  context: z.object({
    conversation_id: z.string().optional(),
    persona_id: z.string().optional(),
    timestamp: z.string().default(() => new Date().toISOString()),
    metadata: z.record(z.any()).default({})
  }),
  approval_timeout_ms: z.number().default(300000), // 5 minutes
  requires_human_approval: z.boolean().default(true),
  auto_approval_eligible: z.boolean().default(false)
});

const ApprovalResponseSchema = z.object({
  approval_id: z.string(),
  approved: z.boolean(),
  reviewer_id: z.string().optional(),
  review_timestamp: z.string().default(() => new Date().toISOString()),
  feedback: z.string().optional(),
  modified_response: z.string().optional(),
  approval_level: z.enum(['auto', 'human', 'escalated']).default('human'),
  escalation_reason: z.string().optional()
});

const RiskAssessmentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sensitive_topics: z.array(z.string()).default([
    'personal information', 'financial data', 'medical information',
    'legal advice', 'political content', 'controversial topics'
  ]),
  risk_thresholds: z.object({
    low: z.number().default(0.3),
    medium: z.number().default(0.6),
    high: z.number().default(0.8),
    critical: z.number().default(0.9)
  }),
  auto_approval_threshold: z.number().default(0.2),
  escalation_threshold: z.number().default(0.9),
  default_timeout_ms: z.number().default(300000)
});

class HumanApprovalAgent {
  constructor(approvalService, config = {}) {
    this.approvalService = approvalService;
    this.config = RiskAssessmentConfigSchema.parse(config);
    this.pendingApprovals = new Map();
    this.approvalStats = {
      total_requests: 0,
      auto_approved: 0,
      human_approved: 0,
      rejected: 0,
      timed_out: 0,
      escalated: 0
    };

    logger.info('HumanApprovalAgent initialized', {
      config: this.config,
      sensitiveTopicsCount: this.config.sensitive_topics.length
    });
  }

  /**
   * Main agent call method - process state for approval requirements
   */
  async __call__(state) {
    const timer = createTimer('human_approval_agent', {
      userId: state.user_profile?.id,
      conversationId: state.conversation_id
    });

    try {
      logAgent('HumanApprovalAgent', 'processing_approval_request', {
        userId: state.user_profile?.id,
        requiresApproval: state.requires_approval
      });

      // Check if approval is actually required
      if (!state.requires_approval && !this.config.enabled) {
        logger.debug('Approval not required, bypassing', {
          userId: state.user_profile?.id
        });
        return this.bypassApproval(state);
      }

      // Assess risk level
      const riskAssessment = await this.assessRisk(state);
      
      // Create approval request
      const approvalRequest = await this.createApprovalRequest(state, riskAssessment);

      // Check for auto-approval eligibility
      if (this.isAutoApprovalEligible(approvalRequest)) {
        return await this.processAutoApproval(state, approvalRequest);
      }

      // Submit for human approval
      return await this.submitForHumanApproval(state, approvalRequest);

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'HumanApprovalAgent.__call__',
        userId: state.user_profile?.id
      });

      return this.handleApprovalError(state, error);
    }
  }

  /**
   * Assess risk level of content
   */
  async assessRisk(state) {
    const timer = createTimer('risk_assessment', {
      userId: state.user_profile?.id
    });

    try {
      const content = state.messages?.[state.messages.length - 1]?.content || '';
      const proposedResponse = state.draft_response || '';
      
      // Analyze content for sensitive topics
      const sensitiveTopics = this.detectSensitiveTopics(content + ' ' + proposedResponse);
      
      // Calculate base risk score
      let riskScore = this.calculateBaseRiskScore(content, proposedResponse);
      
      // Adjust for sensitive topics
      riskScore += sensitiveTopics.length * 0.2;
      
      // Adjust for user context
      riskScore = this.adjustForUserContext(riskScore, state);
      
      // Normalize to 0-1 range
      riskScore = Math.min(1.0, Math.max(0.0, riskScore));
      
      // Determine risk level
      const riskLevel = this.determineRiskLevel(riskScore);

      const assessment = {
        risk_score: riskScore,
        risk_level: riskLevel,
        sensitive_topics: sensitiveTopics,
        factors: {
          content_length: content.length,
          response_length: proposedResponse.length,
          sensitive_topic_count: sensitiveTopics.length,
          user_risk_factor: this.getUserRiskFactor(state)
        },
        timestamp: new Date().toISOString()
      };

      timer.end({
        riskScore,
        riskLevel,
        sensitiveTopicsCount: sensitiveTopics.length
      });

      logAgent('HumanApprovalAgent', 'risk_assessment_completed', {
        userId: state.user_profile?.id,
        riskScore,
        riskLevel,
        sensitiveTopics
      });

      return assessment;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'assessRisk',
        userId: state.user_profile?.id
      });
      
      // Return conservative assessment on error
      return {
        risk_score: 0.8,
        risk_level: 'high',
        sensitive_topics: ['assessment_error'],
        factors: { error: true },
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Create approval request from state and risk assessment
   */
  async createApprovalRequest(state, riskAssessment) {
    const content = state.messages?.[state.messages.length - 1]?.content || '';
    
    const approvalRequest = ApprovalRequestSchema.parse({
      user_id: state.user_profile?.id,
      content,
      proposed_response: state.draft_response,
      risk_level: riskAssessment.risk_level,
      risk_score: riskAssessment.risk_score,
      sensitive_topics: riskAssessment.sensitive_topics,
      context: {
        conversation_id: state.conversation_id,
        persona_id: state.active_persona,
        timestamp: new Date().toISOString(),
        metadata: {
          risk_assessment: riskAssessment,
          vector_results_count: state.vector_results?.length || 0,
          workflow_step: 'human_approval'
        }
      },
      approval_timeout_ms: this.config.default_timeout_ms,
      auto_approval_eligible: riskAssessment.risk_score <= this.config.auto_approval_threshold
    });

    logger.debug('Approval request created', {
      approvalId: approvalRequest.id,
      riskLevel: approvalRequest.risk_level,
      riskScore: approvalRequest.risk_score
    });

    return approvalRequest;
  }

  /**
   * Process auto-approval for low-risk content
   */
  async processAutoApproval(state, approvalRequest) {
    const timer = createTimer('auto_approval', {
      approvalId: approvalRequest.id
    });

    try {
      const approvalResponse = ApprovalResponseSchema.parse({
        approval_id: approvalRequest.id,
        approved: true,
        approval_level: 'auto',
        review_timestamp: new Date().toISOString()
      });

      this.approvalStats.total_requests++;
      this.approvalStats.auto_approved++;

      timer.end({ approved: true });

      logAgent('HumanApprovalAgent', 'auto_approval_granted', {
        approvalId: approvalRequest.id,
        riskScore: approvalRequest.risk_score,
        userId: state.user_profile?.id
      });

      return this.updateStateWithApproval(state, approvalRequest, approvalResponse);

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'processAutoApproval',
        approvalId: approvalRequest.id
      });
      throw error;
    }
  }

  /**
   * Submit for human approval
   */
  async submitForHumanApproval(state, approvalRequest) {
    const timer = createTimer('human_approval_submission', {
      approvalId: approvalRequest.id
    });

    try {
      // Check if this requires escalation
      if (approvalRequest.risk_score >= this.config.escalation_threshold) {
        return await this.escalateApproval(state, approvalRequest);
      }

      // Submit to approval service
      const submissionResult = await this.approvalService.submitRequest(approvalRequest);
      
      // Store pending approval
      this.pendingApprovals.set(approvalRequest.id, {
        request: approvalRequest,
        state: state,
        submitted_at: new Date().toISOString(),
        timeout: setTimeout(() => {
          this.handleApprovalTimeout(approvalRequest.id);
        }, approvalRequest.approval_timeout_ms)
      });

      this.approvalStats.total_requests++;

      timer.end({ submitted: true });

      logAgent('HumanApprovalAgent', 'approval_submitted', {
        approvalId: approvalRequest.id,
        riskLevel: approvalRequest.risk_level,
        timeoutMs: approvalRequest.approval_timeout_ms,
        userId: state.user_profile?.id
      });

      return this.updateStateWithPendingApproval(state, approvalRequest, submissionResult);

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'submitForHumanApproval',
        approvalId: approvalRequest.id
      });
      throw error;
    }
  }

  /**
   * Escalate high-risk approval requests
   */
  async escalateApproval(state, approvalRequest) {
    const timer = createTimer('approval_escalation', {
      approvalId: approvalRequest.id
    });

    try {
      const escalatedRequest = {
        ...approvalRequest,
        escalated: true,
        escalation_reason: 'high_risk_content',
        escalation_timestamp: new Date().toISOString(),
        approval_timeout_ms: approvalRequest.approval_timeout_ms * 2 // Extended timeout
      };

      const escalationResult = await this.approvalService.escalateRequest(escalatedRequest);
      
      this.approvalStats.total_requests++;
      this.approvalStats.escalated++;

      timer.end({ escalated: true });

      logAgent('HumanApprovalAgent', 'approval_escalated', {
        approvalId: approvalRequest.id,
        riskScore: approvalRequest.risk_score,
        reason: 'high_risk_content',
        userId: state.user_profile?.id
      });

      return this.updateStateWithEscalation(state, escalatedRequest, escalationResult);

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'escalateApproval',
        approvalId: approvalRequest.id
      });
      throw error;
    }
  }

  /**
   * Process approval response
   */
  async processApprovalResponse(approvalId, response) {
    const timer = createTimer('approval_response_processing', { approvalId });

    try {
      const pendingApproval = this.pendingApprovals.get(approvalId);
      
      if (!pendingApproval) {
        throw new Error(`No pending approval found for ID: ${approvalId}`);
      }

      // Clear timeout
      clearTimeout(pendingApproval.timeout);
      this.pendingApprovals.delete(approvalId);

      // Validate response
      const approvalResponse = ApprovalResponseSchema.parse({
        ...response,
        approval_id: approvalId
      });

      // Update stats
      if (approvalResponse.approved) {
        this.approvalStats.human_approved++;
      } else {
        this.approvalStats.rejected++;
      }

      timer.end({ 
        approved: approvalResponse.approved,
        approvalLevel: approvalResponse.approval_level 
      });

      logAgent('HumanApprovalAgent', 'approval_response_processed', {
        approvalId,
        approved: approvalResponse.approved,
        approvalLevel: approvalResponse.approval_level,
        reviewerId: approvalResponse.reviewer_id
      });

      return {
        state: pendingApproval.state,
        request: pendingApproval.request,
        response: approvalResponse
      };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'processApprovalResponse',
        approvalId
      });
      throw error;
    }
  }

  /**
   * Handle approval timeout
   */
  handleApprovalTimeout(approvalId) {
    try {
      const pendingApproval = this.pendingApprovals.get(approvalId);
      
      if (pendingApproval) {
        this.pendingApprovals.delete(approvalId);
        this.approvalStats.timed_out++;

        logAgent('HumanApprovalAgent', 'approval_timeout', {
          approvalId,
          submittedAt: pendingApproval.submitted_at,
          userId: pendingApproval.state.user_profile?.id
        });

        // Notify approval service of timeout
        this.approvalService.handleTimeout(approvalId);
      }

    } catch (error) {
      logError(error, {
        operation: 'handleApprovalTimeout',
        approvalId
      });
    }
  }

  /**
   * Get approval agent statistics
   */
  getStats() {
    return {
      ...this.approvalStats,
      pending_approvals: this.pendingApprovals.size,
      config: this.config,
      uptime: process.uptime()
    };
  }

  // Helper methods

  bypassApproval(state) {
    return {
      ...state,
      approval_context: {
        approval_status: 'bypassed',
        bypass_reason: 'not_required',
        timestamp: new Date().toISOString()
      }
    };
  }

  detectSensitiveTopics(content) {
    const sensitiveTopics = [];
    const contentLower = content.toLowerCase();
    
    for (const topic of this.config.sensitive_topics) {
      if (contentLower.includes(topic.toLowerCase())) {
        sensitiveTopics.push(topic);
      }
    }
    
    return sensitiveTopics;
  }

  calculateBaseRiskScore(content, proposedResponse) {
    let score = 0;
    
    // Content length factor
    if (content.length > 1000) score += 0.1;
    if (proposedResponse.length > 2000) score += 0.1;
    
    // Keyword analysis
    const riskKeywords = ['delete', 'remove', 'confidential', 'private', 'secret'];
    const contentLower = (content + ' ' + proposedResponse).toLowerCase();
    
    for (const keyword of riskKeywords) {
      if (contentLower.includes(keyword)) {
        score += 0.15;
      }
    }
    
    return score;
  }

  adjustForUserContext(riskScore, state) {
    // Adjust based on user profile, history, etc.
    const userRiskFactor = this.getUserRiskFactor(state);
    return riskScore * (1 + userRiskFactor);
  }

  getUserRiskFactor(state) {
    // Simple user risk assessment - in production this would be more sophisticated
    return 0.1; // Default low risk factor
  }

  determineRiskLevel(riskScore) {
    if (riskScore >= this.config.risk_thresholds.critical) return 'critical';
    if (riskScore >= this.config.risk_thresholds.high) return 'high';
    if (riskScore >= this.config.risk_thresholds.medium) return 'medium';
    return 'low';
  }

  isAutoApprovalEligible(approvalRequest) {
    return approvalRequest.auto_approval_eligible && 
           approvalRequest.risk_score <= this.config.auto_approval_threshold;
  }

  updateStateWithApproval(state, approvalRequest, approvalResponse) {
    return {
      ...state,
      approval_context: {
        approval_id: approvalRequest.id,
        approval_status: 'approved',
        approval_level: approvalResponse.approval_level,
        risk_assessment: {
          risk_score: approvalRequest.risk_score,
          risk_level: approvalRequest.risk_level,
          sensitive_topics: approvalRequest.sensitive_topics
        },
        approved_at: approvalResponse.review_timestamp,
        reviewer_id: approvalResponse.reviewer_id,
        feedback: approvalResponse.feedback,
        modified_response: approvalResponse.modified_response
      },
      requires_approval: false
    };
  }

  updateStateWithPendingApproval(state, approvalRequest, submissionResult) {
    return {
      ...state,
      approval_context: {
        approval_id: approvalRequest.id,
        approval_status: 'pending',
        risk_assessment: {
          risk_score: approvalRequest.risk_score,
          risk_level: approvalRequest.risk_level,
          sensitive_topics: approvalRequest.sensitive_topics
        },
        submitted_at: new Date().toISOString(),
        timeout_at: new Date(Date.now() + approvalRequest.approval_timeout_ms).toISOString(),
        submission_result: submissionResult
      },
      workflow_context: {
        ...state.workflow_context,
        interrupted_at: 'human_approval',
        resumable: true
      }
    };
  }

  updateStateWithEscalation(state, escalatedRequest, escalationResult) {
    return {
      ...state,
      approval_context: {
        approval_id: escalatedRequest.id,
        approval_status: 'escalated',
        escalation_reason: escalatedRequest.escalation_reason,
        risk_assessment: {
          risk_score: escalatedRequest.risk_score,
          risk_level: escalatedRequest.risk_level,
          sensitive_topics: escalatedRequest.sensitive_topics
        },
        escalated_at: escalatedRequest.escalation_timestamp,
        timeout_at: new Date(Date.now() + escalatedRequest.approval_timeout_ms).toISOString(),
        escalation_result: escalationResult
      },
      workflow_context: {
        ...state.workflow_context,
        interrupted_at: 'human_approval_escalated',
        resumable: true
      }
    };
  }

  handleApprovalError(state, error) {
    return {
      ...state,
      approval_context: {
        approval_status: 'error',
        error_message: error.message,
        error_timestamp: new Date().toISOString()
      },
      errors: [
        ...(state.errors || []),
        {
          code: 'APPROVAL_AGENT_ERROR',
          message: error.message,
          step: 'human_approval',
          recoverable: true,
          timestamp: new Date().toISOString()
        }
      ]
    };
  }
}

module.exports = HumanApprovalAgent;
