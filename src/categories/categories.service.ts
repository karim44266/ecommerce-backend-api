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
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/** Escape special LIKE characters so user input is treated literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

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

    const conditions: SQL[] = [];
    if (query.search) {
      conditions.push(ilike(schema.categories.name, `%${escapeLike(query.search)}%`));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count
    const [{ count: total }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.categories)
      .where(whereClause);

    // Categories with product count via subquery
    const rows = await this.db
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        slug: schema.categories.slug,
        description: schema.categories.description,
        createdAt: schema.categories.createdAt,
        productCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.products}
          WHERE ${schema.products.categoryId} = ${schema.categories.id}
        )`,
      })
      .from(schema.categories)
      .where(whereClause)
      .orderBy(schema.categories.name)
      .limit(limit)
      .offset(offset);

    return {
      data: rows,
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
    return this.db
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        slug: schema.categories.slug,
      })
      .from(schema.categories)
      .orderBy(schema.categories.name);
  }

  async findById(id: string) {
    const rows = await this.db
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        slug: schema.categories.slug,
        description: schema.categories.description,
        createdAt: schema.categories.createdAt,
        productCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.products}
          WHERE ${schema.products.categoryId} = ${schema.categories.id}
        )`,
      })
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Category not found');
    }
    return rows[0];
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.slug ?? this.slugify(dto.name);

    try {
      const [created] = await this.db
        .insert(schema.categories)
        .values({
          name: dto.name,
          slug,
          description: dto.description ?? null,
        })
        .returning();
      return this.findById(created.id);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('duplicate key')
      ) {
        throw new ConflictException('Category with this name or slug already exists');
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
      await this.db
        .update(schema.categories)
        .set(values)
        .where(eq(schema.categories.id, id));
      return this.findById(id);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('duplicate key')
      ) {
        throw new ConflictException('Category with this name or slug already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.findById(id);

    // Check for products using this category
    const product = await this.db.query.products.findFirst({
      where: eq(schema.products.categoryId, id),
    });
    if (product) {
      throw new ConflictException(
        'Cannot delete category with existing products. Remove or reassign products first.',
      );
    }

    await this.db.delete(schema.categories).where(eq(schema.categories.id, id));
    return { deleted: true };
  }
}
