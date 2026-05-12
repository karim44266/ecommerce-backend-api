import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdatePromotionConfigDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Products that must be excluded from recommendations',
    example: ['67a4d24d8ee2f3a1b56f9e20'],
  })
  @IsOptional()
  @IsMongoId({ each: true })
  @ArrayUnique()
  suppressedProductIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Products that must be force-included if stock > 0',
    example: ['67a4d24d8ee2f3a1b56f9e21'],
  })
  @IsOptional()
  @IsMongoId({ each: true })
  @ArrayUnique()
  forcedProductIds?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 50, example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxRecommendations?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  diversityLimit?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  abTestSplitPercent?: number;
}
