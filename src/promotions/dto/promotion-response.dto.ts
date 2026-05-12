import { ApiProperty } from '@nestjs/swagger';

export class PromotionItemDto {
  @ApiProperty({ example: '67a4d24d8ee2f3a1b56f9e20' })
  productId: string;

  @ApiProperty({ example: 'Wireless Mouse' })
  productName: string;

  @ApiProperty({ example: 'https://example.com/images/wireless-mouse.jpg' })
  image: string;

  @ApiProperty({ example: '67a4d24d8ee2f3a1b56f9e11' })
  categoryId: string;

  @ApiProperty({ example: 49.99 })
  price: number;

  @ApiProperty({ example: 42.99 })
  displayPrice: number;

  @ApiProperty({ example: 14, nullable: true })
  discountPercent: number | null;

  @ApiProperty({ example: 7, nullable: true })
  discountAmount: number | null;

  @ApiProperty({ example: 18 })
  stockLevel: number;

  @ApiProperty({
    example: 'Popular in your favorite category',
  })
  promotionReason: string;

  @ApiProperty({ example: 0.853244 })
  score: number;

  @ApiProperty({ example: false })
  isAdminForced: boolean;
}

export class PromotionResponseDto {
  @ApiProperty({ type: [PromotionItemDto] })
  recommendations: PromotionItemDto[];

  @ApiProperty({ enum: ['personalized', 'popular', 'fallback'] })
  source: 'personalized' | 'popular' | 'fallback';

  @ApiProperty({ example: '2026-04-13T10:00:00.000Z' })
  generatedAt: Date;
}

export class RecommendationDebugDto {
  @ApiProperty({ example: 50 })
  candidateCount: number;

  @ApiProperty({ example: 31 })
  filteredCount: number;

  @ApiProperty({ example: 17 })
  rankingDuration: number;
}

export class PromotionPreviewResponseDto extends PromotionResponseDto {
  @ApiProperty({ type: RecommendationDebugDto })
  debug: RecommendationDebugDto;
}
