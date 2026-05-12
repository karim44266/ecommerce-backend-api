import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DiscountCampaignsService } from '../discount-campaigns/discount-campaigns.service';
import { InventoryService } from '../inventory/inventory.service';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import {
  UserProfile,
  UserProfileDocument,
} from './schemas/user-profile.schema';
import {
  Category,
  CategoryDocument,
} from '../categories/schemas/category.schema';
import {
  InventoryPromotionService,
  InventoryState,
} from './inventory-promotion.service';
import {
  PromotionConfigService,
  PromotionRuleConfig,
} from './promotion-config.service';
import { BoundedCache } from './utils/bounded-cache';

const CANDIDATE_LIMIT = 50;
const MIN_CANDIDATES_BEFORE_EXPANSION = 20;
const COMPLETED_ORDER_STATUSES = ['DELIVERED', 'SETTLED'];
const POPULARITY_CACHE_KEY = 'popular:30d';
const POPULARITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type SparseVector = Record<string, number>;

export interface ProductCandidate {
  productId: string;
  name: string;
  image: string;
  price: number;
  categoryId: string;
  stockLevel: number;
  score: number;
  inventoryState: InventoryState;
  isAdminForced: boolean;
}

export interface PromotionDto {
  productId: string;
  productName: string;
  image: string;
  categoryId: string;
  price: number;
  displayPrice: number;
  discountPercent: number | null;
  discountAmount: number | null;
  stockLevel: number;
  promotionReason: string;
  score: number;
  isAdminForced: boolean;
}

export type RecommendationSource = 'personalized' | 'popular' | 'fallback';

export interface RecommendationDebug {
  candidateCount: number;
  filteredCount: number;
  rankingDuration: number;
}

export interface RecommendationPipelineResult {
  recommendations: PromotionDto[];
  source: RecommendationSource;
  debug?: RecommendationDebug;
}

export interface RecommendationOptions {
  includeDebug?: boolean;
  bypassPopularityCache?: boolean;
}

interface CategoryAffinityLike {
  categoryId: string;
  score: number;
}

interface RecommendationProfile {
  userId: string;
  topCategoryIds: string[];
  categoryAffinities: CategoryAffinityLike[];
  preferredPriceRange: { min: number; max: number };
  isNewUser: boolean;
}

interface PopularProductRow {
  productId: Types.ObjectId;
  popularity: number;
}

interface RecentCategoryRow {
  categoryId: Types.ObjectId;
}

export function cosineSimilarity(
  leftVector: SparseVector,
  rightVector: SparseVector,
): number {
  const leftKeys = Object.keys(leftVector);
  const rightKeys = Object.keys(rightVector);

  if (leftKeys.length === 0 || rightKeys.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitudeSq = 0;
  let rightMagnitudeSq = 0;

  for (const key of leftKeys) {
    const value = leftVector[key] ?? 0;
    leftMagnitudeSq += value * value;
  }

  for (const key of rightKeys) {
    const value = rightVector[key] ?? 0;
    rightMagnitudeSq += value * value;

    if (key in leftVector) {
      dotProduct += (leftVector[key] ?? 0) * value;
    }
  }

  if (leftMagnitudeSq === 0 || rightMagnitudeSq === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitudeSq) * Math.sqrt(rightMagnitudeSq));
}

export function applyBusinessRules(
  candidates: ProductCandidate[],
  userProfile: Pick<RecommendationProfile, 'preferredPriceRange'>,
  config: PromotionRuleConfig,
): ProductCandidate[] {
  const preferredMax = Number(userProfile.preferredPriceRange?.max ?? 0);
  const filtered = new Map<string, ProductCandidate>();

  for (const original of candidates) {
    const candidate = { ...original };

    // Rule 1: hard stock exclusion.
    if (candidate.stockLevel <= 0) {
      continue;
    }

    // Rule 4: suppression list exclusion.
    if (config.suppressedProductIds.has(candidate.productId)) {
      continue;
    }

    let score = candidate.score > 0 ? candidate.score : 1;

    // Rule 2: inventory state scoring.
    switch (candidate.inventoryState) {
      case InventoryState.CRITICAL: {
        continue;
      }
      case InventoryState.LOW: {
        score *= 0.4;
        break;
      }
      case InventoryState.HEALTHY: {
        score *= 1.0;
        break;
      }
      case InventoryState.OVERSTOCK: {
        score *= 1.6;
        break;
      }
      default: {
        score *= 1.0;
      }
    }

    // Rule 3: soft price penalty.
    if (preferredMax > 0 && candidate.price > preferredMax * 1.5) {
      score -= 0.2;
    }

    candidate.score = Number(score.toFixed(6));
    filtered.set(candidate.productId, candidate);
  }

  // Rule 5: force-add after prior rules, if rule 1 (stock > 0) passed.
  for (const original of candidates) {
    if (!config.forcedProductIds.has(original.productId)) {
      continue;
    }
    if (original.stockLevel <= 0) {
      continue;
    }

    const forcedCandidate: ProductCandidate = {
      ...original,
      score: 2.0,
      isAdminForced: true,
    };

    filtered.set(forcedCandidate.productId, forcedCandidate);
  }

  return Array.from(filtered.values());
}

