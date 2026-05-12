import { PartialType } from '@nestjs/swagger';
import { CreateDiscountCampaignDto } from './create-discount-campaign.dto';

export class UpdateDiscountCampaignDto extends PartialType(
  CreateDiscountCampaignDto,
) {}
