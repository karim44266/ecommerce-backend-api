import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShipmentDto {
  @ApiProperty({ description: 'Order UUID to create shipment for' })
  @IsUUID()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: 'Staff user UUID to assign the shipment to' })
  @IsUUID()
  @IsNotEmpty()
  staffUserId: string;

  @ApiPropertyOptional({ description: 'Optional tracking number' })
  @IsOptional()
  @IsString()
  trackingNumber?: string;
}
