import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserEvent,
  UserEventDocument,
  UserEventEntityType,
  UserEventType,
} from '../behavior-tracking/schemas/user-event.schema';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  UserProfile,
  UserProfileDocument,
} from './schemas/user-profile.schema';
import { applyTimeDecay } from './utils/decay';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS_IN_MS = 90 * DAY_IN_MS;
const THIRTY_DAYS_IN_MS = 30 * DAY_IN_MS;
const MAX_CATEGORY_AFFINITIES = 10;
const MIN_CATEGORY_EVENTS_BEFORE_FALLBACK = 3;
const USER_RECOMPUTE_BATCH_SIZE = 50;
const COMPLETED_ORDER_STATUSES = ['DELIVERED', 'SETTLED'];

interface CategorySignalRow {
  categoryId: Types.ObjectId;
  viewCount: number;
  addToCartCount: number;
  orderCount: number;
  eventCount: number;
  lastEventAt: Date;
}

interface OrderFallbackRow {
  categoryId: Types.ObjectId;
  orderCount: number;
  eventCount: number;
  lastEventAt: Date;
}

interface OrderMetricsRow {
  totalOrders: number;
  avgOrderValueCents: number;
  ordersLast30Days: number;
  lastOrderAt: Date | null;
}

interface PriceRangeRow {
  min: number;
  max: number;
}

export interface CategoryAffinity {
  categoryId: string;
  score: number;
  eventCount: number;
}

@Injectable()
export class FeatureEngineeringService {
  private readonly logger = new Logger(FeatureEngineeringService.name);

  constructor(
    @InjectModel(UserEvent.name)
    private readonly userEventModel: Model<UserEventDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(UserProfile.name)
    private readonly userProfileModel: Model<UserProfileDocument>,
  ) {}

  private toObjectId(value: string): Types.ObjectId | null {
    if (!Types.ObjectId.isValid(value)) {
      return null;
    }
    return new Types.ObjectId(value);
  }

  private daysSince(date: Date, now: Date): number {
    return Math.max(0, (now.getTime() - new Date(date).getTime()) / DAY_IN_MS);
  }

  private normalizeAffinities(affinities: CategoryAffinity[]): CategoryAffinity[] {
    const sum = affinities.reduce((acc, affinity) => acc + affinity.score, 0);
    if (sum <= 0) {
      return affinities.map((affinity) => ({ ...affinity, score: 0 }));
    }

    return affinities.map((affinity) => ({
      ...affinity,
      score: Number((affinity.score / sum).toFixed(6)),
    }));
  }

  private mergeAffinities(
    primary: CategoryAffinity[],
    fallback: CategoryAffinity[],
  ): CategoryAffinity[] {
    const merged = new Map<string, CategoryAffinity>();

    for (const affinity of primary) {
      merged.set(affinity.categoryId, { ...affinity });
    }

    for (const affinity of fallback) {
      const existing = merged.get(affinity.categoryId);
      if (!existing) {
        merged.set(affinity.categoryId, { ...affinity });
        continue;
      }

      merged.set(affinity.categoryId, {
        categoryId: existing.categoryId,
        score: existing.score + affinity.score,
        eventCount: existing.eventCount + affinity.eventCount,
      });
    }

    return Array.from(merged.values());
  }

