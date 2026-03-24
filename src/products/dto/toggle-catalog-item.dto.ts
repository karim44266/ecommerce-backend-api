import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class ToggleCatalogItemDto {
  @ApiProperty({ example: '60d5ecb8b392d7001f3e9a5a' })
  @IsMongoId()
  @IsNotEmpty()
  productId: string;
}
