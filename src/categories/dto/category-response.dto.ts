import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Electronics' })
  name: string;

  @ApiProperty({ example: 'electronics' })
  slug: string;

  @ApiPropertyOptional({ example: 'All electronic devices and accessories' })
  description: string | null;

  @ApiProperty({ example: 12 })
  productCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class CategoryPaginationMetaDto {
  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class CategoryListResponseDto {
  @ApiProperty({ type: [CategoryResponseDto] })
  data: CategoryResponseDto[];

  @ApiProperty({ type: CategoryPaginationMetaDto })
  meta: CategoryPaginationMetaDto;
}
