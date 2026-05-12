import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreateUserEventDto } from '../behavior-tracking/dto/create-user-event.dto';
import { UserEventEntityType } from '../behavior-tracking/schemas/user-event.schema';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  PromotionConversion,
  PromotionConversionDocument,
} from './schemas/promotion-conversion.schema';

const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

type PromotionSource = 'personalized' | 'popular' | 'fallback';

interface MetricsSummaryRow {
  impressions: number;
  clicks: number;
  conversions: number;
  CTR: number;
  conversionRate: number;
  adminForcedImpressions: number;
  adminForcedClicks: number;
  adminForcedConversions: number;
}

interface MetricsBySourceRow {
  source: string;
  impressions: number;
  clicks: number;
  conversions: number;
  CTR: number;
  conversionRate: number;
}

interface MetricsTopProductRow {
  productId: Types.ObjectId;
  productName: string | null;
  conversions: number;
}

interface MetricsTopOfferPerformanceRow {
  productId: Types.ObjectId;
  productName: string | null;
  conversions: number;
  revenueAttributed: number;
}

interface MetricsRevenueRow {
  revenueAttributed: number;
}

interface MetricsDailyFunnelRow {
  bucket: string;
  impressions: number;
  clicks: number;
  conversions: number;
  adminForcedImpressions: number;
  adminForcedClicks: number;
  adminForcedConversions: number;
}

interface MetricsDailyRevenueRow {
  bucket: string;
  revenueAttributed: number;
}

interface MetricsFacetResult {
  summary: MetricsSummaryRow[];
  bySource: MetricsBySourceRow[];
  topConvertingProducts: MetricsTopProductRow[];
  revenue: MetricsRevenueRow[];
}

interface MetricsWindowFacetResult {
  summary: MetricsSummaryRow[];
  bySource: MetricsBySourceRow[];
  revenue: MetricsRevenueRow[];
}

export interface PromotionMetricsBySourceRow {
  source: string;
  impressions: number;
  clicks: number;
  conversions: number;
  CTR: number;
  conversionRate: number;
}

export interface PromotionMetricsTopOfferRow {
  productId: string;
  productName: string | null;
  conversions: number;
  revenueAttributed: number;
  contributionRate: number;
}

export interface PromotionMetricsTimelinePoint {
  bucket: string;
  label: string;
  impressions: number;
  clicks: number;
  conversions: number;
  adminForcedImpressions: number;
  adminForcedClicks: number;
  adminForcedConversions: number;
  CTR: number;
  conversionRate: number;
  revenueAttributed: number;
  revenuePerClick: number;
}

export interface PromotionMetricsPeriodSnapshot {
  impressions: number;
  clicks: number;
  conversions: number;
  CTR: number;
  conversionRate: number;
  revenueAttributed: number;
  adminForced: {
    impressions: number;
    clicks: number;
    conversions: number;
  };
  bySource: PromotionMetricsBySourceRow[];
  topOfferPerformance: PromotionMetricsTopOfferRow[];
}

export interface PromotionMetricsSummary {
  impressions: number;
  clicks: number;
  conversions: number;
  CTR: number;
  conversionRate: number;
  revenueAttributed: number;
  adminForced: {
    impressions: number;
    clicks: number;
    conversions: number;
  };
  bySource: PromotionMetricsBySourceRow[];
  topConvertingProducts: Array<{
    productId: string;
    productName: string | null;
    conversions: number;
    revenueAttributed: number;
  }>;
  topOfferPerformance: PromotionMetricsTopOfferRow[];
  previousPeriod: PromotionMetricsPeriodSnapshot;
  timeline: PromotionMetricsTimelinePoint[];
  period: {
    days: number;
    currentStart: string;
    currentEndExclusive: string;
    previousStart: string;
    previousEndExclusive: string;
  };
}

@Injectable()
export class PromotionMetricsService {
  private readonly logger = new Logger(PromotionMetricsService.name);

  constructor(
    @InjectModel(PromotionConversion.name)
    private readonly conversionModel: Model<PromotionConversionDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  private toObjectId(value: string): Types.ObjectId | null {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
  }

  private normalizeSource(value: unknown): PromotionSource {
    if (value === 'personalized' || value === 'popular' || value === 'fallback') {
      return value;
    }

    return 'popular';
  }

  private normalizePosition(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : -1;
  }

  private roundToTwo(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }

    return Number(numeric.toFixed(2));
  }

