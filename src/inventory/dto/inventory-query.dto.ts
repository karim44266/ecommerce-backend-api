import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum StockFilter {
  ALL = 'all',
  LOW = 'low',
  OUT = 'out',
  IN_STOCK = 'in-stock',
}

export enum InventorySortBy {
  NAME = 'name',
  QUANTITY = 'quantity',
  THRESHOLD = 'threshold',
  LAST_ADJUSTED = 'lastAdjusted',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class InventoryQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Search by product name or SKU' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by stock status',
    enum: StockFilter,
    default: StockFilter.ALL,
  })
  @IsOptional()
  @IsEnum(StockFilter)
  status?: StockFilter;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: InventorySortBy,
    default: InventorySortBy.NAME,
  })
  @IsOptional()
  @IsEnum(InventorySortBy)
  sortBy?: InventorySortBy;

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: SortOrder,
    default: SortOrder.ASC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder;
}

export class HistoryQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
