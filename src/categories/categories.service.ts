import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category, CategoryDocument } from './schemas/category.schema';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async toResponse(category: CategoryDocument | Record<string, unknown>) {
    const plain = typeof (category as CategoryDocument).toJSON === 'function'
      ? ((category as CategoryDocument).toJSON() as Record<string, unknown>)
      : category;
    const productCount = await this.productModel.countDocuments({ categoryId: plain.id });

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
      this.categoryModel.find(filter).sort({ name: 1 }).skip(offset).limit(limit),
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
    const rows = await this.categoryModel.find().select('name slug').sort({ name: 1 });
    return rows.map((row) => row.toJSON());
  }

  async findById(id: string) {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.toResponse(category);
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
      await this.categoryModel.findByIdAndUpdate(id, { $set: values }, { new: true });
      return this.findById(id);
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException('Category with this name or slug already exists');
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
