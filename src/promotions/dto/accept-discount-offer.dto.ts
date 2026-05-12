import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateDiscountCampaignDto } from '../../discount-campaigns/dto/create-discount-campaign.dto';

export class AcceptDiscountOfferDto {
  @ApiProperty({
    example: '67a4d24d8ee2f3a1b56f9e20',
    description: 'User for whom the offer was generated',
  })
  @IsMongoId()
  userId: string;

  @ApiPropertyOptional({
    example: 'product-set-primary',
    description: 'Optional suggestion key used by the UI',
  })
  @IsOptional()
  @IsString()
  suggestionId?: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Activate campaign immediately after creation',
  })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;

  @ApiProperty({ type: CreateDiscountCampaignDto })
  @ValidateNested()
  @Type(() => CreateDiscountCampaignDto)
  campaign: CreateDiscountCampaignDto;
}
