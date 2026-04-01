import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  IsDateString,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

const ORDER_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'IN_PREPARATION',
  'DELIVERED',
  'SETTLED',
  'CANCELLED',
] as const;

export class OrderQueryDto {
  @ApiPropertyOptional({ description: 'Search by order ID or customer email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ORDER_STATUSES,
  })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter orders created on or after this date (ISO 8601)',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter orders created on or before this date (ISO 8601)',
    example: '2025-12-31',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Minimum total amount (major currency units)',
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minTotal?: number;

  @ApiPropertyOptional({
    description: 'Maximum total amount (major currency units)',
    example: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxTotal?: number;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Sort field',
    default: 'createdAt',
    enum: ['createdAt', 'updatedAt', 'totalAmount', 'status'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'totalAmount', 'status'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    default: 'desc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc';
}
