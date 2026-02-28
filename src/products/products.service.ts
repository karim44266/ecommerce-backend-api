import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, lte, sql, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';

/** Escape special LIKE characters so user input is treated literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly inventoryService: InventoryService,
  ) {}

  /** Map a raw DB row + category name to the API response shape. */
  private toResponse(
    row: typeof schema.products.$inferSelect,
    categoryName?: string | null,
  ) {
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      description: row.description,
      price: Number(row.price),
      image: row.image,
      inventory: row.inventory,
      stock: row.inventory, // alias for storefront compatibility
      status: row.status,
      category: categoryName ?? null,
      categoryId: row.categoryId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Build WHERE conditions from query parameters. */
  private async buildConditions(query: ProductQueryDto): Promise<SQL[]> {
    const conditions: SQL[] = [];

    if (query.search) {
      conditions.push(ilike(schema.products.name, `%${escapeLike(query.search)}%`));
    }

    // Category filter by ID (preferred)
    if (query.categoryId) {
      conditions.push(eq(schema.products.categoryId, query.categoryId));
    } else if (query.category) {
      // Legacy: filter by category name
      const cat = await this.db.query.categories.findFirst({
        where: ilike(schema.categories.name, query.category),
      });
      if (cat) {
        conditions.push(eq(schema.products.categoryId, cat.id));
      } else {
        // No matching category → force empty result
        conditions.push(sql`false`);
      }
    }

    // Status filter
    if (query.status) {
      conditions.push(eq(schema.products.status, query.status));
    }

    // Price range
    if (query.minPrice !== undefined) {
      conditions.push(gte(schema.products.price, query.minPrice.toFixed(2)));
    }
    if (query.maxPrice !== undefined) {
      conditions.push(lte(schema.products.price, query.maxPrice.toFixed(2)));
    }

    return conditions;
  }

  /** Build ORDER BY from query. */
  private buildOrderBy(query: ProductQueryDto) {
    const dir = query.sortOrder === 'desc' ? desc : asc;
    switch (query.sortBy) {
      case 'name':
        return dir(schema.products.name);
      case 'price':
        return dir(schema.products.price);
      case 'updatedAt':
        return dir(schema.products.updatedAt);
      case 'createdAt':
      default:
        return dir(schema.products.createdAt);
    }
  }

  async findAll(query: ProductQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = await this.buildConditions(query);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count
    const [{ count: total }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(whereClause);

    const rows = await this.db
      .select({
        product: schema.products,
        categoryName: schema.categories.name,
      })
      .from(schema.products)
      .leftJoin(
        schema.categories,
        eq(schema.products.categoryId, schema.categories.id),
      )
      .where(whereClause)
      .orderBy(this.buildOrderBy(query))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.toResponse(r.product, r.categoryName)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const rows = await this.db
      .select({
        product: schema.products,
        categoryName: schema.categories.name,
      })
      .from(schema.products)
      .leftJoin(
        schema.categories,
        eq(schema.products.categoryId, schema.categories.id),
      )
      .where(eq(schema.products.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Product not found');
    }

    return this.toResponse(rows[0].product, rows[0].categoryName);
  }

  async create(dto: CreateProductDto) {
    try {
      const [created] = await this.db
        .insert(schema.products)
        .values({
          name: dto.name,
          sku: dto.sku,
          description: dto.description ?? '',
          price: dto.price.toFixed(2),
          image: dto.image ?? '',
          inventory: dto.inventory ?? 0,
          status: dto.status ?? 'active',
          categoryId: dto.categoryId ?? null,
        })
        .returning();

      // Auto-create inventory record for the new product
      await this.inventoryService.ensureInventory(
        created.id,
        dto.inventory ?? 0,
      );

      // Fetch with category name
      return this.findById(created.id);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('duplicate key')
      ) {
        throw new ConflictException('Product with this SKU already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    // Ensure it exists
    await this.findById(id);

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) values.name = dto.name;
    if (dto.sku !== undefined) values.sku = dto.sku;
    if (dto.description !== undefined) values.description = dto.description;
    if (dto.price !== undefined) values.price = dto.price.toFixed(2);
    if (dto.image !== undefined) values.image = dto.image;
    if (dto.inventory !== undefined) values.inventory = dto.inventory;
    if (dto.status !== undefined) values.status = dto.status;
    if (dto.categoryId !== undefined) values.categoryId = dto.categoryId;

    try {
      await this.db
        .update(schema.products)
        .set(values)
        .where(eq(schema.products.id, id));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('duplicate key')
      ) {
        throw new ConflictException('Product with this SKU already exists');
      }
      throw error;
    }

    return this.findById(id);
  }

  async remove(id: string) {
    await this.findById(id);
    await this.db.delete(schema.products).where(eq(schema.products.id, id));
    return { deleted: true };
  }
}
