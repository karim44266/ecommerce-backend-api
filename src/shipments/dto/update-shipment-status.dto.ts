import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** All valid shipment statuses */
export const SHIPMENT_STATUSES = [
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
 *  ASSIGNED   → IN_TRANSIT | FAILED
 *  IN_TRANSIT → DELIVERED  | FAILED
 *  FAILED     → RETURNED   | IN_TRANSIT   (retry or return)
 *  DELIVERED  → (terminal)
 *  RETURNED   → (terminal)
 */
export const SHIPMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED: ['IN_TRANSIT', 'FAILED'],
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
}
