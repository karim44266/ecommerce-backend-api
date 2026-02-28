import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

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

  async findAll() {
    return this.db.query.categories.findMany({
      orderBy: (c, { asc }) => [asc(c.name)],
    });
  }

  async findById(id: string) {
    const category = await this.db.query.categories.findFirst({
      where: eq(schema.categories.id, id),
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
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
      return created;
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
    if (dto.name !== undefined) values.name = dto.name;
    if (dto.slug !== undefined) values.slug = dto.slug;
    if (dto.description !== undefined) values.description = dto.description;

    if (Object.keys(values).length === 0) {
      return this.findById(id);
    }

    try {
      const [updated] = await this.db
        .update(schema.categories)
        .set(values)
        .where(eq(schema.categories.id, id))
        .returning();
      return updated;
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
