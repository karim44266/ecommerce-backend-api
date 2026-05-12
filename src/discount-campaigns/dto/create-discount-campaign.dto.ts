import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  DiscountCampaignScope,
  DiscountCampaignStatus,
  DiscountType,
} from '../schemas/discount-campaign.schema';

export class CreateDiscountCampaignDto {
  @ApiProperty({ example: 'Spring Promo - Power Tools' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: DiscountCampaignScope,
    example: DiscountCampaignScope.ALL_USERS,
  })
  @IsEnum(DiscountCampaignScope)
  scope: DiscountCampaignScope;

  @ApiPropertyOptional({
    type: [String],
    description: 'Required when scope is PRODUCT_SET',
    example: ['67a4d24d8ee2f3a1b56f9e20'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  productIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Required when scope is CATEGORY',
    example: ['67a4d24d8ee2f3a1b56f9e11'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional allowlist of users eligible for this campaign. Empty means all users.',
    example: ['67a4d24d8ee2f3a1b56f9e20'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  targetUserIds?: string[];

  @ApiProperty({ enum: DiscountType, example: DiscountType.PERCENT })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    example: 15,
    description: 'Percent value for PERCENT, absolute amount for FIXED',
  })
  @IsNumber()
  @Min(0.01)
  discountValue: number;

  @ApiPropertyOptional({ minimum: 0, example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({ minimum: 1, example: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiProperty({ example: '2026-04-20T00:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-05-20T23:59:59.000Z' })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({
    enum: DiscountCampaignStatus,
    example: DiscountCampaignStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(DiscountCampaignStatus)
  status?: DiscountCampaignStatus;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  stackable?: boolean;
}
