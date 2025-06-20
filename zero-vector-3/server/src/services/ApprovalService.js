const { logger, logError, logPerformance, createTimer } = require('../utils/logger');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Approval Service
 * Backend service for managing human-in-the-loop approval workflows
 * Integrates with PostgreSQLManager and HumanApprovalAgent
 * Implements patterns from LangGraph-DEV-HANDOFF.md Phase 3
 */

const ApprovalServiceConfigSchema = z.object({
  defaultTimeout: z.number().default(300000), // 5 minutes
  escalationTimeout: z.number().default(600000), // 10 minutes
  maxPendingRequests: z.number().default(1000),
  notificationEnabled: z.boolean().default(true),
  webhookUrl: z.string().optional(),
  emailNotifications: z.boolean().default(false),
  slackNotifications: z.boolean().default(false),
  autoEscalationEnabled: z.boolean().default(true),
  escalationThresholds: z.object({
    highRiskTimeout: z.number().default(180000), // 3 minutes for high risk
    criticalRiskTimeout: z.number().default(60000), // 1 minute for critical risk
    pendingCountThreshold: z.number().default(50)
  })
});

const ApprovalRequestSchema = z.object({
  id: z.string().default(() => uuidv4()),
  workflow_id: z.string(),
  thread_id: z.string().optional(),
  user_id: z.string(),
  content: z.string(),
  proposed_response: z.string().optional(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  risk_score: z.number().min(0).max(1),
  sensitive_topics: z.array(z.string()).default([]),
  context: z.object({}).passthrough().default({}),
  approval_timeout_ms: z.number().default(300000),
  auto_approval_eligible: z.boolean().default(false),
  escalated: z.boolean().default(false),
  escalation_reason: z.string().optional()
});

const ApprovalResponseSchema = z.object({
  approval_id: z.string(),
  approved: z.boolean(),
  reviewer_id: z.string().optional(),
  approval_reason: z.string().optional(),
  rejection_reason: z.string().optional(),
  modified_response: z.string().optional(),
  approval_level: z.enum(['auto', 'human', 'escalated']).default('human')
});

class ApprovalService {
  constructor(postgresManager, config = {}) {
    this.postgres = postgresManager;
    this.config = ApprovalServiceConfigSchema.parse(config);
    this.pendingRequests = new Map(); // In-memory tracking for active requests
    this.timeouts = new Map(); // Track active timeouts
    this.notificationQueue = [];
    this.stats = {
      totalRequests: 0,
      pendingRequests: 0,
      approvedRequests: 0,
      rejectedRequests: 0,
      timedOutRequests: 0,
      escalatedRequests: 0,
      averageResponseTime: 0,
      lastReset: Date.now()
    };

    logger.info('ApprovalService initialized', {
      defaultTimeout: this.config.defaultTimeout,
      escalationEnabled: this.config.autoEscalationEnabled,
      notificationEnabled: this.config.notificationEnabled
    });
  }

  /**
   * Submit approval request
   */
  async submitRequest(approvalRequest) {
    const timer = createTimer('approval_submit_request', {
      approvalId: approvalRequest.id,
      riskLevel: approvalRequest.risk_level
    });

    try {
      // Validate request
      const validatedRequest = ApprovalRequestSchema.parse(approvalRequest);
      
      // Generate content hash for deduplication
      const contentHash = this.generateContentHash(
        validatedRequest.content + (validatedRequest.proposed_response || '')
      );

      // Check for duplicate requests
      const existingRequest = await this.findExistingRequest(
        validatedRequest.user_id, 
        contentHash
      );

      if (existingRequest) {
        logger.info('Duplicate approval request found', {
          originalId: existingRequest.id,
          newId: validatedRequest.id,
          userId: validatedRequest.user_id
        });
        return {
          success: true,
          duplicate: true,
          approval_id: existingRequest.id,
          status: existingRequest.status
        };
      }

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + validatedRequest.approval_timeout_ms);

      // Store in database
      const dbResult = await this.postgres.query(`
        INSERT INTO approval_requests (
          id, workflow_id, thread_id, user_id, content, content_hash,
          proposed_response, risk_level, risk_score, sensitive_topics,
          status, approval_level, expires_at, context, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id, submitted_at
      `, [
        validatedRequest.id,
        validatedRequest.workflow_id,
        validatedRequest.thread_id,
        validatedRequest.user_id,
        validatedRequest.content,
        contentHash,
        validatedRequest.proposed_response,
        validatedRequest.risk_level,
        validatedRequest.risk_score,
        validatedRequest.sensitive_topics,
        'pending',
        validatedRequest.escalated ? 'escalated' : 'human',
        expiresAt,
        validatedRequest.context,
        { auto_approval_eligible: validatedRequest.auto_approval_eligible }
      ]);

      // Store in memory for quick access
      this.pendingRequests.set(validatedRequest.id, {
        ...validatedRequest,
        submitted_at: dbResult.rows[0].submitted_at,
        expires_at: expiresAt
      });

      // Set up timeout handler
      this.setupTimeout(validatedRequest.id, validatedRequest.approval_timeout_ms);

      // Send notifications
      await this.sendNotifications(validatedRequest, 'submitted');

      // Update stats
      this.stats.totalRequests++;
      this.stats.pendingRequests++;

      timer.end({ 
        success: true,
        duplicate: false,
        escalated: validatedRequest.escalated 
      });

      logger.info('Approval request submitted successfully', {
        approvalId: validatedRequest.id,
        riskLevel: validatedRequest.risk_level,
        riskScore: validatedRequest.risk_score,
        expiresAt: expiresAt.toISOString(),
        escalated: validatedRequest.escalated
      });

      return {
        success: true,
        duplicate: false,
        approval_id: validatedRequest.id,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        escalated: validatedRequest.escalated
      };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'submitRequest',
        approvalId: approvalRequest.id,
        userId: approvalRequest.user_id
      });
      throw error;
    }
  }

  /**
   * Escalate approval request
   */
  async escalateRequest(escalatedRequest) {
    const timer = createTimer('approval_escalate_request', {
      approvalId: escalatedRequest.id
    });

    try {
      // Update the request to mark as escalated
      const updatedRequest = {
        ...escalatedRequest,
        escalated: true,
        escalation_reason: escalatedRequest.escalation_reason || 'high_risk_content',
        approval_timeout_ms: escalatedRequest.approval_timeout_ms || this.config.escalationTimeout
      };

      // Submit as new escalated request
      const result = await this.submitRequest(updatedRequest);

      // Update original request if it exists
      if (this.pendingRequests.has(escalatedRequest.id)) {
        await this.postgres.query(`
          UPDATE approval_requests 
          SET status = 'escalated',
              escalation_reason = $2,
              approval_level = 'escalated',
              expires_at = $3,
              updated_at = NOW()
          WHERE id = $1
        `, [
          escalatedRequest.id,
          updatedRequest.escalation_reason,
          new Date(Date.now() + updatedRequest.approval_timeout_ms)
        ]);
      }

      this.stats.escalatedRequests++;

      timer.end({ success: true });

      logger.info('Approval request escalated', {
        approvalId: escalatedRequest.id,
        escalationReason: updatedRequest.escalation_reason,
        newTimeout: updatedRequest.approval_timeout_ms
      });

      return result;

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'escalateRequest',
        approvalId: escalatedRequest.id
      });
      throw error;
    }
  }

  /**
   * Process approval response
   */
  async processApprovalResponse(approvalId, response) {
    const timer = createTimer('approval_process_response', { approvalId });

    try {
      // Validate response
      const validatedResponse = ApprovalResponseSchema.parse({
        ...response,
        approval_id: approvalId
      });

      // Get request from database
      const requestResult = await this.postgres.query(`
        SELECT * FROM approval_requests WHERE id = $1
      `, [approvalId]);

      if (requestResult.rows.length === 0) {
        throw new Error(`Approval request not found: ${approvalId}`);
      }

      const request = requestResult.rows[0];

      if (request.status !== 'pending' && request.status !== 'escalated') {
        throw new Error(`Cannot process response for request with status: ${request.status}`);
      }

      // Update request in database
      const newStatus = validatedResponse.approved ? 'approved' : 'rejected';
      await this.postgres.query(`
        UPDATE approval_requests 
        SET status = $2,
            reviewer_id = $3,
            approval_reason = $4,
            rejection_reason = $5,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `, [
        approvalId,
        newStatus,
        validatedResponse.reviewer_id,
        validatedResponse.approval_reason,
        validatedResponse.rejection_reason
      ]);

      // Clear timeout
      this.clearTimeout(approvalId);

      // Remove from pending requests
      this.pendingRequests.delete(approvalId);

      // Update stats
      this.stats.pendingRequests = Math.max(0, this.stats.pendingRequests - 1);
      if (validatedResponse.approved) {
        this.stats.approvedRequests++;
      } else {
        this.stats.rejectedRequests++;
      }

      // Calculate response time
      const responseTime = Date.now() - new Date(request.submitted_at).getTime();
      this.updateAverageResponseTime(responseTime);

      // Send notifications
      await this.sendNotifications(request, newStatus, {
        reviewer_id: validatedResponse.reviewer_id,
        response_time: responseTime
      });

      timer.end({ 
        success: true, 
        approved: validatedResponse.approved,
        responseTime 
      });

      logger.info('Approval response processed', {
        approvalId,
        approved: validatedResponse.approved,
        reviewerId: validatedResponse.reviewer_id,
        responseTime
      });

      return {
        success: true,
        approval_id: approvalId,
        status: newStatus,
        approved: validatedResponse.approved,
        response_time: responseTime,
        request: request,
        response: validatedResponse
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
  async handleTimeout(approvalId) {
    const timer = createTimer('approval_handle_timeout', { approvalId });

    try {
      // Update request status in database
      await this.postgres.query(`
        UPDATE approval_requests 
        SET status = 'timeout',
            updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'escalated')
      `, [approvalId]);

      // Remove from pending requests
      const request = this.pendingRequests.get(approvalId);
      this.pendingRequests.delete(approvalId);

      // Clear timeout
      this.clearTimeout(approvalId);

      // Update stats
      this.stats.pendingRequests = Math.max(0, this.stats.pendingRequests - 1);
      this.stats.timedOutRequests++;

      // Send timeout notifications
      if (request) {
        await this.sendNotifications(request, 'timeout');
      }

      timer.end({ success: true });

      logger.warn('Approval request timed out', {
        approvalId,
        submittedAt: request?.submitted_at,
        timeoutDuration: request?.approval_timeout_ms
      });

      return {
        success: true,
        approval_id: approvalId,
        status: 'timeout',
        timed_out: true
      };

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'handleTimeout',
        approvalId
      });
      throw error;
    }
  }

  /**
   * Get approval request status
   */
  async getRequestStatus(approvalId) {
    try {
      const result = await this.postgres.query(`
        SELECT ar.*, 
               array_agg(ah.action ORDER BY ah.timestamp) as history_actions,
               array_agg(ah.timestamp ORDER BY ah.timestamp) as history_timestamps
        FROM approval_requests ar
        LEFT JOIN approval_history ah ON ar.id = ah.approval_request_id
        WHERE ar.id = $1
        GROUP BY ar.id
      `, [approvalId]);

      if (result.rows.length === 0) {
        return null;
      }

      const request = result.rows[0];
      
      return {
        ...request,
        history: request.history_actions.map((action, index) => ({
          action,
          timestamp: request.history_timestamps[index]
        })).filter(h => h.action !== null)
      };

    } catch (error) {
      logError(error, {
        operation: 'getRequestStatus',
        approvalId
      });
      throw error;
    }
  }

  /**
   * Get pending requests for a user or reviewer
   */
  async getPendingRequests(filters = {}) {
    const timer = createTimer('approval_get_pending_requests');

    try {
      let whereClause = "WHERE status IN ('pending', 'escalated')";
      const params = [];
      let paramIndex = 1;

      if (filters.user_id) {
        whereClause += ` AND user_id = $${paramIndex}`;
        params.push(filters.user_id);
        paramIndex++;
      }

      if (filters.risk_level) {
        whereClause += ` AND risk_level = $${paramIndex}`;
        params.push(filters.risk_level);
        paramIndex++;
      }

      if (filters.approval_level) {
        whereClause += ` AND approval_level = $${paramIndex}`;
        params.push(filters.approval_level);
        paramIndex++;
      }

      const query = `
        SELECT id, workflow_id, user_id, content, proposed_response,
               risk_level, risk_score, sensitive_topics, status,
               approval_level, submitted_at, expires_at,
               EXTRACT(EPOCH FROM (expires_at - NOW())) as seconds_until_expiry
        FROM approval_requests 
        ${whereClause}
        ORDER BY 
          CASE risk_level 
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
          END,
          submitted_at ASC
        LIMIT ${filters.limit || 50}
      `;

      const result = await this.postgres.query(query, params);

      timer.end({ 
        success: true, 
        requestCount: result.rows.length 
      });

      return result.rows.map(row => ({
        ...row,
        is_expired: row.seconds_until_expiry <= 0,
        expires_in_seconds: Math.max(0, row.seconds_until_expiry)
      }));

    } catch (error) {
      timer.end({ error: true });
      logError(error, {
        operation: 'getPendingRequests',
        filters
      });
      throw error;
    }
  }

  /**
   * Get approval statistics
   */
  getStats() {
    return {
      ...this.stats,
      pending_requests_memory: this.pendingRequests.size,
      active_timeouts: this.timeouts.size,
      uptime: Date.now() - this.stats.lastReset,
      config: this.config
    };
  }

  /**
   * Perform cleanup of expired requests
   */
  async performCleanup() {
    const timer = createTimer('approval_cleanup');

    try {
      // Handle expired requests
      const expiredResult = await this.postgres.query(`
        UPDATE approval_requests 
        SET status = 'timeout',
            updated_at = NOW()
        WHERE status IN ('pending', 'escalated') 
          AND expires_at < NOW()
        RETURNING id
      `);

      const expiredIds = expiredResult.rows.map(row => row.id);

      // Clean up memory and timeouts
      for (const expiredId of expiredIds) {
        this.pendingRequests.delete(expiredId);
        this.clearTimeout(expiredId);
        this.stats.timedOutRequests++;
      }

      // Update pending count
      const pendingResult = await this.postgres.query(`
        SELECT COUNT(*) as count 
        FROM approval_requests 
        WHERE status IN ('pending', 'escalated')
      `);

      this.stats.pendingRequests = parseInt(pendingResult.rows[0].count);

      timer.end({ 
        success: true, 
        expiredCount: expiredIds.length 
      });

      logger.info('Approval cleanup completed', {
        expiredRequests: expiredIds.length,
        currentPending: this.stats.pendingRequests
      });

      return {
        expired_requests: expiredIds.length,
        current_pending: this.stats.pendingRequests
      };

    } catch (error) {
      timer.end({ error: true });
      logError(error, { operation: 'performCleanup' });
      throw error;
    }
  }

  // Helper methods

  generateContentHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async findExistingRequest(userId, contentHash) {
    try {
      const result = await this.postgres.query(`
        SELECT id, status, submitted_at
        FROM approval_requests 
        WHERE user_id = $1 
          AND content_hash = $2 
          AND status IN ('pending', 'escalated')
          AND submitted_at > NOW() - INTERVAL '1 hour'
        ORDER BY submitted_at DESC
        LIMIT 1
      `, [userId, contentHash]);

      return result.rows.length > 0 ? result.rows[0] : null;

    } catch (error) {
      logError(error, { operation: 'findExistingRequest' });
      return null;
    }
  }

  setupTimeout(approvalId, timeoutMs) {
    // Clear any existing timeout
    this.clearTimeout(approvalId);

    // Set new timeout
    const timeoutId = setTimeout(() => {
      this.handleTimeout(approvalId).catch(error => {
        logError(error, {
          operation: 'timeoutHandler',
          approvalId
        });
      });
    }, timeoutMs);

    this.timeouts.set(approvalId, timeoutId);
  }

  clearTimeout(approvalId) {
    const timeoutId = this.timeouts.get(approvalId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(approvalId);
    }
  }

  async sendNotifications(request, event, metadata = {}) {
    if (!this.config.notificationEnabled) {
      return;
    }

    try {
      const notification = {
        event,
        approval_id: request.id,
        user_id: request.user_id,
        risk_level: request.risk_level,
        timestamp: new Date().toISOString(),
        metadata
      };

      // Add to notification queue
      this.notificationQueue.push(notification);

      // In a real implementation, send webhooks, emails, Slack messages, etc.
      logger.info('Approval notification queued', notification);

    } catch (error) {
      logError(error, {
        operation: 'sendNotifications',
        event,
        approvalId: request.id
      });
    }
  }

  updateAverageResponseTime(responseTime) {
    const totalResponses = this.stats.approvedRequests + this.stats.rejectedRequests;
    this.stats.averageResponseTime = 
      (this.stats.averageResponseTime * (totalResponses - 1) + responseTime) / totalResponses;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      // Clear all timeouts
      for (const timeoutId of this.timeouts.values()) {
        clearTimeout(timeoutId);
      }
      this.timeouts.clear();

      // Clear pending requests
      this.pendingRequests.clear();

      logger.info('ApprovalService shutdown completed');

    } catch (error) {
      logError(error, { operation: 'approval_service_shutdown' });
    }
  }
}

module.exports = ApprovalService;
