import {
  Controller,
  Get,
  Logger,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PromotionResponseDto,
} from './dto/promotion-response.dto';
import {
  PromotionRecommendationService,
  withTimeout,
} from './recommendation.service';
import { BoundedCache } from './utils/bounded-cache';

type AuthenticatedRequest = { user: { userId: string } };

@ApiTags('promotions')
@Controller('promotions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PromotionsController {
  private readonly logger = new Logger(PromotionsController.name);

  private readonly responseCache = new BoundedCache<string, PromotionResponseDto>({
    maxSize: 10_000,
    ttlMs: 60 * 60 * 1000,
  });

  constructor(
    private readonly recommendationService: PromotionRecommendationService,
  ) {}

  private applyCachingHeaders(response: Response, source: string): void {
    response.setHeader('Cache-Control', 'max-age=3600');
    response.setHeader('X-Recommendation-Source', source);
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Get personalized product recommendations for authenticated user',
  })
  @ApiOkResponse({
    description: 'Recommendation payload with source metadata',
    type: PromotionResponseDto,
  })
  async getRecommendations(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PromotionResponseDto> {
    const userId = request.user.userId;
    const cached = this.responseCache.get(userId);

    if (cached) {
      this.applyCachingHeaders(response, cached.source);
      return cached;
    }

    let timedOut = false;

    const result = await withTimeout(
      () => this.recommendationService.getRecommendations(userId),
      500,
      async () => {
        timedOut = true;
        const fallback =
          await this.recommendationService.getPopularityBasedRecommendations({
            bypassPopularityCache: true,
          });
        return {
          recommendations: fallback.recommendations,
          source: 'fallback' as const,
        };
      },
    );

    if (timedOut) {
      this.logger.warn(
        `Recommendations timed out after 500ms for user ${userId}; using fallback.`,
      );
    }

    const payload: PromotionResponseDto = {
      recommendations: result.recommendations,
      source: result.source,
      generatedAt: new Date(),
    };

    this.responseCache.set(userId, payload);
    this.applyCachingHeaders(response, payload.source);

    return payload;
  }
}