  private startOfUtcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private addUtcDays(value: Date, days: number): Date {
    return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private toUtcDayKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private toTimelineLabel(dayKey: string): string {
    const date = new Date(`${dayKey}T00:00:00.000Z`);

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  private buildSummaryFacetStages(): PipelineStage.FacetPipelineStage[] {
    return [
      {
        $group: {
          _id: null,
          impressions: {
            $sum: {
              $cond: [{ $ne: ['$isAdminForced', true] }, 1, 0],
            },
          },
          clicks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isAdminForced', true] },
                    { $ne: ['$clickedAt', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          conversions: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isAdminForced', true] },
                    { $eq: ['$converted', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          adminForcedImpressions: {
            $sum: {
              $cond: [{ $eq: ['$isAdminForced', true] }, 1, 0],
            },
          },
          adminForcedClicks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAdminForced', true] },
                    { $ne: ['$clickedAt', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          adminForcedConversions: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAdminForced', true] },
                    { $eq: ['$converted', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          impressions: 1,
          clicks: 1,
          conversions: 1,
          adminForcedImpressions: 1,
          adminForcedClicks: 1,
          adminForcedConversions: 1,
          CTR: {
            $cond: [
              { $gt: ['$impressions', 0] },
              { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] },
              0,
            ],
          },
          conversionRate: {
            $cond: [
              { $gt: ['$clicks', 0] },
              { $multiply: [{ $divide: ['$conversions', '$clicks'] }, 100] },
              0,
            ],
          },
        },
      },
    ];
  }

  private buildBySourceFacetStages(): PipelineStage.FacetPipelineStage[] {
    return [
      {
        $group: {
          _id: '$source',
          impressions: {
            $sum: {
              $cond: [{ $ne: ['$isAdminForced', true] }, 1, 0],
            },
          },
          clicks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isAdminForced', true] },
                    { $ne: ['$clickedAt', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          conversions: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isAdminForced', true] },
                    { $eq: ['$converted', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          source: { $ifNull: ['$_id', 'unknown'] },
          impressions: 1,
          clicks: 1,
          conversions: 1,
          CTR: {
            $cond: [
              { $gt: ['$impressions', 0] },
              { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] },
              0,
            ],
          },
          conversionRate: {
            $cond: [
              { $gt: ['$clicks', 0] },
              { $multiply: [{ $divide: ['$conversions', '$clicks'] }, 100] },
              0,
            ],
          },
        },
      },
      {
        $sort: { impressions: -1 },
      },
    ];
  }

  private buildTopConvertingProductsFacetStages(): PipelineStage.FacetPipelineStage[] {
    return [
      {
        $match: {
          converted: true,
          isAdminForced: { $ne: true },
        },
      },
      {
        $group: {
          _id: '$productId',
          conversions: { $sum: 1 },
        },
      },
      {
        $sort: { conversions: -1 },
      },
      {
        $limit: 5,
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: {
          path: '$product',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          productId: '$_id',
          productName: '$product.name',
          conversions: 1,
        },
      },
    ];
  }

  private buildRevenueFacetStages(): PipelineStage.FacetPipelineStage[] {
    return [
      {
        $match: {
          converted: true,
          isAdminForced: { $ne: true },
          orderId: { $ne: null },
        },
      },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order',
        },
      },
      {
        $unwind: {
          path: '$order',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $project: {
          productId: 1,
          items: '$order.items',
        },
      },
      {
        $project: {
          matchedItem: {
            $first: {
              $filter: {
                input: '$items',
                as: 'item',
                cond: {
                  $eq: [
                    { $toString: '$$item.productId' },
                    { $toString: '$productId' },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $project: {
          revenueCents: {
            $ifNull: [
              {
                $multiply: ['$matchedItem.unitPrice', '$matchedItem.quantity'],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          revenueAttributedCents: { $sum: '$revenueCents' },
        },
      },
      {
        $project: {
          _id: 0,
          revenueAttributed: { $divide: ['$revenueAttributedCents', 100] },
        },
      },
    ];
  }

  private buildTopOfferPerformancePipeline(
    windowMatch: Record<string, unknown>,
    limit = 12,
  ): PipelineStage[] {
    return [
      {
        $match: {
          ...windowMatch,
          converted: true,
          isAdminForced: { $ne: true },
        },
      },
      {
        $project: {
          productId: 1,
          orderId: 1,
        },
      },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order',
        },
      },
      {
        $unwind: {
          path: '$order',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          productId: 1,
          matchedItem: {
            $first: {
              $filter: {
                input: { $ifNull: ['$order.items', []] },
                as: 'item',
                cond: {
                  $eq: [
                    { $toString: '$$item.productId' },
                    { $toString: '$productId' },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $project: {
          productId: 1,
          revenueCents: {
            $ifNull: [
              {
                $multiply: ['$matchedItem.unitPrice', '$matchedItem.quantity'],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$productId',
          conversions: { $sum: 1 },
          revenueCents: { $sum: '$revenueCents' },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: {
          path: '$product',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          productId: '$_id',
          productName: '$product.name',
          conversions: 1,
          revenueAttributed: { $divide: ['$revenueCents', 100] },
        },
      },
      {
        $sort: {
          conversions: -1,
          revenueAttributed: -1,
        },
      },
      {
        $limit: Math.max(1, limit),
      },
    ];
  }

  private buildDailyFunnelPipeline(
    windowMatch: Record<string, unknown>,
  ): PipelineStage[] {
    return [
      {
        $match: windowMatch,
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: '$impressedAt',
              format: '%Y-%m-%d',
              timezone: 'UTC',
            },
          },
          impressions: {
            $sum: {
              $cond: [{ $ne: ['$isAdminForced', true] }, 1, 0],
            },
          },
          clicks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isAdminForced', true] },
                    { $ne: ['$clickedAt', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          conversions: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isAdminForced', true] },
                    { $eq: ['$converted', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          adminForcedImpressions: {
            $sum: {
              $cond: [{ $eq: ['$isAdminForced', true] }, 1, 0],
            },
          },
          adminForcedClicks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAdminForced', true] },
                    { $ne: ['$clickedAt', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          adminForcedConversions: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAdminForced', true] },
                    { $eq: ['$converted', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id',
          impressions: 1,
          clicks: 1,
          conversions: 1,
          adminForcedImpressions: 1,
          adminForcedClicks: 1,
          adminForcedConversions: 1,
        },
      },
      {
        $sort: {
          bucket: 1,
        },
      },
    ];
  }

  private buildDailyRevenuePipeline(
    windowMatch: Record<string, unknown>,
  ): PipelineStage[] {
    return [
      {
        $match: {
          ...windowMatch,
          converted: true,
          isAdminForced: { $ne: true },
          orderId: { $ne: null },
        },
      },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order',
        },
      },
      {
        $unwind: {
          path: '$order',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $project: {
          bucket: {
            $dateToString: {
              date: { $ifNull: ['$orderedAt', '$impressedAt'] },
              format: '%Y-%m-%d',
              timezone: 'UTC',
            },
          },
          productId: 1,
          items: '$order.items',
        },
      },
      {
        $project: {
          bucket: 1,
          matchedItem: {
            $first: {
              $filter: {
                input: '$items',
                as: 'item',
                cond: {
                  $eq: [
                    { $toString: '$$item.productId' },
                    { $toString: '$productId' },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $project: {
          bucket: 1,
          revenueCents: {
            $ifNull: [
              {
                $multiply: ['$matchedItem.unitPrice', '$matchedItem.quantity'],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$bucket',
          revenueCents: { $sum: '$revenueCents' },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id',
          revenueAttributed: { $divide: ['$revenueCents', 100] },
        },
      },
      {
        $sort: {
          bucket: 1,
        },
      },
    ];
  }

  private mapBySourceRows(rows: MetricsBySourceRow[] = []): PromotionMetricsBySourceRow[] {
    return rows.map((entry) => ({
      source: entry.source,
      impressions: Number(entry.impressions ?? 0),
      clicks: Number(entry.clicks ?? 0),
      conversions: Number(entry.conversions ?? 0),
      CTR: this.roundToTwo(entry.CTR),
      conversionRate: this.roundToTwo(entry.conversionRate),
    }));
  }

  private mapTopOfferRows(
    rows: MetricsTopOfferPerformanceRow[] = [],
    totalConversions: number,
  ): PromotionMetricsTopOfferRow[] {
    const safeTotalConversions = Number(totalConversions ?? 0);

    return rows.map((row) => {
      const conversions = Number(row.conversions ?? 0);

      return {
        productId: String(row.productId),
        productName: row.productName ?? null,
        conversions,
        revenueAttributed: this.roundToTwo(row.revenueAttributed),
        contributionRate:
          safeTotalConversions > 0
            ? this.roundToTwo((conversions / safeTotalConversions) * 100)
            : 0,
      };
    });
  }

  async captureTrackingEvent(
    dto: CreateUserEventDto,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    if (dto.entityType !== UserEventEntityType.PRODUCT) {
      return;
    }

    const metadata = (dto.metadata ?? {}) as Record<string, unknown>;
    const isImpression = metadata.promotionImpression === true;
    const isClick = metadata.promotionClick === true;

    if (!isImpression && !isClick) {
      return;
    }

    const productObjectId = this.toObjectId(dto.entityId);
    if (!productObjectId) {
      return;
    }

    const userObjectId = userId ? this.toObjectId(userId) : null;
    const resolvedSessionId = sessionId ?? '';

    if (!resolvedSessionId) {
      return;
    }

    const now = new Date();
    const source = this.normalizeSource(metadata.source);
    const position = this.normalizePosition(metadata.position);
    const isAdminForced = metadata.isAdminForced === true;

    if (isImpression) {
      await this.conversionModel.create({
        userId: userObjectId,
        productId: productObjectId,
        sessionId: resolvedSessionId,
        impressedAt: now,
        clickedAt: null,
        orderId: null,
        orderedAt: null,
        source,
        position,
        isAdminForced,
        converted: false,
      });

      return;
    }

    const attributionWindowStart = new Date(now.getTime() - ATTRIBUTION_WINDOW_MS);
    const clickFilter: Record<string, unknown> = {
      productId: productObjectId,
      sessionId: resolvedSessionId,
      converted: false,
      impressedAt: { $gte: attributionWindowStart },
    };

    if (userObjectId) {
      clickFilter.userId = userObjectId;
    }

    const updated = await this.conversionModel
      .findOneAndUpdate(
        clickFilter,
        {
          $set: {
            clickedAt: now,
            source,
            position,
            isAdminForced,
            ...(userObjectId ? { userId: userObjectId } : {}),
          },
        },
        {
          sort: { clickedAt: -1, impressedAt: -1 },
          new: true,
        },
      )
      .lean()
      .exec();

    if (!updated) {
      await this.conversionModel.create({
        userId: userObjectId,
        productId: productObjectId,
        sessionId: resolvedSessionId,
        impressedAt: now,
        clickedAt: now,
        orderId: null,
        orderedAt: null,
        source,
        position,
        isAdminForced,
        converted: false,
      });
    }
  }

  async attributeOrder(orderId: string, userId: string): Promise<void> {
    const orderObjectId = this.toObjectId(orderId);
    const userObjectId = this.toObjectId(userId);

    if (!orderObjectId || !userObjectId) {
      return;
    }

    const order = await this.orderModel
      .findOne({ _id: orderObjectId, userId: userObjectId })
      .select('items')
      .lean()
      .exec();

    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
      return;
    }

    const attributionWindowStart = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);
    const orderProductIds = Array.from(
      new Set(order.items.map((item) => String(item.productId))),
    )
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);

    if (orderProductIds.length === 0) {
      return;
    }

    const candidates = await this.conversionModel
      .find({
        userId: userObjectId,
        converted: false,
        impressedAt: { $gte: attributionWindowStart },
        productId: { $in: orderProductIds },
      })
      .sort({ clickedAt: -1, impressedAt: -1 })
      .lean()
      .exec();

    if (candidates.length === 0) {
      return;
    }

    const preferredByProduct = new Map<string, string>();

    for (const candidate of candidates) {
      const productKey = String(candidate.productId);
      if (!preferredByProduct.has(productKey)) {
        preferredByProduct.set(productKey, String(candidate._id));
      }
    }

    const matchedConversionIds = Array.from(preferredByProduct.values())
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);

    if (matchedConversionIds.length === 0) {
      return;
    }

    await this.conversionModel
      .updateMany(
        {
          _id: { $in: matchedConversionIds },
        },
        {
          $set: {
            converted: true,
            orderId: orderObjectId,
            orderedAt: new Date(),
          },
        },
      )
      .exec();
  }

  async getMetrics(days = 7): Promise<PromotionMetricsSummary> {
    const safeDays = Number.isFinite(days)
      ? Math.max(1, Math.min(365, Math.floor(days)))
      : 7;
    const currentWindowEndExclusive = this.addUtcDays(
      this.startOfUtcDay(new Date()),
      1,
    );
    const currentWindowStart = this.addUtcDays(
      currentWindowEndExclusive,
      -safeDays,
    );
    const previousWindowStart = this.addUtcDays(currentWindowStart, -safeDays);

    const currentWindowMatch = {
      impressedAt: {
        $gte: currentWindowStart,
        $lt: currentWindowEndExclusive,
      },
    };

    const previousWindowMatch = {
      impressedAt: {
        $gte: previousWindowStart,
        $lt: currentWindowStart,
      },
    };

    const [currentFacet, previousFacet, currentTopOfferRows, previousTopOfferRows, dailyFunnelRows, dailyRevenueRows] = await Promise.all([
      this.conversionModel
        .aggregate<MetricsFacetResult>([
          {
            $match: currentWindowMatch,
          },
          {
            $facet: {
              summary: this.buildSummaryFacetStages(),
              bySource: this.buildBySourceFacetStages(),
              topConvertingProducts: this.buildTopConvertingProductsFacetStages(),
              revenue: this.buildRevenueFacetStages(),
            },
          },
        ])
        .exec()
        .then((rows) => rows[0]),
      this.conversionModel
        .aggregate<MetricsWindowFacetResult>([
          {
            $match: previousWindowMatch,
          },
          {
            $facet: {
              summary: this.buildSummaryFacetStages(),
              bySource: this.buildBySourceFacetStages(),
              revenue: this.buildRevenueFacetStages(),
            },
          },
        ])
        .exec()
        .then((rows) => rows[0]),
      this.conversionModel
        .aggregate<MetricsTopOfferPerformanceRow>(
          this.buildTopOfferPerformancePipeline(currentWindowMatch, 12),
        )
        .exec(),
      this.conversionModel
        .aggregate<MetricsTopOfferPerformanceRow>(
          this.buildTopOfferPerformancePipeline(previousWindowMatch, 12),
        )
        .exec(),
      this.conversionModel
        .aggregate<MetricsDailyFunnelRow>(
          this.buildDailyFunnelPipeline(currentWindowMatch),
        )
        .exec(),
      this.conversionModel
        .aggregate<MetricsDailyRevenueRow>(
          this.buildDailyRevenuePipeline(currentWindowMatch),
        )
        .exec(),
    ]);

    const summary: MetricsSummaryRow = currentFacet?.summary?.[0] ?? {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      CTR: 0,
      conversionRate: 0,
      adminForcedImpressions: 0,
      adminForcedClicks: 0,
      adminForcedConversions: 0,
    };

    const previousSummary: MetricsSummaryRow = previousFacet?.summary?.[0] ?? {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      CTR: 0,
      conversionRate: 0,
      adminForcedImpressions: 0,
      adminForcedClicks: 0,
      adminForcedConversions: 0,
    };

    const revenueAttributed = this.roundToTwo(
      currentFacet?.revenue?.[0]?.revenueAttributed ?? 0,
    );

    const previousRevenueAttributed = this.roundToTwo(
      previousFacet?.revenue?.[0]?.revenueAttributed ?? 0,
    );

    const currentBySource = this.mapBySourceRows(currentFacet?.bySource ?? []);
    const previousBySource = this.mapBySourceRows(previousFacet?.bySource ?? []);

    const currentTopOfferPerformance = this.mapTopOfferRows(
      currentTopOfferRows,
      Number(summary.conversions ?? 0),
    );
    const previousTopOfferPerformance = this.mapTopOfferRows(
      previousTopOfferRows,
      Number(previousSummary.conversions ?? 0),
    );

    const topOfferRevenueByProductId = new Map(
      currentTopOfferPerformance.map((row) => [row.productId, row.revenueAttributed]),
    );

    const dailyFunnelByBucket = new Map(
      dailyFunnelRows.map((entry) => [entry.bucket, entry]),
    );
    const dailyRevenueByBucket = new Map(
      dailyRevenueRows.map((entry) => [entry.bucket, this.roundToTwo(entry.revenueAttributed)]),
    );

    const timeline: PromotionMetricsTimelinePoint[] = [];

    for (let offset = 0; offset < safeDays; offset += 1) {
      const day = this.addUtcDays(currentWindowStart, offset);
      const bucket = this.toUtcDayKey(day);
      const funnel = dailyFunnelByBucket.get(bucket);

      const impressions = Number(funnel?.impressions ?? 0);
      const clicks = Number(funnel?.clicks ?? 0);
      const conversions = Number(funnel?.conversions ?? 0);
      const adminForcedImpressions = Number(funnel?.adminForcedImpressions ?? 0);
      const adminForcedClicks = Number(funnel?.adminForcedClicks ?? 0);
      const adminForcedConversions = Number(funnel?.adminForcedConversions ?? 0);
      const dayRevenue = Number(dailyRevenueByBucket.get(bucket) ?? 0);

      timeline.push({
        bucket,
        label: this.toTimelineLabel(bucket),
        impressions,
        clicks,
        conversions,
        adminForcedImpressions,
        adminForcedClicks,
        adminForcedConversions,
        CTR: this.roundToTwo(
          impressions > 0 ? (clicks / impressions) * 100 : 0,
        ),
        conversionRate: this.roundToTwo(
          clicks > 0 ? (conversions / clicks) * 100 : 0,
        ),
        revenueAttributed: this.roundToTwo(dayRevenue),
        revenuePerClick: this.roundToTwo(
          clicks > 0 ? dayRevenue / clicks : 0,
        ),
      });
    }

    const topConvertingProducts = (currentFacet?.topConvertingProducts ?? []).map((entry) => {
      const productId = String(entry.productId);

      return {
        productId,
        productName: entry.productName ?? null,
        conversions: Number(entry.conversions ?? 0),
        revenueAttributed: this.roundToTwo(
          topOfferRevenueByProductId.get(productId) ?? 0,
        ),
      };
    });

    return {
      impressions: Number(summary.impressions ?? 0),
      clicks: Number(summary.clicks ?? 0),
      conversions: Number(summary.conversions ?? 0),
      CTR: this.roundToTwo(summary.CTR),
      conversionRate: this.roundToTwo(summary.conversionRate),
      revenueAttributed,
      adminForced: {
        impressions: Number(summary.adminForcedImpressions ?? 0),
        clicks: Number(summary.adminForcedClicks ?? 0),
        conversions: Number(summary.adminForcedConversions ?? 0),
      },
      bySource: currentBySource,
      topConvertingProducts,
      topOfferPerformance: currentTopOfferPerformance,
      previousPeriod: {
        impressions: Number(previousSummary.impressions ?? 0),
        clicks: Number(previousSummary.clicks ?? 0),
        conversions: Number(previousSummary.conversions ?? 0),
        CTR: this.roundToTwo(previousSummary.CTR),
        conversionRate: this.roundToTwo(previousSummary.conversionRate),
        revenueAttributed: previousRevenueAttributed,
        adminForced: {
          impressions: Number(previousSummary.adminForcedImpressions ?? 0),
          clicks: Number(previousSummary.adminForcedClicks ?? 0),
          conversions: Number(previousSummary.adminForcedConversions ?? 0),
        },
        bySource: previousBySource,
        topOfferPerformance: previousTopOfferPerformance,
      },
      timeline,
      period: {
        days: safeDays,
        currentStart: currentWindowStart.toISOString(),
        currentEndExclusive: currentWindowEndExclusive.toISOString(),
        previousStart: previousWindowStart.toISOString(),
        previousEndExclusive: currentWindowStart.toISOString(),
      },
    };
  }

  logAttributionError(orderId: string, userId: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : 'Unknown attribution error';
    this.logger.error(
      `Failed promotion attribution for order ${orderId} and user ${userId}: ${reason}`,
    );
  }
}
