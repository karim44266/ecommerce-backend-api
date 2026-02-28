import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, IsNumber, IsIn, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ProductQueryDto {
  @ApiPropertyOptional({ example: 'headphones', description: 'Search by product name' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ example: 'Electronics', description: 'Filter by category name' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'uuid', description: 'Filter by category ID' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'draft', 'archived'], description: 'Filter by status' })
  @IsString()
  @IsOptional()
  @IsIn(['active', 'draft', 'archived'])
  status?: string;

  @ApiPropertyOptional({ example: 10, description: 'Minimum price' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional({ example: 500, description: 'Maximum price' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @ApiPropertyOptional({
    example: 'price',
    enum: ['name', 'price', 'createdAt', 'updatedAt'],
    description: 'Sort field',
  })
  @IsString()
  @IsOptional()
  @IsIn(['name', 'price', 'createdAt', 'updatedAt'])
  sortBy?: string;

  @ApiPropertyOptional({ example: 'asc', enum: ['asc', 'desc'], description: 'Sort direction' })
  @IsString()
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