  private async getCategorySignalsFromEvents(
    userObjectId: Types.ObjectId,
    since: Date,
  ): Promise<CategorySignalRow[]> {
    return this.userEventModel
      .aggregate<CategorySignalRow>([
        {
          $match: {
            userId: userObjectId,
            entityType: UserEventEntityType.CATEGORY,
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: '$entityId',
            viewCount: {
              $sum: {
                $cond: [{ $eq: ['$eventType', UserEventType.VIEW_CATEGORY] }, 1, 0],
              },
            },
            addToCartCount: {
              $sum: {
                $cond: [{ $eq: ['$eventType', UserEventType.ADD_TO_CART] }, 1, 0],
              },
            },
            orderCount: {
              $sum: {
                $cond: [{ $eq: ['$eventType', UserEventType.COMPLETE_ORDER] }, 1, 0],
              },
            },
            eventCount: { $sum: 1 },
            lastEventAt: { $max: '$createdAt' },
          },
        },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
            viewCount: 1,
            addToCartCount: 1,
            orderCount: 1,
            eventCount: 1,
            lastEventAt: 1,
          },
        },
        {
          $sort: {
            eventCount: -1,
            lastEventAt: -1,
          },
        },
        { $limit: MAX_CATEGORY_AFFINITIES },
      ])
      .exec();
  }

  private async getCategorySignalsFromCompletedOrders(
    userObjectId: Types.ObjectId,
  ): Promise<OrderFallbackRow[]> {
    return this.orderModel
      .aggregate<OrderFallbackRow>([
        {
          $match: {
            userId: userObjectId,
            status: { $in: COMPLETED_ORDER_STATUSES },
          },
        },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: '$product' },
        {
          $match: {
            'product.categoryId': { $ne: null },
          },
        },
        {
          $group: {
            _id: '$product.categoryId',
            orderCount: { $sum: 1 },
            eventCount: { $sum: '$items.quantity' },
            lastEventAt: { $max: '$updatedAt' },
          },
        },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
            orderCount: 1,
            eventCount: 1,
            lastEventAt: 1,
          },
        },
        {
          $sort: {
            eventCount: -1,
            lastEventAt: -1,
          },
        },
        { $limit: MAX_CATEGORY_AFFINITIES },
      ])
      .exec();
  }

  private async getOrderMetrics(
    userObjectId: Types.ObjectId,
    now: Date,
  ): Promise<OrderMetricsRow | null> {
    const rollingWindowStart = new Date(now.getTime() - THIRTY_DAYS_IN_MS);

    const [row] = await this.orderModel
      .aggregate<OrderMetricsRow>([
        {
          $match: {
            userId: userObjectId,
            status: { $in: COMPLETED_ORDER_STATUSES },
          },
        },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            avgOrderValueCents: { $avg: '$totalAmount' },
            ordersLast30Days: {
              $sum: {
                $cond: [{ $gte: ['$createdAt', rollingWindowStart] }, 1, 0],
              },
            },
            lastOrderAt: { $max: '$updatedAt' },
          },
        },
        {
          $project: {
            _id: 0,
            totalOrders: 1,
            avgOrderValueCents: 1,
            ordersLast30Days: 1,
            lastOrderAt: 1,
          },
        },
      ])
      .exec();

    return row ?? null;
  }

  private async getPreferredPriceRange(
    userObjectId: Types.ObjectId,
  ): Promise<PriceRangeRow | null> {
    const [row] = await this.orderModel
      .aggregate<PriceRangeRow>([
        {
          $match: {
            userId: userObjectId,
            status: { $in: COMPLETED_ORDER_STATUSES },
          },
        },
        { $unwind: '$items' },
        {
          $project: {
            unitPrice: '$items.unitPrice',
          },
        },
        {
          $match: {
            unitPrice: { $gt: 0 },
          },
        },
        {
          $sort: {
            unitPrice: 1,
          },
        },
        {
          $group: {
            _id: null,
            prices: { $push: '$unitPrice' },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            prices: 1,
            count: 1,
            minIndex: {
              $cond: [
                { $gt: ['$count', 0] },
                {
                  $floor: {
                    $multiply: [0.1, { $subtract: ['$count', 1] }],
                  },
                },
                0,
              ],
            },
            maxIndex: {
              $cond: [
                { $gt: ['$count', 0] },
                {
                  $floor: {
                    $multiply: [0.9, { $subtract: ['$count', 1] }],
                  },
                },
                0,
              ],
            },
          },
        },
        {
          $project: {
            _id: 0,
            min: {
              $cond: [
                { $gt: ['$count', 0] },
                { $arrayElemAt: ['$prices', '$minIndex'] },
                0,
              ],
            },
            max: {
              $cond: [
                { $gt: ['$count', 0] },
                { $arrayElemAt: ['$prices', '$maxIndex'] },
                0,
              ],
            },
          },
        },
      ])
      .exec();

    return row ?? null;
  }

  private async getLastEventAt(userObjectId: Types.ObjectId): Promise<Date | null> {
    const [row] = await this.userEventModel
      .aggregate<{ lastEventAt: Date }>([
        {
          $match: {
            userId: userObjectId,
          },
        },
        {
          $group: {
            _id: null,
            lastEventAt: { $max: '$createdAt' },
          },
        },
        {
          $project: {
            _id: 0,
            lastEventAt: 1,
          },
        },
      ])
      .exec();

    return row?.lastEventAt ?? null;
  }

  async computeCategoryAffinities(userId: string): Promise<CategoryAffinity[]> {
    const userObjectId = this.toObjectId(userId);
    if (!userObjectId) {
      return [];
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_IN_MS);

    const eventSignals = await this.getCategorySignalsFromEvents(
      userObjectId,
      ninetyDaysAgo,
    );

    const eventAffinities: CategoryAffinity[] = eventSignals.map((signal) => {
      const rawScore =
        signal.viewCount * 0.2 +
        signal.addToCartCount * 0.5 +
        signal.orderCount * 1.0;

      return {
        categoryId: String(signal.categoryId),
        score: applyTimeDecay(rawScore, this.daysSince(signal.lastEventAt, now)),
        eventCount: signal.eventCount,
      };
    });

    const totalCategoryEvents = eventSignals.reduce(
      (sum, signal) => sum + signal.eventCount,
      0,
    );

    let combinedAffinities = [...eventAffinities];

    if (totalCategoryEvents < MIN_CATEGORY_EVENTS_BEFORE_FALLBACK) {
      const orderFallbackSignals = await this.getCategorySignalsFromCompletedOrders(
        userObjectId,
      );

      const fallbackAffinities: CategoryAffinity[] = orderFallbackSignals.map(
        (signal) => ({
          categoryId: String(signal.categoryId),
          score: applyTimeDecay(
            signal.orderCount * 1.0,
            this.daysSince(signal.lastEventAt, now),
          ),
          eventCount: signal.eventCount,
        }),
      );

      combinedAffinities = this.mergeAffinities(
        combinedAffinities,
        fallbackAffinities,
      );
    }

    const ranked = combinedAffinities
      .filter((affinity) => affinity.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_CATEGORY_AFFINITIES);

    return this.normalizeAffinities(ranked);
  }

  async recomputeUserProfile(userId: string): Promise<void> {
    const userObjectId = this.toObjectId(userId);
    if (!userObjectId) {
      return;
    }

    const now = new Date();

    const [affinities, orderMetrics, preferredPriceRange, lastEventAt] =
      await Promise.all([
        this.computeCategoryAffinities(userId),
        this.getOrderMetrics(userObjectId, now),
        this.getPreferredPriceRange(userObjectId),
        this.getLastEventAt(userObjectId),
      ]);

    const affinityEntries = affinities
      .filter((affinity) => Types.ObjectId.isValid(affinity.categoryId))
      .map((affinity) => ({
        categoryId: new Types.ObjectId(affinity.categoryId),
        score: affinity.score,
        eventCount: affinity.eventCount,
      }))
      .slice(0, MAX_CATEGORY_AFFINITIES);

    const topCategoryIds = affinityEntries.slice(0, 3).map((entry) => entry.categoryId);

    const totalOrders = orderMetrics?.totalOrders ?? 0;
    const avgOrderValue = Number(
      (((orderMetrics?.avgOrderValueCents ?? 0) as number) / 100).toFixed(2),
    );
    const purchaseFrequency = orderMetrics?.ordersLast30Days ?? 0;

    const preferredMin = Number(
      (((preferredPriceRange?.min ?? 0) as number) / 100).toFixed(2),
    );
    const preferredMax = Number(
      (((preferredPriceRange?.max ?? 0) as number) / 100).toFixed(2),
    );

    const normalizedPriceRange =
      preferredMax >= preferredMin
        ? { min: preferredMin, max: preferredMax }
        : { min: preferredMin, max: preferredMin };

    const lastOrderAt = orderMetrics?.lastOrderAt ?? null;
    const lastActiveAt =
      !lastEventAt && !lastOrderAt
        ? null
        : new Date(
            Math.max(
              lastEventAt ? new Date(lastEventAt).getTime() : 0,
              lastOrderAt ? new Date(lastOrderAt).getTime() : 0,
            ),
          );

    await this.userProfileModel
      .findOneAndUpdate(
        { userId: userObjectId },
        {
          $set: {
            userId: userObjectId,
            categoryAffinities: affinityEntries,
            topCategoryIds,
            purchaseFrequency,
            avgOrderValue,
            preferredPriceRange: normalizedPriceRange,
            totalOrders,
            lastActiveAt,
            isNewUser: totalOrders < 3,
            recomputedAt: now,
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
  }

  async recomputeAllProfiles(): Promise<{ processed: number; failed: number }> {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_IN_MS);

    const activeUserIds = await this.userEventModel.distinct('userId', {
      userId: { $ne: null },
      createdAt: { $gte: thirtyDaysAgo },
    });

    const candidateUserIds = activeUserIds
      .map((userObjectId) => String(userObjectId))
      .filter((id) => Types.ObjectId.isValid(id));

    let processed = 0;
    let failed = 0;

    for (
      let startIndex = 0;
      startIndex < candidateUserIds.length;
      startIndex += USER_RECOMPUTE_BATCH_SIZE
    ) {
      const batch = candidateUserIds.slice(
        startIndex,
        startIndex + USER_RECOMPUTE_BATCH_SIZE,
      );

      const batchResults = await Promise.allSettled(
        batch.map((id) => this.recomputeUserProfile(id)),
      );

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          processed += 1;
          return;
        }

        failed += 1;
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : 'Unknown recompute error';
        this.logger.error(
          `Failed to recompute profile for user ${batch[index]}: ${reason}`,
        );
      });
    }

    return { processed, failed };
  }
}
