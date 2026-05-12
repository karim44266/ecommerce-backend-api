import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import { CreateDiscountCampaignDto } from '../discount-campaigns/dto/create-discount-campaign.dto';
import { DiscountCampaignsService } from '../discount-campaigns/discount-campaigns.service';
import {
  DiscountCampaignScope,
  DiscountCampaignStatus,
  DiscountType,
} from '../discount-campaigns/schemas/discount-campaign.schema';
import { AcceptDiscountOfferDto } from './dto/accept-discount-offer.dto';
import { PromotionRecommendationService } from './recommendation.service';
import { UserProfile, UserProfileDocument } from './schemas/user-profile.schema';

interface DiscountOfferSuggestion {
  suggestionId: string;
  title: string;
  description: string;
  confidence: number;
  rationale: string;
  campaignDraft: CreateDiscountCampaignDto;
  previewProducts: Array<{
    productId: string;
    productName: string;
    categoryId: string;
  }>;
}

interface SuggestionProfileSnapshot {
  totalOrders: number;
  purchaseFrequency: number;
  avgOrderValue: number;
  isNewUser: boolean;
  topCategoryIds: string[];
}

@Injectable()
export class DiscountOfferSuggestionService {
  constructor(
    private readonly recommendationService: PromotionRecommendationService,
    private readonly discountCampaignsService: DiscountCampaignsService,
    @InjectModel(UserProfile.name)
    private readonly userProfileModel: Model<UserProfileDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  private toObjectId(value: string): Types.ObjectId | null {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private roundCurrency(value: number): number {
    return Number(value.toFixed(2));
  }

  private resolveCampaignId(payload: Record<string, unknown>): string | null {
    const id = payload.id ?? payload._id;
    if (!id) {
      return null;
    }

    return String(id);
  }

  private buildCampaignWindow(days = 14): { startsAt: string; endsAt: string } {
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
  }

  private async getProfileSnapshot(userId: string): Promise<SuggestionProfileSnapshot> {
    const userObjectId = this.toObjectId(userId);
    if (!userObjectId) {
      return {
        totalOrders: 0,
        purchaseFrequency: 0,
        avgOrderValue: 0,
        isNewUser: true,
        topCategoryIds: [],
      };
    }

    const profile = await this.userProfileModel
      .findOne({ userId: userObjectId })
      .lean()
      .exec();

    if (!profile) {
      return {
        totalOrders: 0,
        purchaseFrequency: 0,
        avgOrderValue: 0,
        isNewUser: true,
        topCategoryIds: [],
      };
    }

    return {
      totalOrders: Number(profile.totalOrders ?? 0),
      purchaseFrequency: Number(profile.purchaseFrequency ?? 0),
      avgOrderValue: Number(profile.avgOrderValue ?? 0),
      isNewUser: Boolean(profile.isNewUser),
      topCategoryIds: Array.isArray(profile.topCategoryIds)
        ? profile.topCategoryIds.map((id) => String(id))
        : [],
    };
  }

  private computeSuggestedPercent(
    profile: SuggestionProfileSnapshot,
    source: 'personalized' | 'popular' | 'fallback',
    recommendationCount: number,
  ): number {
    let percent = 9;

    if (source === 'fallback') {
      percent += 3;
    }

    if (source === 'personalized') {
      percent -= 1;
    }

    if (profile.isNewUser || profile.totalOrders < 3) {
      percent += 3;
    }

    if (profile.purchaseFrequency < 1.5) {
      percent += 1;
    }

    if (profile.avgOrderValue >= 400) {
      percent -= 2;
    }

    if (recommendationCount >= 5) {
      percent -= 1;
    }

    return this.clamp(Math.round(percent), 5, 25);
  }

  private buildConfidence(
    source: 'personalized' | 'popular' | 'fallback',
    topScores: number[],
  ): number {
    const averageScore =
      topScores.length > 0
        ? topScores.reduce((sum, score) => sum + score, 0) / topScores.length
        : 0;

    const sourceBonus = source === 'personalized' ? 0.2 : source === 'popular' ? 0.1 : 0.05;
    const normalized = 0.5 + sourceBonus + this.clamp(averageScore, 0, 1) * 0.3;

    return this.clamp(Number(normalized.toFixed(2)), 0.45, 0.95);
  }

  async getSuggestions(
    userId: string,
    applyToAllProducts = false,
  ): Promise<Record<string, unknown>> {
    const [profile, recommendationResult] = await Promise.all([
      this.getProfileSnapshot(userId),
      this.recommendationService.getRecommendations(userId, {
        includeDebug: true,
        bypassPopularityCache: true,
      }),
    ]);

    const recommendations = recommendationResult.recommendations.slice(0, 6);
    const topProducts = recommendations.slice(0, 3);
    const topScores = topProducts.map((item) => Number(item.score ?? 0));
    const confidence = this.buildConfidence(recommendationResult.source, topScores);

    const suggestedPercent = this.computeSuggestedPercent(
      profile,
      recommendationResult.source,
      recommendations.length,
    );

    const minOrderAmount =
      profile.avgOrderValue > 0
        ? this.roundCurrency(this.clamp(profile.avgOrderValue * 0.65, 40, 3000))
        : 75;

    const topCategoryId =
      topProducts[0]?.categoryId ?? profile.topCategoryIds[0] ?? null;
    const topCategoryObjectId = topCategoryId ? this.toObjectId(topCategoryId) : null;
    const topCategory = topCategoryObjectId
      ? await this.categoryModel
          .findById(topCategoryObjectId)
          .select('name')
          .lean()
          .exec()
      : null;

    const window = this.buildCampaignWindow(14);

    const globalOffer: DiscountOfferSuggestion = {
      suggestionId: 'all-products-primary',
      title: 'Global Offer For All Products',
      description:
        'A store-wide discount you can apply immediately when you want a single simple offer.',
      confidence,
      rationale:
        recommendationResult.source === 'personalized'
          ? 'Generated from personalized behavior signals and recent affinity patterns.'
          : 'Generated from popularity and conversion trends for this customer segment.',
      campaignDraft: {
        name: `AI Global Offer - ${suggestedPercent}%`,
        scope: DiscountCampaignScope.ALL_USERS,
        discountType: DiscountType.PERCENT,
        discountValue: suggestedPercent,
        minOrderAmount,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        status: DiscountCampaignStatus.DRAFT,
        stackable: false,
      },
      previewProducts: topProducts.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryId: item.categoryId,
      })),
    };

