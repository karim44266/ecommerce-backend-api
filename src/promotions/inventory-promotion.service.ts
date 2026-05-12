import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { BoundedCache } from './utils/bounded-cache';

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;
const COMPLETED_ORDER_STATUSES = ['DELIVERED', 'SETTLED'];

export enum InventoryState {
  CRITICAL = 'CRITICAL',
  LOW = 'LOW',
  HEALTHY = 'HEALTHY',
  OVERSTOCK = 'OVERSTOCK',
}

interface ProductStateCacheValue {
  productId: string;
  stockLevel: number;
  threshold: number;
  avgMonthlySales: number;
  inventoryState: InventoryState;
  refreshedAt: Date;
}

interface ProductSalesRow {
  productId: Types.ObjectId;
  monthlySales: number;
}

export function classifyInventoryState(
  stockLevel: number,
  threshold: number,
  avgMonthlySales: number,
): InventoryState {
  const normalizedStock = Number.isFinite(stockLevel) ? stockLevel : 0;
  const normalizedThreshold = Number.isFinite(threshold)
    ? Math.max(0, threshold)
    : 0;
  const normalizedMonthlySales = Number.isFinite(avgMonthlySales)
    ? Math.max(0, avgMonthlySales)
    : 0;

  if (normalizedStock <= normalizedThreshold * 0.5) {
    return InventoryState.CRITICAL;
  }

  if (normalizedStock <= normalizedThreshold) {
    return InventoryState.LOW;
  }

  if (normalizedStock <= normalizedMonthlySales * 2) {
    return InventoryState.HEALTHY;
  }

  return InventoryState.OVERSTOCK;
}

@Injectable()
export class InventoryPromotionService {
  private readonly logger = new Logger(InventoryPromotionService.name);

  private readonly stateCache = new BoundedCache<string, ProductStateCacheValue>({
    maxSize: 50_000,
    ttlMs: THIRTY_MINUTES_IN_MS,
  });

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  private async getMonthlySalesByProduct(): Promise<Map<string, number>> {
    const since = new Date(Date.now() - THIRTY_DAYS_IN_MS);

    const rows = await this.orderModel
      .aggregate<ProductSalesRow>([
        {
          $match: {
            status: { $in: COMPLETED_ORDER_STATUSES },
            createdAt: { $gte: since },
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            monthlySales: { $sum: '$items.quantity' },
          },
        },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            monthlySales: 1,
          },
        },
      ])
      .exec();

    const result = new Map<string, number>();
    rows.forEach((row) => {
      result.set(String(row.productId), row.monthlySales);
    });

    return result;
  }

  private buildCacheValue(
    productId: string,
    stockLevel: number,
    threshold: number,
    avgMonthlySales: number,
  ): ProductStateCacheValue {
    return {
      productId,
      stockLevel,
      threshold,
      avgMonthlySales,
      inventoryState: classifyInventoryState(
        stockLevel,
        threshold,
        avgMonthlySales,
      ),
      refreshedAt: new Date(),
    };
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async refreshCache(): Promise<{ refreshedAt: Date; cacheSize: number }> {
    const refreshedAt = new Date();

    const [products, salesByProduct] = await Promise.all([
      this.productModel
        .find({ status: { $in: ['active', 'ACTIVE'] } })
        .select('_id inventory inventoryInfo.quantity inventoryInfo.lowStockThreshold')
        .lean()
        .exec(),
      this.getMonthlySalesByProduct(),
    ]);

    this.stateCache.clear();

    products.forEach((product) => {
      const productId = String(product._id);
      const stockLevel = Number(
        product.inventoryInfo?.quantity ?? product.inventory ?? 0,
      );
      const threshold = Number(product.inventoryInfo?.lowStockThreshold ?? 10);
      const avgMonthlySales = Number(salesByProduct.get(productId) ?? 0);

      this.stateCache.set(
        productId,
        this.buildCacheValue(productId, stockLevel, threshold, avgMonthlySales),
      );
    });

    this.logger.log(
      `Inventory promotion cache refreshed (${this.stateCache.size} entries).`,
    );

    return { refreshedAt, cacheSize: this.stateCache.size };
  }

  async getInventoryStateForProduct(
    productId: string,
    stockLevel?: number,
    threshold?: number,
  ): Promise<InventoryState> {
    const cached = this.stateCache.get(productId);
    if (cached && stockLevel === undefined && threshold === undefined) {
      return cached.inventoryState;
    }

    if (cached && stockLevel !== undefined && threshold !== undefined) {
      return classifyInventoryState(stockLevel, threshold, cached.avgMonthlySales);
    }

    const product = await this.productModel
      .findById(productId)
      .select('_id inventory inventoryInfo.quantity inventoryInfo.lowStockThreshold')
      .lean()
      .exec();

    if (!product) {
      return InventoryState.CRITICAL;
    }

    const resolvedStockLevel = Number(
      stockLevel ?? product.inventoryInfo?.quantity ?? product.inventory ?? 0,
    );
    const resolvedThreshold = Number(
      threshold ?? product.inventoryInfo?.lowStockThreshold ?? 10,
    );

    const productObjectId = Types.ObjectId.isValid(productId)
      ? new Types.ObjectId(productId)
      : null;

    if (!productObjectId) {
      return InventoryState.CRITICAL;
    }

    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_IN_MS);
    const [salesRow] = await this.orderModel
      .aggregate<{ monthlySales: number }>([
        {
          $match: {
            status: { $in: COMPLETED_ORDER_STATUSES },
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        { $unwind: '$items' },
        {
          $match: {
            'items.productId': productObjectId,
          },
        },
        {
          $group: {
            _id: null,
            monthlySales: { $sum: '$items.quantity' },
          },
        },
        {
          $project: {
            _id: 0,
            monthlySales: 1,
          },
        },
      ])
      .exec();

    const avgMonthlySales = Number(salesRow?.monthlySales ?? 0);
    const stateValue = this.buildCacheValue(
      productId,
      resolvedStockLevel,
      resolvedThreshold,
      avgMonthlySales,
    );
    this.stateCache.set(productId, stateValue);

    return stateValue.inventoryState;
  }
}
