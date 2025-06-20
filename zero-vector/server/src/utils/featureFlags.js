/**
 * Feature Flags System for Zero Vector 2.0
 * Safe deployment and rollback capabilities for hybrid vector-graph features
 */

const config = require('../config');
const logger = require('./logger');

class FeatureFlags {
  constructor() {
    this.flags = {
      // Core hybrid features
      hybridSearch: this.getBooleanFlag('FEATURE_HYBRID_SEARCH', config.features.hybridSearch),
      entityExtraction: this.getBooleanFlag('FEATURE_ENTITY_EXTRACTION', config.features.entityExtraction),
      graphExpansion: this.getBooleanFlag('FEATURE_GRAPH_EXPANSION', config.features.graphExpansion),
      
      // Graph system components
      graphEnabled: this.getBooleanFlag('GRAPH_ENABLED', config.hybrid.graphEnabled),
      graphCacheEnabled: this.getBooleanFlag('GRAPH_CACHE_ENABLED', config.hybrid.performance.graphCacheEnabled),
      graphMetricsEnabled: this.getBooleanFlag('ENABLE_GRAPH_METRICS', config.hybrid.performance.enableGraphMetrics),
      
      // Advanced features (disabled by default)
      relationshipInference: this.getBooleanFlag('FEATURE_RELATIONSHIP_INFERENCE', config.features.relationshipInference),
      crossPersonaSharing: this.getBooleanFlag('FEATURE_CROSS_PERSONA_SHARING', config.features.crossPersonaSharing),
      temporalRelationships: this.getBooleanFlag('FEATURE_TEMPORAL_RELATIONSHIPS', config.features.temporalRelationships),
      
      // Performance optimizations
      adaptiveIndexing: this.getBooleanFlag('FEATURE_ADAPTIVE_INDEXING', config.features.adaptiveIndexing),
      vectorCompression: this.getBooleanFlag('FEATURE_VECTOR_COMPRESSION', config.features.vectorCompression),
      intelligentCaching: this.getBooleanFlag('FEATURE_INTELLIGENT_CACHING', config.features.intelligentCaching)
    };

    // Runtime flag overrides (for emergency rollback)
    this.runtimeOverrides = new Map();

    // Initialize monitoring
    this.logCurrentFlags();
  }

