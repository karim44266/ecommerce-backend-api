import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';

export class DiscountOfferSuggestionsQueryDto {
  @ApiProperty({ example: '67a4d24d8ee2f3a1b56f9e20' })
  @IsMongoId()
  userId: string;

  @ApiPropertyOptional({
    example: false,
    description: 'When true, only suggestions that target all products are returned',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() === 'true';
  })
  @IsBoolean()
  applyToAllProducts?: boolean;
}
