import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateDiscountCampaignDto } from './dto/create-discount-campaign.dto';
import { UpdateDiscountCampaignDto } from './dto/update-discount-campaign.dto';
import { DiscountCampaignsService } from './discount-campaigns.service';

@ApiTags('admin-discount-campaigns')
@Controller('admin/discount-campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class DiscountCampaignsController {
  constructor(
    private readonly discountCampaignsService: DiscountCampaignsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a discount campaign' })
  @ApiCreatedResponse({ description: 'Discount campaign created' })
  create(@Body() dto: CreateDiscountCampaignDto) {
    return this.discountCampaignsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List discount campaigns' })
  @ApiOkResponse({ description: 'Discount campaigns list' })
  findAll() {
    return this.discountCampaignsService.findAll();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a discount campaign' })
  @ApiOkResponse({ description: 'Discount campaign updated' })
  update(@Param('id') id: string, @Body() dto: UpdateDiscountCampaignDto) {
    return this.discountCampaignsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a discount campaign' })
  @ApiOkResponse({ description: 'Discount campaign deleted' })
  remove(@Param('id') id: string) {
    return this.discountCampaignsService.remove(id);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a discount campaign' })
  @ApiOkResponse({ description: 'Discount campaign activated' })
  activate(@Param('id') id: string) {
    return this.discountCampaignsService.activate(id);
  }

  @Post(':id/draft')
  @ApiOperation({ summary: 'Move a discount campaign to draft' })
  @ApiOkResponse({ description: 'Discount campaign moved to draft' })
  moveToDraft(@Param('id') id: string) {
    return this.discountCampaignsService.moveToDraft(id);
  }
}
