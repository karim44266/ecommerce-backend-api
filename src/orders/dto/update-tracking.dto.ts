import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateTrackingDto {
  @ApiProperty({ description: 'Shipping carrier name' })
  @IsString()
  carrier: string;

  @ApiProperty({ description: 'Tracking number' })
  @IsString()
  trackingNumber: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}
