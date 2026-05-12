import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class PromotionPreviewQueryDto {
  @ApiProperty({
    description: 'User ID to preview recommendations for',
    example: '67a4d24d8ee2f3a1b56f9e20',
  })
  @IsMongoId()
  userId: string;
}