export function rankWithAI(
  candidates: ProductCandidate[],
  userVector: SparseVector,
  recentCategoryIds: Set<string>,
): ProductCandidate[] {
  return candidates
    .map((candidate) => {
      const productVector: SparseVector = { [candidate.categoryId]: 1.0 };
      const similarity = candidate.isAdminForced
        ? 1
        : cosineSimilarity(userVector, productVector);

      let finalScore = similarity * candidate.score;
      if (recentCategoryIds.has(candidate.categoryId)) {
        finalScore *= 1.2;
      }

      return {
        ...candidate,
        score: Number(finalScore.toFixed(6)),
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function applyDiversityConstraint(
  candidates: ProductCandidate[],
  maxPerCategory = 2,
): ProductCandidate[] {
  const enforce = (maxPerCat: number): ProductCandidate[] => {
    const counts = new Map<string, number>();
    const picked: ProductCandidate[] = [];

    for (const candidate of candidates) {
      const used = counts.get(candidate.categoryId) ?? 0;
      if (used >= maxPerCat) {
        continue;
      }
      counts.set(candidate.categoryId, used + 1);
      picked.push(candidate);
    }

    return picked;
  };

  const primary = enforce(maxPerCategory);
  if (primary.length >= 5 || maxPerCategory >= 3) {
    return primary;
  }

  return enforce(3);
}

export async function withTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<T>,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((resolve, reject) => {
    handle = setTimeout(() => {
      void onTimeout().then(resolve).catch(reject);
    }, timeoutMs);
  });

  try {
    return await Promise.race([action(), timeoutPromise]);
  } finally {
    if (handle) {
      clearTimeout(handle);
    }
  }
}

@Injectable()
export class PromotionRecommendationService {
  private readonly logger = new Logger(PromotionRecommendationService.name);

  private readonly popularityCache = new BoundedCache<string, ProductCandidate[]>({
    maxSize: 64,
    ttlMs: POPULARITY_CACHE_TTL_MS,
  });

  constructor(
    @InjectModel(UserProfile.name)
    private readonly userProfileModel: Model<UserProfileDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly discountCampaignsService: DiscountCampaignsService,
    private readonly inventoryService: InventoryService,
    private readonly inventoryPromotionService: InventoryPromotionService,
    private readonly promotionConfigService: PromotionConfigService,
  ) {}

  private toObjectId(value: string): Types.ObjectId | null {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
  }

  private toProfile(plain: Record<string, unknown>): RecommendationProfile {
    const topCategoryIds = Array.isArray(plain.topCategoryIds)
      ? plain.topCategoryIds.map((id) => String(id))
      : [];

    const categoryAffinities = Array.isArray(plain.categoryAffinities)
      ? plain.categoryAffinities.map((entry) => {
          const row = entry as Record<string, unknown>;
          return {
            categoryId: String(row.categoryId),
            score: Number(row.score ?? 0),
          };
        })
      : [];

    const priceRange = (plain.preferredPriceRange ?? {}) as Record<string, unknown>;

    return {
      userId: String(plain.userId),
      topCategoryIds,
      categoryAffinities,
      preferredPriceRange: {
        min: Number(priceRange.min ?? 0),
        max: Number(priceRange.max ?? 0),
      },
      isNewUser: Boolean(plain.isNewUser),
    };
  }

  private buildUserVector(profile: RecommendationProfile): SparseVector {
    const vector: SparseVector = {};

    profile.categoryAffinities.forEach((affinity) => {
      if (!affinity.categoryId || affinity.score <= 0) {
        return;
      }
      vector[affinity.categoryId] = affinity.score;
    });

    return vector;
  }

  private async getExpandedCategoryIds(topCategoryIds: string[]): Promise<string[]> {
    const topObjectIds = topCategoryIds
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);

    if (topObjectIds.length === 0) {
      return [];
    }

    const roots = await this.categoryModel
      .aggregate<{ categoryId: Types.ObjectId; parentId?: Types.ObjectId }>([
        {
          $match: {
            _id: { $in: topObjectIds },
          },
        },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
            parentId: { $ifNull: ['$parentCategoryId', '$parentId'] },
          },
        },
      ])
      .exec();

    const parentIds = Array.from(
      new Set(
        roots
          .map((row) => (row.parentId ? String(row.parentId) : null))
          .filter((value): value is string => Boolean(value)),
      ),
    )
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);

    if (parentIds.length === 0) {
      return topCategoryIds;
    }

    const related = await this.categoryModel
      .aggregate<{ categoryId: Types.ObjectId }>([
        {
          $match: {
            $or: [
              { _id: { $in: topObjectIds } },
              { _id: { $in: parentIds } },
              { parentCategoryId: { $in: parentIds } },
              { parentId: { $in: parentIds } },
            ],
          },
        },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
          },
        },
      ])
      .exec();

    return Array.from(new Set(related.map((row) => String(row.categoryId))));
  }

  private async getRecentOrderedCategoryIds(userId: string): Promise<Set<string>> {
    const userObjectId = this.toObjectId(userId);
    if (!userObjectId) {
      return new Set();
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await this.orderModel
      .aggregate<RecentCategoryRow>([
        {
          $match: {
            userId: userObjectId,
            status: { $in: COMPLETED_ORDER_STATUSES },
            updatedAt: { $gte: since },
          },
        },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: '$product' },
        {
          $match: {
            'product.categoryId': { $ne: null },
          },
        },
        {
          $group: {
            _id: '$product.categoryId',
          },
        },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
          },
        },
      ])
      .exec();

    return new Set(rows.map((row) => String(row.categoryId)));
  }

  async generateCandidates(
    userProfile: RecommendationProfile,
    limit = CANDIDATE_LIMIT,
  ): Promise<ProductCandidate[]> {
    const topCategoryObjectIds = userProfile.topCategoryIds
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);

    if (topCategoryObjectIds.length === 0) {
      return [];
    }

    const baseProducts = await this.productModel
      .find({
        categoryId: { $in: topCategoryObjectIds },
        status: { $in: ['active', 'ACTIVE'] },
      })
      .select('_id name price categoryId image')
      .limit(limit)
      .lean()
      .exec();

    let productRows = [...baseProducts];

    if (productRows.length < MIN_CANDIDATES_BEFORE_EXPANSION) {
      const expandedCategoryIds = await this.getExpandedCategoryIds(
        userProfile.topCategoryIds,
      );
      const expandedObjectIds = expandedCategoryIds
        .map((id) => this.toObjectId(id))
        .filter((id): id is Types.ObjectId => id !== null);

      if (expandedObjectIds.length > 0 && productRows.length < limit) {
        const existingIds = productRows.map((row) => row._id);

        const extraProducts = await this.productModel
          .find({
            categoryId: { $in: expandedObjectIds },
            status: { $in: ['active', 'ACTIVE'] },
            _id: { $nin: existingIds },
          })
          .select('_id name price categoryId image')
          .limit(limit - productRows.length)
          .lean()
          .exec();

        productRows = productRows.concat(extraProducts);
      }
    }

    return Promise.all(
      productRows.map(async (row) => {
        const productId = String(row._id);
        const inventorySnapshot = await this.inventoryService
          .findByProductId(productId)
          .catch(() => null);

        const stockLevel = Number(inventorySnapshot?.quantity ?? 0);
        const threshold = Number(inventorySnapshot?.lowStockThreshold ?? 10);

        const inventoryState =
          await this.inventoryPromotionService.getInventoryStateForProduct(
            productId,
            stockLevel,
            threshold,
          );

        return {
          productId,
          name: String(row.name),
          image: String(row.image ?? ''),
          price: Number(row.price ?? 0),
          categoryId: String(row.categoryId),
          stockLevel,
          score: 0,
          inventoryState,
          isAdminForced: false,
        };
      }),
    );
  }

  async validateStockAtDelivery(
    candidates: ProductCandidate[],
  ): Promise<ProductCandidate[]> {
    const validated = await Promise.all(
      candidates.map(async (candidate) => {
        const inventorySnapshot = await this.inventoryService
          .findByProductId(candidate.productId)
          .catch(() => null);

        if (!inventorySnapshot || inventorySnapshot.quantity <= 0) {
          return null;
        }

        const currentStock = Number(inventorySnapshot.quantity);
        const threshold = Number(inventorySnapshot.lowStockThreshold ?? 10);

        const inventoryState =
          await this.inventoryPromotionService.getInventoryStateForProduct(
            candidate.productId,
            currentStock,
            threshold,
          );

        return {
          ...candidate,
          stockLevel: currentStock,
          inventoryState,
        };
      }),
    );

    const output = validated.filter(
      (candidate): candidate is ProductCandidate => candidate !== null,
    );

    const removed = candidates.length - output.length;
    if (removed > 0) {
      this.logger.log(
        `Removed ${removed} out-of-stock recommendations at delivery check.`,
      );
    }

    return output;
  }

  private getPromotionReason(candidate: ProductCandidate): string {
    if (candidate.inventoryState === InventoryState.LOW) {
      return 'Limited stock remaining';
    }

    if (candidate.inventoryState === InventoryState.OVERSTOCK) {
      return 'Great availability - order now';
    }

    return 'Popular in your favorite category';
  }

  formatRecommendations(candidates: ProductCandidate[]): PromotionDto[] {
    return candidates.map((candidate) => ({
      productId: candidate.productId,
      productName: candidate.name,
      image: candidate.image,
      categoryId: candidate.categoryId,
      price: Number(candidate.price.toFixed(2)),
      displayPrice: Number(candidate.price.toFixed(2)),
      discountPercent: null,
      discountAmount: null,
      stockLevel: candidate.stockLevel,
      promotionReason: this.getPromotionReason(candidate),
      score: Number(candidate.score.toFixed(6)),
      isAdminForced: candidate.isAdminForced,
    }));
  }

  private async applyDiscountPreviews(
    recommendations: PromotionDto[],
    userId?: string,
  ): Promise<PromotionDto[]> {
    if (recommendations.length === 0) {
      return recommendations;
    }

    const previews = await this.discountCampaignsService.getProductDiscountPreviews(
      recommendations.map((item) => ({
        productId: item.productId,
        categoryId: item.categoryId,
        unitPrice: item.price,
      })),
      userId,
    );

    return recommendations.map((item) => {
      const preview = previews.get(item.productId);

      if (!preview) {
        return item;
      }

      return {
        ...item,
        displayPrice: Number(preview.discountedPrice.toFixed(2)),
        discountPercent: Number(preview.discountPercent.toFixed(2)),
        discountAmount: Number(preview.discountAmount.toFixed(2)),
      };
    });
  }

  private async getPopularityCandidates(
    limit = CANDIDATE_LIMIT,
    bypassCache = false,
  ): Promise<ProductCandidate[]> {
    if (!bypassCache) {
      const cached = this.popularityCache.get(POPULARITY_CACHE_KEY);
      if (cached) {
        return cached.map((candidate) => ({ ...candidate }));
      }
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.orderModel
      .aggregate<PopularProductRow>([
        {
          $match: {
            status: { $in: COMPLETED_ORDER_STATUSES },
            createdAt: { $gte: since },
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            popularity: { $sum: '$items.quantity' },
          },
        },
        {
          $sort: {
            popularity: -1,
          },
        },
        {
          $limit: limit * 2,
        },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            popularity: 1,
          },
        },
      ])
      .exec();

    if (rows.length === 0) {
      return [];
    }

    const productIds = rows.map((row) => row.productId);

    const products = await this.productModel
      .find({
        _id: { $in: productIds },
        status: { $in: ['active', 'ACTIVE'] },
        categoryId: { $ne: null },
      })
      .select('_id name price categoryId image')
      .lean()
      .exec();

    const productById = new Map<string, Record<string, unknown>>();
    products.forEach((product) => {
      productById.set(String(product._id), product as Record<string, unknown>);
    });

    const maxPopularity = Math.max(...rows.map((row) => row.popularity), 1);

    const candidates = (
      await Promise.all(
        rows.slice(0, limit).map(async (row) => {
          const product = productById.get(String(row.productId));
          if (!product) {
            return null;
          }

          const productId = String(product._id);
          const inventorySnapshot = await this.inventoryService
            .findByProductId(productId)
            .catch(() => null);

          const stockLevel = Number(inventorySnapshot?.quantity ?? 0);
          const threshold = Number(inventorySnapshot?.lowStockThreshold ?? 10);

          const inventoryState =
            await this.inventoryPromotionService.getInventoryStateForProduct(
              productId,
              stockLevel,
              threshold,
            );

          return {
            productId,
            name: String(product.name),
            image: String(product.image ?? ''),
            price: Number(product.price ?? 0),
            categoryId: String(product.categoryId),
            stockLevel,
            score: Number((row.popularity / maxPopularity).toFixed(6)),
            inventoryState,
            isAdminForced: false,
          };
        }),
      )
    ).filter((candidate): candidate is ProductCandidate => candidate !== null);

    this.popularityCache.set(POPULARITY_CACHE_KEY, candidates);
    return candidates.map((candidate) => ({ ...candidate }));
  }

  private async getProfile(userId: string): Promise<RecommendationProfile | null> {
    const userObjectId = this.toObjectId(userId);
    if (!userObjectId) {
      return null;
    }

    const profile = await this.userProfileModel
      .findOne({ userId: userObjectId })
      .lean()
      .exec();

    if (!profile) {
      return null;
    }

    return this.toProfile(profile as Record<string, unknown>);
  }

  private buildDebug(
    includeDebug: boolean | undefined,
    candidateCount: number,
    filteredCount: number,
    rankingDuration: number,
  ): RecommendationDebug | undefined {
    if (!includeDebug) {
      return undefined;
    }

    return {
      candidateCount,
      filteredCount,
      rankingDuration,
    };
  }

  async getPopularityBasedRecommendations(
    options: RecommendationOptions = {},
    userId?: string,
  ): Promise<RecommendationPipelineResult> {
    const config = await this.promotionConfigService.getRuleConfig();

    if (!config.enabled) {
      return {
        recommendations: [],
        source: 'popular',
        debug: this.buildDebug(options.includeDebug, 0, 0, 0),
      };
    }

    const baselineProfile: RecommendationProfile = {
      userId: 'cold-start',
      topCategoryIds: [],
      categoryAffinities: [],
      preferredPriceRange: { min: 0, max: 0 },
      isNewUser: true,
    };

    const candidates = await this.getPopularityCandidates(
      CANDIDATE_LIMIT,
      Boolean(options.bypassPopularityCache),
    );
    const candidateCount = candidates.length;

    const rulesApplied = applyBusinessRules(candidates, baselineProfile, config).sort(
      (left, right) => right.score - left.score,
    );
    const filteredCount = rulesApplied.length;

    const diversified = applyDiversityConstraint(rulesApplied, config.diversityLimit);
    const limited = diversified.slice(0, config.maxRecommendations);
    const inStock = await this.validateStockAtDelivery(limited);

    const recommendations = await this.applyDiscountPreviews(
      this.formatRecommendations(inStock),
      userId,
    );

    return {
      recommendations,
      source: 'popular',
      debug: this.buildDebug(options.includeDebug, candidateCount, filteredCount, 0),
    };
  }

  async getRecommendations(
    userId: string,
    options: RecommendationOptions = {},
  ): Promise<RecommendationPipelineResult> {
    const profile = await this.getProfile(userId);

    if (!profile || profile.isNewUser) {
      return this.getPopularityBasedRecommendations(options, userId);
    }

    const config = await this.promotionConfigService.getRuleConfig();
    if (!config.enabled) {
      return {
        recommendations: [],
        source: 'popular',
        debug: this.buildDebug(options.includeDebug, 0, 0, 0),
      };
    }

    try {
      const candidates = await this.generateCandidates(profile, CANDIDATE_LIMIT);
      const candidateCount = candidates.length;

      const rulesApplied = applyBusinessRules(candidates, profile, config);
      const filteredCount = rulesApplied.length;

      const userVector = this.buildUserVector(profile);
      const recentCategories = await this.getRecentOrderedCategoryIds(userId);

      const rankingStartedAt = Date.now();
      const ranked = rankWithAI(rulesApplied, userVector, recentCategories);
      const rankingDuration = Date.now() - rankingStartedAt;

      const diversified = applyDiversityConstraint(ranked, config.diversityLimit);
      const limited = diversified.slice(0, config.maxRecommendations);

      const inStock = await this.validateStockAtDelivery(limited);
      const recommendations = await this.applyDiscountPreviews(
        this.formatRecommendations(inStock),
        userId,
      );

      return {
        recommendations,
        source: 'personalized',
        debug: this.buildDebug(
          options.includeDebug,
          candidateCount,
          filteredCount,
          rankingDuration,
        ),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown recommendation error';
      this.logger.warn(
        `Recommendation pipeline failed for user ${userId}; using popularity fallback. ${message}`,
      );

      return this.getPopularityBasedRecommendations(options, userId);
    }
  }
}
