/**
 * Cross Validator
 * 
 * Validates metrics across different data sources (GitHub and NEAR)
 * to ensure data consistency and reliability. Performs checks on:
 * - Timestamp consistency
 * - Activity correlation
 * - User engagement patterns
 * 
 * @remarks
 * This is a critical component for ensuring data quality before
 * reward calculations are performed.
 */

import {
  GitHubMetrics,
  NEARMetrics,
  ValidationResult,
  ValidationError,
  ValidationWarning
} from '../types';
import { ErrorCode } from '../utils/errors';
import { ValidationErrorCode } from '../types/validation';

interface ValidationThresholds {
  maxTimeDrift: number;
  minActivityCorrelation: number;
  maxDataAge: number;
  maxUserDiffRatio: number;
}

const DEFAULT_THRESHOLDS: Required<ValidationThresholds> = {
  maxTimeDrift: 6 * 60 * 60 * 1000,
  minActivityCorrelation: 0.3,
  maxDataAge: 24 * 60 * 60 * 1000,
  maxUserDiffRatio: 0.5
};

export class CrossValidator {
  private readonly thresholds: Required<ValidationThresholds>;

  constructor(
    thresholds: Partial<ValidationThresholds> = {}
  ) {
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds
    };
  }

  validate(github: GitHubMetrics, near: NEARMetrics): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (this.hasTimestampDrift(github, near)) {
      errors.push(this.createValidationError(
        'TIMESTAMP_DRIFT',
        'Significant time drift between metrics',
        { drift: this.calculateTimeDrift(github, near) }
      ));
    }

    this.validateDataFreshness(github, near, errors);
    this.validateActivityCorrelation(github, near, warnings);
    this.validateUserEngagement(github, near, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      timestamp: Date.now(),
      metadata: {
        source: 'github',
        validationType: 'data'
      }
    };
  }

  private createValidationError(
    code: ValidationErrorCode,
    message: string,
    context: Record<string, unknown>
  ): ValidationError {
    return {
      code,
      message,
      context
    };
  }

  private validateActivityCorrelation(
    github: GitHubMetrics,
    near: NEARMetrics,
    warnings: ValidationWarning[]
  ): void {
    const correlation = this.calculateActivityCorrelation(github, near);
    
    if (correlation < this.thresholds.minActivityCorrelation) {
      warnings.push(this.createValidationError(
        'LOW_ACTIVITY_CORRELATION',
        'Low correlation between GitHub and NEAR activity',
        {
          correlation,
          threshold: this.thresholds.minActivityCorrelation
        }
      ));
    }
  }

  private validateTimestamps(
    github: GitHubMetrics,
    near: NEARMetrics,
    errors: ValidationError[]
  ): void {
    const githubTimestamp = github.metadata.collectionTimestamp;
    const nearTimestamp = near.metadata.collectionTimestamp;
    const timeDiff = Math.abs(githubTimestamp - nearTimestamp);

    if (timeDiff > this.thresholds.maxTimeDrift) {
      errors.push({
        code: ErrorCode.TIMESTAMP_DRIFT,
        message: 'Significant time drift between GitHub and NEAR metrics',
        context: {
          githubTimestamp,
          nearTimestamp,
          drift: timeDiff,
          threshold: this.thresholds.maxTimeDrift
        }
      });
    }
  }

  private validateDataFreshness(
    github: GitHubMetrics,
    near: NEARMetrics,
    errors: ValidationError[]
  ): void {
    const now = Date.now();

    if (now - github.metadata.collectionTimestamp > this.thresholds.maxDataAge) {
      errors.push(this.createValidationError(
        'STALE_DATA',
        'GitHub data is too old',
        {
          timestamp: github.metadata.collectionTimestamp,
          maxAge: this.thresholds.maxDataAge
        }
      ));
    }

    if (now - near.metadata.collectionTimestamp > this.thresholds.maxDataAge) {
      errors.push(this.createValidationError(
        'STALE_DATA',
        'NEAR data is too old',
        {
          timestamp: near.metadata.collectionTimestamp,
          maxAge: this.thresholds.maxDataAge
        }
      ));
    }
  }

  private validateUserEngagement(
    github: GitHubMetrics,
    near: NEARMetrics,
    warnings: ValidationWarning[]
  ): void {
    const githubUsers = new Set([
      ...github.commits.authors,
      ...github.pullRequests.authors,
      ...github.issues.participants
    ]);

    const nearUsers = new Set([
      ...near.transactions.uniqueUsers,
      ...near.contract.uniqueCallers
    ]);

    const userDiff = Math.abs(githubUsers.size - nearUsers.size);
    const maxDiff = Math.max(githubUsers.size, nearUsers.size) * this.thresholds.maxUserDiffRatio;

    if (userDiff > maxDiff) {
      warnings.push({
        code: ErrorCode.USER_COUNT_DISCREPANCY,
        message: 'Large discrepancy between GitHub and NEAR user counts',
        context: {
          githubUsers: githubUsers.size,
          nearUsers: nearUsers.size,
          difference: userDiff,
          threshold: maxDiff
        }
      });
    }
  }

  private calculateActivityCorrelation(
    github: GitHubMetrics,
    near: NEARMetrics
  ): number {
    // Ensure all properties are defined with defaults
    const githubActivity = (
      (github.commits.count) +
      (github.pullRequests.merged) +
      (github.issues.closed)
    ) / 3;

    const nearActivity = (
      (near.transactions.count) +
      (near.contract.calls)
    ) / 2;

    const maxActivity = Math.max(githubActivity, nearActivity);
    if (maxActivity === 0) return 1;
    return Math.min(githubActivity, nearActivity) / maxActivity;
  }

  private hasTimestampDrift(
    github: GitHubMetrics,
    near: NEARMetrics
  ): boolean {
    const githubTimestamp = github.metadata.collectionTimestamp;
    const nearTimestamp = near.metadata.collectionTimestamp;
    const timeDiff = Math.abs(githubTimestamp - nearTimestamp);

    return timeDiff > this.thresholds.maxTimeDrift;
  }

  private calculateTimeDrift(github: GitHubMetrics, near: NEARMetrics): number {
    return Math.abs(
      github.metadata.collectionTimestamp - near.metadata.collectionTimestamp
    );
  }
}
