import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product, ProductDocument } from './schemas/product.schema';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    private readonly inventoryService: InventoryService,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Map a raw DB row + category name to the API response shape. */
  private toResponse(
    product: ProductDocument | Record<string, unknown>,
    options?: { isReseller?: boolean; personalCatalog?: string[] },
  ) {
    const plain = typeof (product as ProductDocument).toJSON === 'function'
      ? ((product as ProductDocument).toJSON() as Record<string, unknown> & { categoryId?: unknown })
      : (product as Record<string, unknown> & { categoryId?: unknown });
    const category =
      plain.categoryId && typeof plain.categoryId === 'object' && 'name' in (plain.categoryId as object)
        ? (plain.categoryId as Record<string, unknown>)
        : null;

    const price = Number(plain.price);
    const productIdStr = String(plain.id || plain._id);

    const baseResponse = {
      id: productIdStr,
      name: plain.name,
      sku: plain.sku,
      description: plain.description,
      price: Number(plain.price),
      image: plain.image,
      inventory: plain.inventory,
      stock: plain.inventory,
      status: plain.status,
      category: category?.name ?? null,
      categoryId: category?.id ?? (plain.categoryId ? String(plain.categoryId) : null),
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };

    if (options?.isReseller) {
      Object.assign(baseResponse, {
        resellerPrice: price * 0.8,
        inPersonalCatalog: options.personalCatalog?.includes(productIdStr) ?? false,
      });
    }

    return baseResponse;
  }

  /** Build WHERE conditions from query parameters. */
  private async buildFilter(query: ProductQueryDto, allowedIds?: string[]): Promise<FilterQuery<ProductDocument>> {
    const conditions: FilterQuery<ProductDocument>[] = [];

    if (allowedIds) {
      conditions.push({ _id: { $in: allowedIds } } as FilterQuery<ProductDocument>);
    }

    if (query.search) {
      conditions.push({ name: { $regex: this.escapeRegex(query.search), $options: 'i' } });
    }

    if (query.status) {
      conditions.push({ status: query.status });
    }

    if (query.categoryId) {
      conditions.push({ categoryId: query.categoryId });
    } else if (query.category) {
      const cat = await this.categoryModel.findOne({
        name: { $regex: `^${this.escapeRegex(query.category)}$`, $options: 'i' },
      });
      if (cat) {
        conditions.push({ categoryId: cat.id });
      } else {
        conditions.push({ _id: { $exists: false } } as FilterQuery<ProductDocument>);
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

  async findAll(
    query: ProductQueryDto,
    options?: { allowedProductIds?: string[]; personalCatalog?: string[]; isReseller?: boolean },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter = await this.buildFilter(query, options?.allowedProductIds);

    const sortColumnMap: Record<string, string> = {
      name: 'name',
      price: 'price',
      inventory: 'inventory',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      status: 'status',
    };
    const sortCol = sortColumnMap[query.sortBy ?? 'createdAt'] ?? 'createdAt';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;

    const [total, rows] = await Promise.all([
      this.productModel.countDocuments(filter),
      this.productModel
        .find(filter)
        .populate('categoryId', 'name')
        .sort({ [sortCol]: sortDir })
        .skip(offset)
        .limit(limit),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row, options)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, options?: { isReseller?: boolean; personalCatalog?: string[] }) {
    const product = await this.productModel.findById(id).populate('categoryId', 'name');

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.toResponse(product, options);
  }

  async create(dto: CreateProductDto) {
    try {
      const created = await this.productModel.create({
          name: dto.name,
          sku: dto.sku,
          description: dto.description ?? '',
          price: dto.price,
          image: dto.image ?? '',
          inventory: dto.inventory ?? 0,
          status: dto.status ?? 'active',
          categoryId: dto.categoryId ?? null,
          inventoryInfo: {
            quantity: dto.inventory ?? 0,
            lowStockThreshold: 10,
            lastAdjustedAt: null,
          },
        });

      await this.inventoryService.ensureInventory(
        created.id,
        dto.inventory ?? 0,
      );

      return this.findById(created.id);
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException('Product with this SKU already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findById(id);

    const values: Record<string, unknown> = {};
    if (dto.name !== undefined) values.name = dto.name;
    if (dto.sku !== undefined) values.sku = dto.sku;
    if (dto.description !== undefined) values.description = dto.description;
    if (dto.price !== undefined) values.price = dto.price;
    if (dto.image !== undefined) values.image = dto.image;
    if (dto.inventory !== undefined) {
      values.inventory = dto.inventory;
      values['inventoryInfo.quantity'] = dto.inventory;
    }
    if (dto.status !== undefined) values.status = dto.status;
    if (dto.categoryId !== undefined) values.categoryId = dto.categoryId;

    try {
      await this.productModel.findByIdAndUpdate(id, { $set: values }, { new: true });
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException('Product with this SKU already exists');
      }
      throw error;
    }

    return this.findById(id);
  }

  async remove(id: string) {
    await this.findById(id);
    await this.productModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
