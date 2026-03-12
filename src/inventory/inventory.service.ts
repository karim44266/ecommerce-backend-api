import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model } from 'mongoose';
import {
  InventoryQueryDto,
  InventorySortBy,
  SortOrder,
  StockFilter,
} from './dto/inventory-query.dto';
import { HistoryQueryDto } from './dto/inventory-query.dto';
import { InventoryAdjustment, InventoryAdjustmentDocument } from './schemas/inventory-adjustment.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(InventoryAdjustment.name)
    private readonly adjustmentModel: Model<InventoryAdjustmentDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toResponse(product: ProductDocument | Record<string, unknown>, overrides?: { isLowStock?: boolean }) {
    const plain = typeof (product as ProductDocument).toJSON === 'function'
      ? ((product as ProductDocument).toJSON() as Record<string, any>)
      : (product as Record<string, any>);
    const inventoryInfo = plain.inventoryInfo ?? {};

    return {
      id: plain.id,
      productId: plain.id,
      productName: plain.name,
      productSku: plain.sku,
      productStatus: plain.status,
      quantity: inventoryInfo.quantity ?? plain.inventory ?? 0,
      lowStockThreshold: inventoryInfo.lowStockThreshold ?? 10,
      isLowStock:
        overrides?.isLowStock ??
        (inventoryInfo.quantity ?? plain.inventory ?? 0) <= (inventoryInfo.lowStockThreshold ?? 10),
      lastAdjustedAt: inventoryInfo.lastAdjustedAt ?? null,
      createdAt: plain.createdAt,
    };
  }

  private buildStatusFilter(status: StockFilter): FilterQuery<ProductDocument> | undefined {
    switch (status) {
      case StockFilter.OUT:
        return { 'inventoryInfo.quantity': { $lte: 0 } };
      case StockFilter.LOW:
        return {
          $expr: {
            $and: [
              { $gte: ['$inventoryInfo.quantity', 1] },
              { $lte: ['$inventoryInfo.quantity', '$inventoryInfo.lowStockThreshold'] },
            ],
          },
        };
      case StockFilter.IN_STOCK:
        return {
          $expr: {
            $gt: ['$inventoryInfo.quantity', '$inventoryInfo.lowStockThreshold'],
          },
        };
      default:
        return undefined;
    }
  }

  private buildFilter(query: InventoryQueryDto = {}): FilterQuery<ProductDocument> {
    const conditions: FilterQuery<ProductDocument>[] = [];

    if (query.search) {
      const escaped = this.escapeRegex(query.search);
      conditions.push({
        $or: [
          { name: { $regex: escaped, $options: 'i' } },
          { sku: { $regex: escaped, $options: 'i' } },
        ],
      });
    }

    if (query.status && query.status !== StockFilter.ALL) {
      const condition = this.buildStatusFilter(query.status);
      if (condition) {
        conditions.push(condition);
      }
    }

    if (conditions.length === 0) {
      return {};
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return { $and: conditions };
  }

  async ensureInventory(productId: string, initialQuantity = 0) {
    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const hasInventoryInfo = !!product.inventoryInfo;
    if (hasInventoryInfo && product.inventory !== undefined && product.inventory !== null) {
      return product;
    }

    return this.productModel.findByIdAndUpdate(
      productId,
      {
        $set: {
          inventory: product.inventory ?? initialQuantity,
          inventoryInfo: {
            quantity: product.inventoryInfo?.quantity ?? product.inventory ?? initialQuantity,
            lowStockThreshold: product.inventoryInfo?.lowStockThreshold ?? 10,
            lastAdjustedAt: product.inventoryInfo?.lastAdjustedAt ?? null,
          },
        },
      },
      { new: true },
    );
  }

  async getSummary() {
    const [result] = await this.productModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          low: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$inventoryInfo.quantity', 0] },
                    { $lte: ['$inventoryInfo.quantity', '$inventoryInfo.lowStockThreshold'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          out: {
            $sum: {
              $cond: [{ $lte: ['$inventoryInfo.quantity', 0] }, 1, 0],
            },
          },
          inStock: {
            $sum: {
              $cond: [{ $gt: ['$inventoryInfo.quantity', '$inventoryInfo.lowStockThreshold'] }, 1, 0],
            },
          },
        },
      },
    ]);

    return result ?? { total: 0, low: 0, out: 0, inStock: 0 };
  }

  async findAll(query: InventoryQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const filter = this.buildFilter(query);
    const sortDir = query.order === SortOrder.DESC ? -1 : 1;
    const sortFieldMap: Record<string, string> = {
      [InventorySortBy.QUANTITY]: 'inventoryInfo.quantity',
      [InventorySortBy.THRESHOLD]: 'inventoryInfo.lowStockThreshold',
      [InventorySortBy.LAST_ADJUSTED]: 'inventoryInfo.lastAdjustedAt',
      [InventorySortBy.NAME]: 'name',
    };
    const sortField = sortFieldMap[query.sortBy ?? InventorySortBy.NAME] ?? 'name';

    const [count, rows] = await Promise.all([
      this.productModel.countDocuments(filter),
      this.productModel.find(filter).sort({ [sortField]: sortDir }).skip(offset).limit(limit),
    ]);

    return {
      data: rows.map((r) => this.toResponse(r)),
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async findByProductId(productId: string) {
    const product = await this.productModel.findById(productId);

    if (!product) {
      throw new NotFoundException('Inventory record not found for this product');
    }

    return this.toResponse(product);
  }

  async findLowStock(query: InventoryQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter: FilterQuery<ProductDocument> = {
      $expr: {
        $lte: ['$inventoryInfo.quantity', '$inventoryInfo.lowStockThreshold'],
      },
    };

    const [count, rows] = await Promise.all([
      this.productModel.countDocuments(filter),
      this.productModel.find(filter).sort({ 'inventoryInfo.quantity': 1 }).skip(offset).limit(limit),
    ]);

    return {
      data: rows.map((r) => this.toResponse(r, { isLowStock: true })),
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async adjust(
    productId: string,
    adjustment: number,
    reason?: string,
    adjustedBy?: string,
  ) {
    const existing = await this.productModel.findById(productId);
    if (!existing) {
      throw new NotFoundException('Inventory record not found for this product');
    }

    const session = await this.connection.startSession();

    try {
      let response: Record<string, unknown> | null = null;

      await session.withTransaction(async () => {
        const filter: FilterQuery<ProductDocument> =
          adjustment < 0
            ? { _id: productId, 'inventoryInfo.quantity': { $gte: Math.abs(adjustment) } }
            : { _id: productId };

        const updated = await this.productModel.findOneAndUpdate(
          filter,
          {
            $inc: {
              'inventoryInfo.quantity': adjustment,
              inventory: adjustment,
            },
            $set: {
              'inventoryInfo.lastAdjustedAt': new Date(),
            },
          },
          { new: true, session },
        );

        if (!updated) {
          throw new BadRequestException('Insufficient stock or product not found');
        }

        const [historyEntry] = await this.adjustmentModel.create(
          [
            {
              productId,
              adjustment,
              reason: reason ?? null,
              adjustedBy: adjustedBy ?? null,
            },
          ],
          { session },
        );

        const populatedHistory = await this.adjustmentModel
          .findById(historyEntry.id)
          .populate('adjustedBy', 'email')
          .session(session);

        response = {
          ...this.toResponse(updated),
          adjustedBy:
            populatedHistory && populatedHistory.adjustedBy && typeof populatedHistory.adjustedBy === 'object'
              ? (populatedHistory.adjustedBy as { email?: string }).email ?? null
              : null,
          adjustmentApplied: adjustment,
        };
      });

      return response;
    } finally {
      await session.endSession();
    }
  }

  async updateThreshold(productId: string, newThreshold: number) {
    const updated = await this.productModel.findByIdAndUpdate(
      productId,
      { $set: { 'inventoryInfo.lowStockThreshold': newThreshold } },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Inventory record not found for this product');
    }

    return this.findByProductId(productId);
  }

  async getAdjustmentHistory(productId: string, query: HistoryQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Inventory record not found for this product');
    }

    const [count, rows] = await Promise.all([
      this.adjustmentModel.countDocuments({ productId }),
      this.adjustmentModel
        .find({ productId })
        .populate('adjustedBy', 'email')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
    ]);

    return {
      data: rows.map((r) => {
        const plain = r.toJSON() as Record<string, any>;
        return {
          id: plain.id,
          adjustment: plain.adjustment,
          reason: plain.reason,
          adjustedBy:
            plain.adjustedBy && typeof plain.adjustedBy === 'object'
              ? plain.adjustedBy.email ?? null
              : null,
          createdAt: plain.createdAt,
        };
      }),
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async backfill() {
    const products = await this.productModel.find();
    let created = 0;

    for (const product of products) {
      if (!product.inventoryInfo) {
        created += 1;
        await this.productModel.findByIdAndUpdate(product.id, {
          $set: {
            inventoryInfo: {
              quantity: product.inventory ?? 0,
              lowStockThreshold: 10,
              lastAdjustedAt: null,
            },
          },
        });
      }
    }

    if (created === 0) {
      return { created: 0, message: 'All products already have inventory records' };
    }

    return {
      created,
      message: `Created inventory records for ${created} product(s)`,
    };
  }
}
