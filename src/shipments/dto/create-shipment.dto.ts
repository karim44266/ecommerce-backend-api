import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShipmentDto {
  @ApiProperty({ description: 'Order MongoDB ObjectId to create shipment for' })
  @IsMongoId()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: 'Staff user MongoDB ObjectId to assign the shipment to' })
  @IsMongoId()
  @IsNotEmpty()
  staffUserId: string;

  @ApiPropertyOptional({ description: 'Optional tracking number' })
  @IsOptional()
  @IsString()
  trackingNumber?: string;
}
