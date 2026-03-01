import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateTrackingDto {
  @ApiProperty({
    description: 'Shipping carrier name',
    example: 'FedEx',
  })
  @IsString()
  @IsNotEmpty()
  carrier: string;

  @ApiProperty({
    description: 'Tracking number',
    example: '1Z999AA10123456784',
  })
  @IsString()
  @IsNotEmpty()
  trackingNumber: string;

  @ApiPropertyOptional({
    description: 'Optional note for the audit trail',
    example: 'Shipped via FedEx Ground',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
