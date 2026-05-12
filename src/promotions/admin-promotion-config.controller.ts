import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PromotionMetricsQueryDto } from './dto/promotion-metrics-query.dto';
import { PromotionPreviewQueryDto } from './dto/promotion-preview-query.dto';
import {
  PromotionPreviewResponseDto,
} from './dto/promotion-response.dto';
import { AcceptDiscountOfferDto } from './dto/accept-discount-offer.dto';
import { DiscountOfferSuggestionsQueryDto } from './dto/discount-offer-suggestions-query.dto';
import { UpdatePromotionConfigDto } from './dto/update-promotion-config.dto';
import { DiscountOfferSuggestionService } from './discount-offer-suggestion.service';
import { InventoryPromotionService } from './inventory-promotion.service';
import { PromotionConfigService } from './promotion-config.service';
import { PromotionMetricsService } from './promotion-metrics.service';
import { PromotionRecommendationService } from './recommendation.service';

type AdminRequest = { user: { userId: string } };

@ApiTags('admin-promotions')
@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AdminPromotionConfigController {
  constructor(
    private readonly promotionConfigService: PromotionConfigService,
    private readonly recommendationService: PromotionRecommendationService,
    private readonly discountOfferSuggestionService: DiscountOfferSuggestionService,
    private readonly inventoryPromotionService: InventoryPromotionService,
    private readonly promotionMetricsService: PromotionMetricsService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Get current promotion configuration' })
  @ApiOkResponse({ description: 'Current promotion config' })
  getConfig() {
    return this.promotionConfigService.getConfig();
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update promotion configuration' })
  @ApiOkResponse({ description: 'Updated promotion config' })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'One or more provided product IDs do not exist',
  })
  async updateConfig(
    @Req() request: AdminRequest,
    @Body() dto: UpdatePromotionConfigDto,
  ) {
    const productIdsToValidate = [
      ...(dto.suppressedProductIds ?? []),
      ...(dto.forcedProductIds ?? []),
    ];

    const invalidProductIds =
      await this.promotionConfigService.validateProductIdsExist(
        productIdsToValidate,
      );

    if (invalidProductIds.length > 0) {
      throw new UnprocessableEntityException({
        message: 'One or more product IDs are invalid',
        invalidProductIds,
      });
    }

    return this.promotionConfigService.updateConfig(dto, request.user.userId);
  }

  @Post('config/suppress/:productId')
  @ApiOperation({ summary: 'Idempotently add product to suppression list' })
  @ApiParam({ name: 'productId', type: String })
  @ApiOkResponse({ description: 'Updated promotion config' })
  async suppressProduct(
    @Req() request: AdminRequest,
    @Param('productId') productId: string,
  ) {
    return this.promotionConfigService.addSuppressedProduct(
      productId,
      request.user.userId,
    );
  }

  @Delete('config/suppress/:productId')
  @ApiOperation({ summary: 'Remove product from suppression list' })
  @ApiParam({ name: 'productId', type: String })
  @ApiOkResponse({ description: 'Updated promotion config' })
  async unsuppressProduct(
    @Req() request: AdminRequest,
    @Param('productId') productId: string,
  ) {
    return this.promotionConfigService.removeSuppressedProduct(
      productId,
      request.user.userId,
    );
  }

  @Get('recommendations/preview')
  @ApiOperation({
    summary:
      'Preview recommendation pipeline for a user (cache bypass, includes debug metrics)',
  })
  @ApiQuery({ name: 'userId', required: true })
  @ApiOkResponse({
    description: 'Preview recommendations with pipeline diagnostics',
    type: PromotionPreviewResponseDto,
  })
  async previewRecommendations(@Query() query: PromotionPreviewQueryDto) {
    const result = await this.recommendationService.getRecommendations(
      query.userId,
      {
        includeDebug: true,
        bypassPopularityCache: true,
      },
    );

    return {
      recommendations: result.recommendations,
      source: result.source,
      generatedAt: new Date(),
      debug: result.debug ?? {
        candidateCount: 0,
        filteredCount: 0,
        rankingDuration: 0,
      },
    };
  }

  @Post('force-refresh-cache')
  @ApiOperation({ summary: 'Force refresh inventory promotion state cache' })
  @ApiOkResponse({ description: 'Inventory cache refresh result' })
  forceRefreshCache() {
    return this.inventoryPromotionService.refreshCache();
  }

  @Get('metrics')
  @ApiOperation({
    summary: 'Get promotion funnel metrics (impressions, clicks, conversions)',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Number of recent days to include in the metrics window',
  })
  @ApiOkResponse({ description: 'Promotion metrics summary' })
  getMetrics(@Query() query: PromotionMetricsQueryDto) {
    return this.promotionMetricsService.getMetrics(query.days ?? 7);
  }

  @Get('discount-offers/suggestions')
  @ApiOperation({
    summary:
      'Get AI-generated discount offer suggestions for one user, with optional all-products mode',
  })
  @ApiOkResponse({ description: 'Discount offer suggestions' })
  getDiscountOfferSuggestions(@Query() query: DiscountOfferSuggestionsQueryDto) {
    return this.discountOfferSuggestionService.getSuggestions(
      query.userId,
      query.applyToAllProducts ?? false,
    );
  }

  @Post('discount-offers/accept')
  @ApiOperation({
    summary:
      'Accept (or edit then accept) a suggested discount offer and create the campaign',
  })
  @ApiOkResponse({ description: 'Created campaign from accepted suggestion' })
  acceptDiscountOffer(@Body() dto: AcceptDiscountOfferDto) {
    return this.discountOfferSuggestionService.acceptSuggestion(dto);
  }
}
