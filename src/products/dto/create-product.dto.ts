import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'WH-1000' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku: string;

  @ApiPropertyOptional({ example: 'Premium noise-cancelling wireless headphones' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 99.99, description: 'Price in dollars (max 2 decimal places)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price: number;

  @ApiPropertyOptional({ example: 'https://example.com/headphones.jpg' })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  inventory?: number;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'draft', 'archived'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;
}
