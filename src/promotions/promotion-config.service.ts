import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { UpdatePromotionConfigDto } from './dto/update-promotion-config.dto';
import {
  PromotionConfig,
  PromotionConfigDocument,
} from './schemas/promotion-config.schema';
import { BoundedCache } from './utils/bounded-cache';

const DEFAULT_CONFIG_KEY = 'default';
const CONFIG_CACHE_KEY = 'promotion-config:default';

export interface PromotionConfigView {
  configKey: string;
  suppressedProductIds: string[];
  forcedProductIds: string[];
  maxRecommendations: number;
  diversityLimit: number;
  enabled: boolean;
  abTestSplitPercent: number;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export interface PromotionRuleConfig {
  suppressedProductIds: Set<string>;
  forcedProductIds: Set<string>;
  maxRecommendations: number;
  diversityLimit: number;
  enabled: boolean;
  abTestSplitPercent: number;
}

const DEFAULT_PROMOTION_CONFIG: PromotionConfigView = {
  configKey: DEFAULT_CONFIG_KEY,
  suppressedProductIds: [],
  forcedProductIds: [],
  maxRecommendations: 10,
  diversityLimit: 2,
  enabled: true,
  abTestSplitPercent: 0,
  updatedBy: null,
  updatedAt: null,
};

@Injectable()
export class PromotionConfigService {
  private readonly configCache = new BoundedCache<string, PromotionConfigView>({
    maxSize: 4,
    ttlMs: 5 * 60 * 1000,
  });

  constructor(
    @InjectModel(PromotionConfig.name)
    private readonly promotionConfigModel: Model<PromotionConfigDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  private toObjectId(value: string): Types.ObjectId | null {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
  }

  private normalize(
    source: Record<string, unknown> | null,
  ): PromotionConfigView {
    if (!source) {
      return { ...DEFAULT_PROMOTION_CONFIG };
    }

    const suppressedProductIds = Array.isArray(source.suppressedProductIds)
      ? source.suppressedProductIds.map((value) => String(value))
      : [];
    const forcedProductIds = Array.isArray(source.forcedProductIds)
      ? source.forcedProductIds.map((value) => String(value))
      : [];

    return {
      configKey: String(source.configKey ?? DEFAULT_CONFIG_KEY),
      suppressedProductIds,
      forcedProductIds,
      maxRecommendations: Number(
        source.maxRecommendations ?? DEFAULT_PROMOTION_CONFIG.maxRecommendations,
      ),
      diversityLimit: Number(
        source.diversityLimit ?? DEFAULT_PROMOTION_CONFIG.diversityLimit,
      ),
      enabled: Boolean(source.enabled ?? DEFAULT_PROMOTION_CONFIG.enabled),
      abTestSplitPercent: Number(
        source.abTestSplitPercent ?? DEFAULT_PROMOTION_CONFIG.abTestSplitPercent,
      ),
      updatedBy: source.updatedBy ? String(source.updatedBy) : null,
      updatedAt: source.updatedAt ? new Date(String(source.updatedAt)) : null,
    };
  }

  private invalidateCache(): void {
    this.configCache.clear();
  }

  async getConfig(): Promise<PromotionConfigView> {
    const cached = this.configCache.get(CONFIG_CACHE_KEY);
    if (cached) {
      return { ...cached };
    }

    const document = await this.promotionConfigModel
      .findOne({ configKey: DEFAULT_CONFIG_KEY })
      .lean()
      .exec();

    const normalized = this.normalize(document as Record<string, unknown> | null);
    this.configCache.set(CONFIG_CACHE_KEY, normalized);
    return { ...normalized };
  }

  async getRuleConfig(): Promise<PromotionRuleConfig> {
    const config = await this.getConfig();

    return {
      suppressedProductIds: new Set(config.suppressedProductIds),
      forcedProductIds: new Set(config.forcedProductIds),
      maxRecommendations: config.maxRecommendations,
      diversityLimit: config.diversityLimit,
      enabled: config.enabled,
      abTestSplitPercent: config.abTestSplitPercent,
    };
  }

  async isProductSuppressed(productId: string): Promise<boolean> {
    const config = await this.getRuleConfig();
    return config.suppressedProductIds.has(productId);
  }

  async isProductForced(productId: string): Promise<boolean> {
    const config = await this.getRuleConfig();
    return config.forcedProductIds.has(productId);
  }

  async validateProductIdsExist(productIds: string[]): Promise<string[]> {
    const deduped = Array.from(new Set(productIds));

    const checks = await Promise.all(
      deduped.map(async (productId) => {
        const objectId = this.toObjectId(productId);
        if (!objectId) {
          return { productId, exists: false };
        }

        const exists = await this.productModel.exists({ _id: objectId });
        return { productId, exists: Boolean(exists) };
      }),
    );

    return checks
      .filter((result) => !result.exists)
      .map((result) => result.productId);
  }

  async updateConfig(
    dto: UpdatePromotionConfigDto,
    updatedBy: string,
  ): Promise<PromotionConfigView> {
    const updatedByObjectId = this.toObjectId(updatedBy);

    const setPayload: Record<string, unknown> = {
      configKey: DEFAULT_CONFIG_KEY,
      ...(dto.suppressedProductIds
        ? {
            suppressedProductIds: dto.suppressedProductIds.map(
              (id) => new Types.ObjectId(id),
            ),
          }
        : {}),
      ...(dto.forcedProductIds
        ? {
            forcedProductIds: dto.forcedProductIds.map(
              (id) => new Types.ObjectId(id),
            ),
          }
        : {}),
      ...(dto.maxRecommendations !== undefined
        ? { maxRecommendations: dto.maxRecommendations }
        : {}),
      ...(dto.diversityLimit !== undefined
        ? { diversityLimit: dto.diversityLimit }
        : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.abTestSplitPercent !== undefined
        ? { abTestSplitPercent: dto.abTestSplitPercent }
        : {}),
      updatedBy: updatedByObjectId,
    };

    await this.promotionConfigModel.findOneAndUpdate(
      { configKey: DEFAULT_CONFIG_KEY },
      { $set: setPayload },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    this.invalidateCache();
    return this.getConfig();
  }

  async addSuppressedProduct(
    productId: string,
    updatedBy: string,
  ): Promise<PromotionConfigView> {
    const productObjectId = this.toObjectId(productId);
    const updatedByObjectId = this.toObjectId(updatedBy);

    if (!productObjectId) {
      return this.getConfig();
    }

    await this.promotionConfigModel.findOneAndUpdate(
      { configKey: DEFAULT_CONFIG_KEY },
      {
        $set: {
          configKey: DEFAULT_CONFIG_KEY,
          updatedBy: updatedByObjectId,
        },
        $addToSet: {
          suppressedProductIds: productObjectId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    this.invalidateCache();
    return this.getConfig();
  }

  async removeSuppressedProduct(
    productId: string,
    updatedBy: string,
  ): Promise<PromotionConfigView> {
    const productObjectId = this.toObjectId(productId);
    const updatedByObjectId = this.toObjectId(updatedBy);

    if (!productObjectId) {
      return this.getConfig();
    }

    await this.promotionConfigModel.findOneAndUpdate(
      { configKey: DEFAULT_CONFIG_KEY },
      {
        $set: {
          configKey: DEFAULT_CONFIG_KEY,
          updatedBy: updatedByObjectId,
        },
        $pull: {
          suppressedProductIds: productObjectId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    this.invalidateCache();
    return this.getConfig();
  }
}
