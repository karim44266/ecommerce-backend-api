import { IsIn, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** All valid shipment statuses */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
  'RETURNED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Allowed status transitions for shipments.
 *
 *  PENDING    → (admin reassigns → ASSIGNED)
 *  ASSIGNED   → IN_TRANSIT | PENDING | FAILED
 *                IN_TRANSIT = staff accepts
 *                PENDING    = staff declines
 *  IN_TRANSIT → DELIVERED  | FAILED
 *  FAILED     → RETURNED   | IN_TRANSIT   (retry or return)
 *  DELIVERED  → (terminal)
 *  RETURNED   → (terminal)
 */
export const SHIPMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: [],
  ASSIGNED: ['IN_TRANSIT', 'PENDING', 'FAILED'],
  IN_TRANSIT: ['DELIVERED', 'FAILED'],
  FAILED: ['RETURNED', 'IN_TRANSIT'],
  DELIVERED: [],
  RETURNED: [],
};

export class UpdateShipmentStatusDto {
  @ApiProperty({
    description: 'New shipment status',
    enum: SHIPMENT_STATUSES,
    example: 'IN_TRANSIT',
  })
  @IsNotEmpty()
  @IsString()
  @IsIn([...SHIPMENT_STATUSES])
  status: ShipmentStatus;

  @ApiPropertyOptional({
    description: 'Optional note about the status change',
    example: 'Package picked up from warehouse',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Required 4-digit PIN when marking a shipment as DELIVERED',
    example: '1234',
  })
  @IsOptional()
  @IsString()
  @Length(4, 4)
  deliveryCode?: string;
}
