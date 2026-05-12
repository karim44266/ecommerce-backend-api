import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { FeatureEngineeringService } from '../feature-engineering.service';
import { JobLock, JobLockDocument } from '../schemas/job-lock.schema';

const PROFILE_RECOMPUTE_JOB_NAME = 'promotions-profile-recompute';
const LOCK_WINDOW_IN_MS = 7 * 60 * 60 * 1000;

export interface ProfileRecomputeRunResult {
  processed: number;
  failed: number;
  durationMs: number;
  startedAt: Date;
  skipped: boolean;
}

@Injectable()
export class ProfileRecomputeJob {
  private readonly logger = new Logger(ProfileRecomputeJob.name);

  constructor(
    @InjectModel(JobLock.name)
    private readonly jobLockModel: Model<JobLockDocument>,
    private readonly featureEngineeringService: FeatureEngineeringService,
  ) {}

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return false;
    }

    return (error as { code?: number }).code === 11000;
  }

  private async acquireDistributedLock(now: Date): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - LOCK_WINDOW_IN_MS);
    const ttl = new Date(now.getTime() + LOCK_WINDOW_IN_MS);

    try {
      const lock = await this.jobLockModel
        .findOneAndUpdate(
          {
            jobName: PROFILE_RECOMPUTE_JOB_NAME,
            $or: [{ lockedAt: { $lt: staleBefore } }, { lockedAt: { $exists: false } }],
          },
          {
            $set: {
              jobName: PROFILE_RECOMPUTE_JOB_NAME,
              lockedAt: now,
              ttl,
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        )
        .lean()
        .exec();

      return Boolean(lock);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async releaseDistributedLock(): Promise<void> {
    await this.jobLockModel.deleteOne({ jobName: PROFILE_RECOMPUTE_JOB_NAME });
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async handleCron(): Promise<void> {
    await this.runManually();
  }

  async runManually(): Promise<ProfileRecomputeRunResult> {
    const startedAt = new Date();
    const startedAtMs = Date.now();

    const lockAcquired = await this.acquireDistributedLock(startedAt);
    if (!lockAcquired) {
      this.logger.log(
        `Skipped ${PROFILE_RECOMPUTE_JOB_NAME}: lock is active (< 7h old).`,
      );

      return {
        processed: 0,
        failed: 0,
        durationMs: 0,
        startedAt,
        skipped: true,
      };
    }

    this.logger.log(
      `Started ${PROFILE_RECOMPUTE_JOB_NAME} at ${startedAt.toISOString()}.`,
    );

    try {
      const { processed, failed } =
        await this.featureEngineeringService.recomputeAllProfiles();

      const durationMs = Date.now() - startedAtMs;
      this.logger.log(
        `${PROFILE_RECOMPUTE_JOB_NAME} completed in ${durationMs}ms (processed=${processed}, failed=${failed}).`,
      );

      return {
        processed,
        failed,
        durationMs,
        startedAt,
        skipped: false,
      };
    } finally {
      await this.releaseDistributedLock();
    }
  }
}
