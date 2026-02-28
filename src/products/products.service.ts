import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ilike, sql, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
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
      // Placeholder ratings until reviews feature is built
      rating: 4.0 + Math.round(Math.random() * 10) / 10,
      reviewCount: Math.floor(Math.random() * 500) + 10,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findAll(query: ProductQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    // Build WHERE conditions dynamically
    const conditions: SQL[] = [];

    if (query.search) {
      conditions.push(ilike(schema.products.name, `%${query.search}%`));
    }

    // Category filter — look up category id from name
    let categoryId: string | undefined;
    if (query.category) {
      const cat = await this.db.query.categories.findFirst({
        where: ilike(schema.categories.name, query.category),
      });
      if (cat) {
        categoryId = cat.id;
        conditions.push(eq(schema.products.categoryId, cat.id));
      } else {
        // No matching category → return empty
        return [];
      }
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

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
      .orderBy(schema.products.createdAt)
      .limit(limit)
      .offset(offset);

    return rows.map((r) => this.toResponse(r.product, r.categoryName));
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
