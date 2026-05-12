import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PromotionMetricsService } from '../promotions/promotion-metrics.service';
import { CreateUserEventDto } from './dto/create-user-event.dto';
import { UserEvent, UserEventDocument } from './schemas/user-event.schema';

@Injectable()
export class BehaviorTrackingService {
  private readonly logger = new Logger(BehaviorTrackingService.name);

  constructor(
    @InjectModel(UserEvent.name)
    private readonly userEventModel: Model<UserEventDocument>,
    private readonly promotionMetricsService: PromotionMetricsService,
  ) {}

  async recordEvent(
    dto: CreateUserEventDto,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    const resolvedSessionId = sessionId ?? randomUUID();

    const event = new this.userEventModel({
      userId: userId ?? null,
      sessionId: resolvedSessionId,
      eventType: dto.eventType,
      entityId: dto.entityId,
      entityType: dto.entityType,
      metadata: dto.metadata ?? {},
    });

    void event.save().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown persistence error';
      this.logger.error(`Failed to record user event: ${message}`);
    });

    void this.promotionMetricsService
      .captureTrackingEvent(dto, userId, resolvedSessionId)
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown conversion capture error';
        this.logger.warn(`Failed promotion conversion capture: ${message}`);
      });
  }

  async getRecentEvents(userId: string, limit: number): Promise<UserEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));

    return (await this.userEventModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean()
      .exec()) as UserEvent[];
  }
}