    const suggestions: DiscountOfferSuggestion[] = [globalOffer];

    if (!applyToAllProducts && topProducts.length > 0) {
      suggestions.unshift({
        suggestionId: 'product-set-primary',
        title: 'Targeted Product Offer',
        description:
          'Targets the top AI-recommended products for this user. Best when you want precision.',
        confidence,
        rationale:
          'Built from top ranked recommendations and optimized for likely conversion intent.',
        campaignDraft: {
          name: `AI Targeted Product Offer - ${this.clamp(suggestedPercent + 2, 6, 30)}%`,
          scope: DiscountCampaignScope.PRODUCT_SET,
          productIds: topProducts.map((item) => item.productId),
          discountType: DiscountType.PERCENT,
          discountValue: this.clamp(suggestedPercent + 2, 6, 30),
          minOrderAmount: this.roundCurrency(minOrderAmount * 0.8),
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          status: DiscountCampaignStatus.DRAFT,
          stackable: false,
        },
        previewProducts: topProducts.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          categoryId: item.categoryId,
        })),
      });
    }

    if (!applyToAllProducts && topCategoryId) {
      suggestions.push({
        suggestionId: 'category-secondary',
        title: `Category Offer${topCategory ? ` - ${String(topCategory.name)}` : ''}`,
        description:
          'Applies discount only to the strongest category signal for this user.',
        confidence: this.clamp(Number((confidence - 0.08).toFixed(2)), 0.4, 0.95),
        rationale:
          'Useful when you want controlled discounts with lower revenue impact than global offers.',
        campaignDraft: {
          name: `AI Category Offer - ${topCategory ? String(topCategory.name) : 'Top Category'}`,
          scope: DiscountCampaignScope.CATEGORY,
          categoryIds: [topCategoryId],
          discountType: DiscountType.PERCENT,
          discountValue: this.clamp(suggestedPercent + 1, 6, 28),
          minOrderAmount,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          status: DiscountCampaignStatus.DRAFT,
          stackable: true,
        },
        previewProducts: topProducts
          .filter((item) => item.categoryId === topCategoryId)
          .map((item) => ({
            productId: item.productId,
            productName: item.productName,
            categoryId: item.categoryId,
          })),
      });
    }

    return {
      userId,
      applyToAllProducts,
      source: recommendationResult.source,
      generatedAt: new Date(),
      profileSnapshot: {
        totalOrders: profile.totalOrders,
        purchaseFrequency: Number(profile.purchaseFrequency.toFixed(2)),
        avgOrderValue: Number(profile.avgOrderValue.toFixed(2)),
        isNewUser: profile.isNewUser,
      },
      offers: suggestions,
    };
  }

  async acceptSuggestion(dto: AcceptDiscountOfferDto) {
    const targetUserIds = Array.from(
      new Set([...(dto.campaign.targetUserIds ?? []), dto.userId]),
    );

    const created = (await this.discountCampaignsService.create(
      {
        ...dto.campaign,
        targetUserIds,
      },
    )) as Record<string, unknown>;

    const activate = dto.activate ?? true;
    if (!activate) {
      return {
        suggestionId: dto.suggestionId ?? null,
        userId: dto.userId,
        activated: false,
        campaign: created,
      };
    }

    const createdId = this.resolveCampaignId(created);
    if (!createdId) {
      throw new NotFoundException(
        'Created campaign ID could not be resolved for activation',
      );
    }

    const activated = await this.discountCampaignsService.activate(createdId);

    return {
      suggestionId: dto.suggestionId ?? null,
      userId: dto.userId,
      activated: true,
      campaign: activated,
    };
  }
}