  /**
   * Get boolean flag value with fallback
   */
  getBooleanFlag(envVar, defaultValue) {
    const value = process.env[envVar];
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true';
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(flagName) {
    // Check runtime overrides first (for emergency rollback)
    if (this.runtimeOverrides.has(flagName)) {
      const override = this.runtimeOverrides.get(flagName);
      logger.warn('Feature flag runtime override active', {
        flag: flagName,
        overrideValue: override.value,
        reason: override.reason,
        timestamp: override.timestamp
      });
      return override.value;
    }

    // Check configured flags
    const isEnabled = this.flags[flagName];
    if (isEnabled === undefined) {
      logger.warn('Unknown feature flag requested', { flag: flagName });
      return false;
    }

    return isEnabled;
  }

  /**
   * Set runtime override for emergency rollback
   */
  setRuntimeOverride(flagName, value, reason = 'Manual override') {
    const override = {
      value,
      reason,
      timestamp: new Date().toISOString(),
      originalValue: this.flags[flagName]
    };

    this.runtimeOverrides.set(flagName, override);
    
    logger.warn('Feature flag runtime override set', {
      flag: flagName,
      newValue: value,
      originalValue: override.originalValue,
      reason
    });

    return override;
  }

  /**
   * Remove runtime override
   */
  removeRuntimeOverride(flagName) {
    const override = this.runtimeOverrides.get(flagName);
    if (override) {
      this.runtimeOverrides.delete(flagName);
      logger.info('Feature flag runtime override removed', {
        flag: flagName,
        restoredValue: this.flags[flagName]
      });
      return true;
    }
    return false;
  }

  /**
   * Get all active flags and their states
   */
  getAllFlags() {
    const result = {};
    for (const [flagName, configValue] of Object.entries(this.flags)) {
      result[flagName] = {
        configured: configValue,
        active: this.isEnabled(flagName),
        hasOverride: this.runtimeOverrides.has(flagName)
      };
    }
    return result;
  }

  /**
   * Check if hybrid mode is fully enabled
   */
  isHybridModeEnabled() {
    return this.isEnabled('graphEnabled') && 
           this.isEnabled('hybridSearch') && 
           this.isEnabled('entityExtraction');
  }

  /**
   * Check if graph expansion is available
   */
  isGraphExpansionAvailable() {
    return this.isHybridModeEnabled() && this.isEnabled('graphExpansion');
  }

  /**
   * Get safe fallback configuration for API responses
   */
  getSafeFallbackConfig() {
    return {
      useVector: true,
      useGraph: this.isEnabled('graphEnabled'),
      useHybridSearch: this.isEnabled('hybridSearch'),
      enableEntityExtraction: this.isEnabled('entityExtraction'),
      enableGraphExpansion: this.isEnabled('graphExpansion')
    };
  }

  /**
   * Emergency rollback - disable all v2.0 features
   */
  emergencyRollback(reason = 'Emergency rollback initiated') {
    const rollbackFlags = [
      'hybridSearch',
      'entityExtraction', 
      'graphExpansion',
      'graphEnabled'
    ];

    const rollbackTimestamp = new Date().toISOString();
    
    rollbackFlags.forEach(flag => {
      this.setRuntimeOverride(flag, false, `${reason} at ${rollbackTimestamp}`);
    });

    logger.error('Emergency rollback executed', {
      reason,
      timestamp: rollbackTimestamp,
      disabledFlags: rollbackFlags
    });

    return {
      timestamp: rollbackTimestamp,
      reason,
      disabledFlags: rollbackFlags,
      instruction: 'All Zero Vector 2.0 features disabled. System running in v1.0 compatibility mode.'
    };
  }

  /**
   * Gradual rollout helper - enable features for percentage of requests
   */
  isEnabledForRollout(flagName, rolloutPercentage = 100, userId = null) {
    if (!this.isEnabled(flagName)) {
      return false;
    }

    if (rolloutPercentage >= 100) {
      return true;
    }

    // Use consistent hashing for user-based rollout
    if (userId) {
      const hash = this.simpleHash(userId + flagName);
      return (hash % 100) < rolloutPercentage;
    }

    // Random rollout for non-user-specific features
    return Math.random() * 100 < rolloutPercentage;
  }

  /**
   * Simple hash function for consistent rollout
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Log current flag configuration
   */
  logCurrentFlags() {
    const enabledFlags = Object.entries(this.flags)
      .filter(([, value]) => value)
      .map(([name]) => name);

    const disabledFlags = Object.entries(this.flags)
      .filter(([, value]) => !value)
      .map(([name]) => name);

    logger.info('Feature flags initialized', {
      totalFlags: Object.keys(this.flags).length,
      enabledCount: enabledFlags.length,
      disabledCount: disabledFlags.length,
      enabledFlags,
      hybridModeEnabled: this.isHybridModeEnabled(),
      graphExpansionAvailable: this.isGraphExpansionAvailable()
    });
  }

  /**
   * Health check for feature flag system
   */
  healthCheck() {
    const health = {
      status: 'healthy',
      checks: {
        configLoaded: Object.keys(this.flags).length > 0,
        hybridModeReady: this.isHybridModeEnabled(),
        runtimeOverridesActive: this.runtimeOverrides.size > 0,
        emergencyRollbackAvailable: true
      },
      details: {
        totalFlags: Object.keys(this.flags).length,
        enabledFlags: Object.entries(this.flags).filter(([, v]) => v).length,
        activeOverrides: this.runtimeOverrides.size,
        hybridModeEnabled: this.isHybridModeEnabled()
      }
    };

    // Check for any concerning states
    if (this.runtimeOverrides.size > 0) {
      health.status = 'warning';
      health.warnings = ['Runtime overrides are active - check if emergency rollback was triggered'];
    }

    if (!health.checks.configLoaded) {
      health.status = 'error';
      health.errors = ['Feature flag configuration failed to load'];
    }

    return health;
  }
}

// Create singleton instance
const featureFlags = new FeatureFlags();

module.exports = featureFlags;
