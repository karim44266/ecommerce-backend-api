import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  NotEquals,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AdjustStockDto {
  @ApiProperty({
    description:
      'Positive = add stock, negative = subtract stock. Cannot be 0.',
    example: 25,
  })
  @IsInt()
  @NotEquals(0, { message: 'Adjustment cannot be zero' })
  adjustment: number;

  @ApiPropertyOptional({
    description: 'Reason for the adjustment (e.g. "Restock from supplier")',
    example: 'Restock from supplier',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Purchase unit price used for stock increases (required when adjustment is positive).',
    example: 62.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchasePrice?: number;
}
