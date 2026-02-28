import { IsInt, IsOptional, IsString, NotEquals } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiProperty({
    description: 'Positive = add stock, negative = subtract stock. Cannot be 0.',
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
}
