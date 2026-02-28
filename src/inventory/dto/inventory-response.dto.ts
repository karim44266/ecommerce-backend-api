import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ───── Single inventory record ─────
export class InventoryResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  productId: string;

  @ApiProperty({ example: 'Bluetooth Speaker' })
  productName: string;

  @ApiProperty({ example: 'BT-SPKR-001' })
  productSku: string;

  @ApiProperty({ example: 'active' })
  productStatus: string;

  @ApiProperty({ example: 50 })
  quantity: number;

  @ApiProperty({ example: 10 })
  lowStockThreshold: number;

  @ApiProperty({ example: true })
  isLowStock: boolean;

  @ApiPropertyOptional({ example: '2026-02-28T10:00:00.000Z', nullable: true })
  lastAdjustedAt: string | null;

  @ApiProperty({ example: '2026-02-28T08:00:00.000Z' })
  createdAt: string;
}

// ───── Pagination meta ─────
export class PaginationMetaDto {
  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

// ───── Paginated inventory list ─────
export class PaginatedInventoryResponseDto {
  @ApiProperty({ type: [InventoryResponseDto] })
  data: InventoryResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ───── Summary ─────
export class InventorySummaryDto {
  @ApiProperty({ example: 42, description: 'Total products with inventory' })
  total: number;

  @ApiProperty({ example: 5, description: 'Products with quantity ≤ threshold but > 0' })
  low: number;

  @ApiProperty({ example: 2, description: 'Products with quantity ≤ 0' })
  out: number;

  @ApiProperty({ example: 35, description: 'Products with quantity > threshold' })
  inStock: number;
}

// ───── Adjustment history entry ─────
export class AdjustmentHistoryEntryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440005' })
  id: string;

  @ApiProperty({ example: -5 })
  adjustment: number;

  @ApiPropertyOptional({ example: 'Damaged goods', nullable: true })
  reason: string | null;

  @ApiPropertyOptional({ example: 'admin@test.com', nullable: true })
  adjustedBy: string | null;

  @ApiProperty({ example: '2026-02-28T10:00:00.000Z' })
  createdAt: string;
}

// ───── Paginated history ─────
export class PaginatedHistoryResponseDto {
  @ApiProperty({ type: [AdjustmentHistoryEntryDto] })
  data: AdjustmentHistoryEntryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ───── Backfill result ─────
export class BackfillResponseDto {
  @ApiProperty({ example: 3 })
  created: number;

  @ApiProperty({ example: 'Created inventory records for 3 product(s)' })
  message: string;
}

// ───── Adjust result (includes who made the change) ─────
export class AdjustResultDto extends InventoryResponseDto {
  @ApiPropertyOptional({
    example: 'admin@test.com',
    nullable: true,
    description: 'Email of the user who made this adjustment',
  })
  adjustedBy: string | null;

  @ApiProperty({ example: 25, description: 'The adjustment value applied' })
  adjustmentApplied: number;
}
