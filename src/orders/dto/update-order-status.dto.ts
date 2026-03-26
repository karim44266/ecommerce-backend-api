import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const ORDER_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'IN_PREPARATION',
  'DELIVERED',
  'SETTLED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Valid admin-driven status transitions.
 * Key = current status, Value = allowed next statuses.
 */
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PREPARATION', 'CANCELLED'],
  IN_PREPARATION: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['SETTLED'],
  SETTLED: [],
  CANCELLED: [],
};

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: ORDER_STATUSES,
    description: 'The new order status',
    example: 'IN_PREPARATION',
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
