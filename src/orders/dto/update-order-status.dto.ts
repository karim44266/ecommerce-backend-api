import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PROCESSING',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Valid admin-driven status transitions.
 * Key = current status, Value = allowed next statuses.
 */
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'REFUNDED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
  FAILED: ['PROCESSING'],
};

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: ORDER_STATUSES,
    description: 'The new order status',
    example: 'PROCESSING',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(ORDER_STATUSES)
  status: string;

  @ApiPropertyOptional({
    description: 'Optional note for the audit trail',
    example: 'Payment confirmed via bank transfer',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
