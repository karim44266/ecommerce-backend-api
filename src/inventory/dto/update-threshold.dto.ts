import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateThresholdDto {
  @ApiProperty({
    description: 'New low-stock threshold (must be ≥ 0)',
    example: 15,
  })
  @IsInt()
  @Min(0, { message: 'Threshold must be 0 or greater' })
  lowStockThreshold: number;
}
