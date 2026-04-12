import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category, CategoryDocument } from './schemas/category.schema';

const SOLD_CATEGORY_STATUSES = ['DELIVERED', 'SETTLED'];

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async toResponse(
    category: CategoryDocument | Record<string, unknown>,
  ) {
    const plain =
      typeof (category as CategoryDocument).toJSON === 'function'
        ? ((category as CategoryDocument).toJSON() as Record<string, unknown>)
        : category;
    const productCount = await this.productModel.countDocuments({
      categoryId: plain.id,
    });

    return {
      ...plain,
      productCount,
    };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Paginated category list with optional search and product count. */
  async findAll(query: CategoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter = query.search
      ? { name: { $regex: this.escapeRegex(query.search), $options: 'i' } }
      : {};

    const [total, rows] = await Promise.all([
      this.categoryModel.countDocuments(filter),
      this.categoryModel
        .find(filter)
        .sort({ name: 1 })
        .skip(offset)
        .limit(limit),
    ]);

    const data = await Promise.all(rows.map((row) => this.toResponse(row)));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Get all categories (lightweight, for dropdowns). */
  async findAllSimple() {
    const rows = await this.categoryModel
      .find()
      .select('name slug')
      .sort({ name: 1 });
    return rows.map((row) => row.toJSON());
  }

  async findById(id: string) {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.toResponse(category);
  }

  async findDetails(id: string, days = 30) {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 30;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (safeDays - 1));

    const products = await this.productModel
      .find({ categoryId: id })
      .select('_id name price inventory inventoryInfo.quantity')
      .lean();

    const productIdValues = products
      .map((product) => product._id)
      .filter((value): value is Types.ObjectId => !!value)
      .map((value) => new Types.ObjectId(String(value)));

    const quantityOf = (product: Record<string, any>) =>
      Number(product.inventoryInfo?.quantity ?? product.inventory ?? 0);

    const totalStockValue = Number(
      products
        .reduce((sum, product) => {
          return sum + quantityOf(product) * Number(product.price ?? 0);
        }, 0)
        .toFixed(2),
    );

    const lowestStockRaw =
      products.length > 0
        ? [...products].sort((a, b) => quantityOf(a) - quantityOf(b))[0]
        : null;

    const zeroTrend = {
      labels: Array.from({ length: safeDays }).map((_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
      }),
      ordersPerDay: Array.from({ length: safeDays }).map(() => 0),
      revenuePerDay: Array.from({ length: safeDays }).map(() => 0),
      marginPercentPerDay: Array.from({ length: safeDays }).map(() => 0),
    };

    if (productIdValues.length === 0) {
      return {
        category: await this.toResponse(category),
        summary: {
          totalProducts: 0,
          totalOrders: 0,
          totalRevenue: 0,
          averageMarginPercent: 0,
          totalStockValue,
        },
        trend: zeroTrend,
        topSellingProduct: null,
        lowestStockProduct: null,
      };
    }

    const basePipeline = [
      {
        $match: {
          createdAt: { $gte: start },
          status: { $in: SOLD_CATEGORY_STATUSES },
        },
      },
      { $unwind: '$items' },
      {
        $match: {
          'items.productId': { $in: productIdValues },
        },
      },
      {
        $project: {
          createdAt: 1,
          orderId: '$_id',
          productId: '$items.productId',
          quantity: { $ifNull: ['$items.quantity', 0] },
          lineGrossCents: {
            $multiply: [
              { $ifNull: ['$items.quantity', 0] },
              { $ifNull: ['$items.unitPrice', 0] },
            ],
          },
          lineCostCents: {
            $multiply: [
              { $ifNull: ['$items.quantity', 0] },
              { $ifNull: ['$items.unitCost', 0] },
            ],
          },
        },
      },
    ];

    const [summaryRows, trendRows, topSellingRows] = await Promise.all([
      this.orderModel.aggregate<{
        totalOrders: number;
        grossSalesCents: number;
        totalCostCents: number;
      }>([
        ...basePipeline,
        {
          $group: {
            _id: null,
            orderIds: { $addToSet: '$orderId' },
            grossSalesCents: { $sum: '$lineGrossCents' },
            totalCostCents: { $sum: '$lineCostCents' },
          },
        },
        {
          $project: {
            _id: 0,
            totalOrders: { $size: '$orderIds' },
            grossSalesCents: 1,
            totalCostCents: 1,
          },
        },
      ]),
      this.orderModel.aggregate<{
        date: string;
        orders: number;
        revenueCents: number;
        grossSalesCents: number;
      }>([
        ...basePipeline,
        {
          $group: {
            _id: {
              date: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                },
              },
              orderId: '$orderId',
            },
            revenueCents: {
              $sum: { $subtract: ['$lineGrossCents', '$lineCostCents'] },
            },
            grossSalesCents: { $sum: '$lineGrossCents' },
          },
        },
        {
          $group: {
            _id: '$_id.date',
            orders: { $sum: 1 },
            revenueCents: { $sum: '$revenueCents' },
            grossSalesCents: { $sum: '$grossSalesCents' },
          },
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            orders: 1,
            revenueCents: 1,
            grossSalesCents: 1,
          },
        },
        { $sort: { date: 1 } },
      ]),
      this.orderModel.aggregate<{
        productId: Types.ObjectId;
        unitsSold: number;
        revenueCents: number;
      }>([
        ...basePipeline,
        {
          $group: {
            _id: '$productId',
            unitsSold: { $sum: '$quantity' },
            revenueCents: {
              $sum: { $subtract: ['$lineGrossCents', '$lineCostCents'] },
            },
          },
        },
        { $sort: { unitsSold: -1, revenueCents: -1 } },
        { $limit: 1 },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            unitsSold: 1,
            revenueCents: 1,
          },
        },
      ]),
    ]);

    const summary = summaryRows[0] ?? {
      totalOrders: 0,
      grossSalesCents: 0,
      totalCostCents: 0,
    };

    const byDate = new Map(trendRows.map((row) => [row.date, row]));
    const labels: string[] = [];
    const ordersPerDay: number[] = [];
    const revenuePerDay: number[] = [];
    const marginPercentPerDay: number[] = [];

    for (let i = 0; i < safeDays; i += 1) {
      const dateObj = new Date(start);
      dateObj.setDate(start.getDate() + i);
      const dateKey = dateObj.toISOString().slice(0, 10);
      const row = byDate.get(dateKey);

      const gross = Number(((row?.grossSalesCents ?? 0) / 100).toFixed(2));
      const net = Number(((row?.revenueCents ?? 0) / 100).toFixed(2));

      labels.push(
        dateObj.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
      );
      ordersPerDay.push(row?.orders ?? 0);
      revenuePerDay.push(net);
      marginPercentPerDay.push(gross > 0 ? Number(((net / gross) * 100).toFixed(1)) : 0);
    }

    const totalRevenue = Number(
      ((summary.grossSalesCents - summary.totalCostCents) / 100).toFixed(2),
    );
    const averageMarginPercent =
      summary.grossSalesCents > 0
        ? Number(
            (((summary.grossSalesCents - summary.totalCostCents) / summary.grossSalesCents) * 100).toFixed(1),
          )
        : 0;

    const productById = new Map(products.map((product) => [String(product._id), product]));
    const topSellingRaw = topSellingRows[0];

    return {
      category: await this.toResponse(category),
      summary: {
        totalProducts: products.length,
        totalOrders: summary.totalOrders,
        totalRevenue,
        averageMarginPercent,
        totalStockValue,
      },
      trend: {
        labels,
        ordersPerDay,
        revenuePerDay,
        marginPercentPerDay,
      },
      topSellingProduct: topSellingRaw
        ? {
            id: String(topSellingRaw.productId),
            name:
              (productById.get(String(topSellingRaw.productId)) as Record<string, any> | undefined)?.name ??
              'Unknown product',
            unitsSold: topSellingRaw.unitsSold,
            revenue: Number((topSellingRaw.revenueCents / 100).toFixed(2)),
          }
        : null,
      lowestStockProduct: lowestStockRaw
        ? {
            id: String(lowestStockRaw._id),
            name: lowestStockRaw.name,
            stock: quantityOf(lowestStockRaw),
          }
        : null,
    };
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.slug ?? this.slugify(dto.name);

    try {
      const created = await this.categoryModel.create({
        name: dto.name,
        slug,
        description: dto.description ?? null,
      });
      return this.findById(created.id);
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException(
          'Category with this name or slug already exists',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateCategoryDto) {
    // Ensure it exists
    await this.findById(id);

    const values: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      values.name = dto.name;
      // Auto-update slug if name changes and no explicit slug provided
      if (dto.slug === undefined) values.slug = this.slugify(dto.name);
    }
    if (dto.slug !== undefined) values.slug = dto.slug;
    if (dto.description !== undefined) values.description = dto.description;

    if (Object.keys(values).length === 0) {
      return this.findById(id);
    }

    try {
      await this.categoryModel.findByIdAndUpdate(
        id,
        { $set: values },
        { new: true },
      );
      return this.findById(id);
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException(
          'Category with this name or slug already exists',
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.findById(id);

    // Check for products using this category
    const product = await this.productModel.findOne({ categoryId: id });
    if (product) {
      throw new ConflictException(
        'Cannot delete category with existing products. Remove or reassign products first.',
      );
    }

    await this.categoryModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
