import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Wireless Headphones' })
  name: string;

  @ApiProperty({ example: 'WH-1000' })
  sku: string;

  @ApiPropertyOptional({ example: 'Premium noise-cancelling wireless headphones' })
  description: string;

  @ApiProperty({ example: 99.99 })
  price: number;

  @ApiPropertyOptional({ example: 'https://example.com/headphones.jpg' })
  image: string;

  @ApiProperty({ example: 50 })
  inventory: number;

  @ApiProperty({ example: 50 })
  stock: number;

  @ApiProperty({ example: 'active', enum: ['active', 'draft', 'archived'] })
  status: string;

  @ApiPropertyOptional({ example: 'Electronics' })
  category: string | null;

  @ApiPropertyOptional({ example: 'uuid' })
  categoryId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class ProductListResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  data: ProductResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
