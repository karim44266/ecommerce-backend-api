import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateDiscountCampaignDto } from './dto/create-discount-campaign.dto';
import { UpdateDiscountCampaignDto } from './dto/update-discount-campaign.dto';
import {
  DiscountCampaign,
  DiscountCampaignDocument,
  DiscountCampaignScope,
  DiscountCampaignStatus,
  DiscountType,
} from './schemas/discount-campaign.schema';

interface CampaignDiscountCandidate {
  campaign: DiscountCampaignDocument;
  discountCents: number;
}

export interface DiscountPricingItemInput {
  productId: string;
  categoryId: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface DiscountPricingResult {
  subtotalCents: number;
  discountCents: number;
  finalTotalCents: number;
  appliedCampaignIds: string[];
  appliedCampaigns: Array<{
    id: string;
    name: string;
    discountCents: number;
    stackable: boolean;
  }>;
}

export interface ProductDiscountPreviewInput {
  productId: string;
  categoryId: string | null;
  unitPrice: number;
}

export interface ProductDiscountPreviewResult {
  campaignId: string;
  campaignName: string;
  discountType: DiscountType;
  discountValue: number;
  discountPercent: number;
  discountAmount: number;
  discountedPrice: number;
  minOrderAmount: number | null;
}

@Injectable()
export class DiscountCampaignsService {
  private readonly logger = new Logger(DiscountCampaignsService.name);

  constructor(
    @InjectModel(DiscountCampaign.name)
    private readonly campaignModel: Model<DiscountCampaignDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private toObjectId(value: string): Types.ObjectId | null {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
  }

  private normalizeLifecycleStatus(status: unknown): DiscountCampaignStatus {
    const normalized = String(status ?? '').toUpperCase();

    if (normalized === DiscountCampaignStatus.ACTIVE) {
      return DiscountCampaignStatus.ACTIVE;
    }

    if (normalized === DiscountCampaignStatus.EXPIRED) {
      return DiscountCampaignStatus.EXPIRED;
    }

    return DiscountCampaignStatus.DRAFT;
  }

  private async normalizeLegacyStatuses(): Promise<number> {
    const result = await this.campaignModel.updateMany(
      {
        status: {
          $nin: [
            DiscountCampaignStatus.DRAFT,
            DiscountCampaignStatus.ACTIVE,
            DiscountCampaignStatus.EXPIRED,
          ],
        },
      },
      {
        $set: {
          status: DiscountCampaignStatus.DRAFT,
        },
      },
    );

    return result.modifiedCount;
  }

  private toResponse(
    campaign: DiscountCampaignDocument | Record<string, unknown>,
  ): Record<string, unknown> {
    const plain =
      typeof (campaign as DiscountCampaignDocument).toJSON === 'function'
        ? ((campaign as DiscountCampaignDocument).toJSON() as Record<
            string,
            unknown
          >)
        : campaign;

    return {
      ...plain,
      status: this.normalizeLifecycleStatus(plain.status),
      productIds: Array.isArray(plain.productIds)
        ? plain.productIds.map((id) => String(id))
        : [],
      categoryIds: Array.isArray(plain.categoryIds)
        ? plain.categoryIds.map((id) => String(id))
        : [],
      targetUserIds: Array.isArray(plain.targetUserIds)
        ? plain.targetUserIds.map((id) => String(id))
        : [],
    };
  }

  private parseDate(value: string | Date): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid campaign date provided');
    }
    return date;
  }

  private validateCampaignWindow(startsAt: Date, endsAt: Date): void {
    if (startsAt >= endsAt) {
      throw new BadRequestException('startsAt must be before endsAt');
    }
  }

  private validateDiscountValueByType(
    discountType: DiscountType,
    discountValue: number,
  ): void {
    if (discountValue <= 0) {
      throw new BadRequestException('discountValue must be greater than zero');
    }

    if (discountType === DiscountType.PERCENT && discountValue > 100) {
      throw new BadRequestException(
        'Percent discountValue cannot be greater than 100',
      );
    }
  }

  private normalizeObjectIds(ids?: string[]): Types.ObjectId[] {
    if (!ids || ids.length === 0) {
      return [];
    }

    const deduped = Array.from(new Set(ids));
    const objectIds = deduped.map((id) => this.toObjectId(id));

    if (objectIds.some((id) => id === null)) {
      throw new BadRequestException('One or more provided IDs are invalid');
    }

    return objectIds as Types.ObjectId[];
  }

  private validateScopePayload(
    scope: DiscountCampaignScope,
    productIds: Types.ObjectId[],
    categoryIds: Types.ObjectId[],
  ): void {
    if (scope === DiscountCampaignScope.PRODUCT_SET && productIds.length === 0) {
      throw new BadRequestException(
        'productIds is required when scope is PRODUCT_SET',
      );
    }

    if (scope === DiscountCampaignScope.CATEGORY && categoryIds.length === 0) {
      throw new BadRequestException(
        'categoryIds is required when scope is CATEGORY',
      );
    }
  }

  private async validateReferencedEntities(
    productIds: Types.ObjectId[],
    categoryIds: Types.ObjectId[],
    targetUserIds: Types.ObjectId[],
  ): Promise<void> {
    if (productIds.length > 0) {
      const productCount = await this.productModel.countDocuments({
        _id: { $in: productIds },
      });

      if (productCount !== productIds.length) {
        throw new BadRequestException(
          'One or more productIds do not reference an existing product',
        );
      }
    }

    if (categoryIds.length > 0) {
      const categoryCount = await this.categoryModel.countDocuments({
        _id: { $in: categoryIds },
      });

      if (categoryCount !== categoryIds.length) {
        throw new BadRequestException(
          'One or more categoryIds do not reference an existing category',
        );
      }
    }

    if (targetUserIds.length > 0) {
      const userCount = await this.userModel.countDocuments({
        _id: { $in: targetUserIds },
      });

      if (userCount !== targetUserIds.length) {
        throw new BadRequestException(
          'One or more targetUserIds do not reference an existing user',
        );
      }
    }
  }

  private async getByIdOrThrow(id: string): Promise<DiscountCampaignDocument> {
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) {
      throw new NotFoundException('Discount campaign not found');
    }

    return campaign;
  }

  private async getCampaignRedemptionCounts(
    campaignIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (campaignIds.length === 0) {
      return new Map();
    }

    const rows = await this.orderModel
      .aggregate<{ campaignId: Types.ObjectId; count: number }>([
        {
          $match: {
            status: { $ne: 'CANCELLED' },
            appliedDiscountCampaignIds: { $in: campaignIds },
          },
        },
        { $unwind: '$appliedDiscountCampaignIds' },
        {
          $match: {
            appliedDiscountCampaignIds: { $in: campaignIds },
          },
        },
        {
          $group: {
            _id: '$appliedDiscountCampaignIds',
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            campaignId: '$_id',
            count: 1,
          },
        },
      ])
      .exec();

    const counts = new Map<string, number>();
    rows.forEach((row) => {
      counts.set(String(row.campaignId), Number(row.count ?? 0));
    });

    return counts;
  }

  private buildActiveCampaignFilter(
    userId: string | undefined,
    now: Date,
  ): Record<string, unknown> {
    const userObjectId = userId ? this.toObjectId(userId) : null;

    const filter: Record<string, unknown> = {
      status: DiscountCampaignStatus.ACTIVE,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    };

    filter.$or = userObjectId
      ? [
          { targetUserIds: { $exists: false } },
          { targetUserIds: { $size: 0 } },
          { targetUserIds: userObjectId },
        ]
      : [
          { targetUserIds: { $exists: false } },
          { targetUserIds: { $size: 0 } },
        ];

    return filter;
  }

  private getEligibleSubtotalCents(
    campaign: DiscountCampaignDocument,
    items: DiscountPricingItemInput[],
    orderSubtotalCents: number,
  ): number {
    if (campaign.scope === DiscountCampaignScope.ALL_USERS) {
      return orderSubtotalCents;
    }

    if (campaign.scope === DiscountCampaignScope.CATEGORY) {
      const categoryIdSet = new Set(
        campaign.categoryIds.map((categoryId) => String(categoryId)),
      );

      return items.reduce((sum, item) => {
        if (!item.categoryId || !categoryIdSet.has(item.categoryId)) {
          return sum;
        }

        return sum + item.unitPriceCents * item.quantity;
      }, 0);
    }

    if (campaign.scope === DiscountCampaignScope.PRODUCT_SET) {
      const productIdSet = new Set(
        campaign.productIds.map((productId) => String(productId)),
      );

      return items.reduce((sum, item) => {
        if (!productIdSet.has(item.productId)) {
          return sum;
        }

        return sum + item.unitPriceCents * item.quantity;
      }, 0);
    }

    return 0;
  }

  private computeCampaignDiscountCents(
    campaign: DiscountCampaignDocument,
    eligibleSubtotalCents: number,
  ): number {
    if (eligibleSubtotalCents <= 0) {
      return 0;
    }

    if (campaign.discountType === DiscountType.PERCENT) {
      const rawDiscount = Math.round(
        eligibleSubtotalCents * (campaign.discountValue / 100),
      );
      return Math.max(0, Math.min(rawDiscount, eligibleSubtotalCents));
    }

    const fixedDiscountCents = Math.round(campaign.discountValue * 100);
    return Math.max(0, Math.min(fixedDiscountCents, eligibleSubtotalCents));
  }

  private selectCampaigns(
    candidates: CampaignDiscountCandidate[],
  ): CampaignDiscountCandidate[] {
    if (candidates.length === 0) {
      return [];
    }

    const nonStackable = candidates.filter((candidate) => !candidate.campaign.stackable);
    if (nonStackable.length > 0) {
      nonStackable.sort((left, right) => {
        if (right.discountCents !== left.discountCents) {
          return right.discountCents - left.discountCents;
        }

        return (
          new Date(left.campaign.endsAt).getTime() -
          new Date(right.campaign.endsAt).getTime()
        );
      });

      return [nonStackable[0]];
    }

    return candidates
      .filter((candidate) => candidate.campaign.stackable)
      .sort((left, right) => right.discountCents - left.discountCents);
  }

  async calculatePricing(
    items: DiscountPricingItemInput[],
    userId?: string,
    now = new Date(),
  ): Promise<DiscountPricingResult> {
    const normalizedItems = items
      .filter((item) => item.quantity > 0 && item.unitPriceCents > 0)
      .map((item) => ({
        ...item,
        productId: String(item.productId),
        categoryId: item.categoryId ? String(item.categoryId) : null,
      }));

    const subtotalCents = normalizedItems.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );

    if (subtotalCents <= 0) {
      return {
        subtotalCents: 0,
        discountCents: 0,
        finalTotalCents: 0,
        appliedCampaignIds: [],
        appliedCampaigns: [],
      };
    }

    await this.autoExpireCampaigns(now);

    const activeCampaigns = await this.campaignModel
      .find(this.buildActiveCampaignFilter(userId, now))
      .sort({ createdAt: -1 })
      .exec();

    if (activeCampaigns.length === 0) {
      return {
        subtotalCents,
        discountCents: 0,
        finalTotalCents: subtotalCents,
        appliedCampaignIds: [],
        appliedCampaigns: [],
      };
    }

    const redemptionCounts = await this.getCampaignRedemptionCounts(
      activeCampaigns.map((campaign) => campaign._id as Types.ObjectId),
    );

    const candidates: CampaignDiscountCandidate[] = [];

    for (const campaign of activeCampaigns) {
      if (campaign.maxRedemptions !== null && campaign.maxRedemptions !== undefined) {
        const used = redemptionCounts.get(String(campaign._id)) ?? 0;
        if (used >= campaign.maxRedemptions) {
          continue;
        }
      }

      if (campaign.minOrderAmount !== null && campaign.minOrderAmount !== undefined) {
        const minOrderAmountCents = Math.round(campaign.minOrderAmount * 100);
        if (subtotalCents < minOrderAmountCents) {
          continue;
        }
      }

      const eligibleSubtotalCents = this.getEligibleSubtotalCents(
        campaign,
        normalizedItems,
        subtotalCents,
      );

      const discountCents = this.computeCampaignDiscountCents(
        campaign,
        eligibleSubtotalCents,
      );

      if (discountCents <= 0) {
        continue;
      }

      candidates.push({
        campaign,
        discountCents,
      });
    }

    const selectedCampaigns = this.selectCampaigns(candidates);

    const rawDiscountCents = selectedCampaigns.reduce(
      (sum, candidate) => sum + candidate.discountCents,
      0,
    );

    const discountCents = Math.max(0, Math.min(rawDiscountCents, subtotalCents));
    const finalTotalCents = subtotalCents - discountCents;

    return {
      subtotalCents,
      discountCents,
      finalTotalCents,
      appliedCampaignIds: selectedCampaigns.map((candidate) =>
        String(candidate.campaign._id),
      ),
      appliedCampaigns: selectedCampaigns.map((candidate) => ({
        id: String(candidate.campaign._id),
        name: candidate.campaign.name,
        discountCents: candidate.discountCents,
        stackable: candidate.campaign.stackable,
      })),
    };
  }

  async getProductDiscountPreviews(
    items: ProductDiscountPreviewInput[],
    userId?: string,
    now = new Date(),
  ): Promise<Map<string, ProductDiscountPreviewResult>> {
    const normalizedByProduct = new Map<
      string,
      {
        productId: string;
        categoryId: string | null;
        unitPriceCents: number;
      }
    >();

    items.forEach((item) => {
      const productId = String(item.productId);
      const unitPriceCents = Math.round(Number(item.unitPrice ?? 0) * 100);

      if (!productId || unitPriceCents <= 0) {
        return;
      }

      normalizedByProduct.set(productId, {
        productId,
        categoryId: item.categoryId ? String(item.categoryId) : null,
        unitPriceCents,
      });
    });

    if (normalizedByProduct.size === 0) {
      return new Map();
    }

    await this.autoExpireCampaigns(now);

    const activeCampaigns = await this.campaignModel
      .find(this.buildActiveCampaignFilter(userId, now))
      .sort({ createdAt: -1 })
      .exec();

    if (activeCampaigns.length === 0) {
      return new Map();
    }

    const redemptionCounts = await this.getCampaignRedemptionCounts(
      activeCampaigns.map((campaign) => campaign._id as Types.ObjectId),
    );

    const previews = new Map<string, ProductDiscountPreviewResult>();

    normalizedByProduct.forEach((item) => {
      const candidates: CampaignDiscountCandidate[] = [];

      for (const campaign of activeCampaigns) {
        if (
          campaign.maxRedemptions !== null &&
          campaign.maxRedemptions !== undefined
        ) {
          const used = redemptionCounts.get(String(campaign._id)) ?? 0;
          if (used >= campaign.maxRedemptions) {
            continue;
          }
        }

        const eligibleSubtotalCents = this.getEligibleSubtotalCents(
          campaign,
          [
            {
              productId: item.productId,
              categoryId: item.categoryId,
              quantity: 1,
              unitPriceCents: item.unitPriceCents,
            },
          ],
          item.unitPriceCents,
        );

        if (eligibleSubtotalCents <= 0) {
          continue;
        }

        const discountCents = this.computeCampaignDiscountCents(
          campaign,
          eligibleSubtotalCents,
        );

        if (discountCents <= 0) {
          continue;
        }

        candidates.push({
          campaign,
          discountCents,
        });
      }

      if (candidates.length === 0) {
        return;
      }

      const selected = this.selectCampaigns(candidates);
      const totalDiscountCents = Math.min(
        item.unitPriceCents,
        selected.reduce((sum, candidate) => sum + candidate.discountCents, 0),
      );

      if (totalDiscountCents <= 0) {
        return;
      }

      const primaryCampaign = selected[0]?.campaign;
      if (!primaryCampaign) {
        return;
      }

      const discountPercent = Number(
        ((totalDiscountCents / item.unitPriceCents) * 100).toFixed(2),
      );

      previews.set(item.productId, {
        campaignId: String(primaryCampaign._id),
        campaignName: primaryCampaign.name,
        discountType: primaryCampaign.discountType,
        discountValue: Number(primaryCampaign.discountValue ?? 0),
        discountPercent,
        discountAmount: Number((totalDiscountCents / 100).toFixed(2)),
        discountedPrice: Number(
          ((item.unitPriceCents - totalDiscountCents) / 100).toFixed(2),
        ),
        minOrderAmount:
          primaryCampaign.minOrderAmount !== null &&
          primaryCampaign.minOrderAmount !== undefined
            ? Number(primaryCampaign.minOrderAmount)
            : null,
      });
    });

    return previews;
  }

  async autoExpireCampaigns(now = new Date()): Promise<number> {
    const normalizedCount = await this.normalizeLegacyStatuses();
    if (normalizedCount > 0) {
      this.logger.log(
        `Normalized ${normalizedCount} legacy discount campaign status value(s) to DRAFT.`,
      );
    }

    const result = await this.campaignModel.updateMany(
      {
        status: { $ne: DiscountCampaignStatus.EXPIRED },
        endsAt: { $lte: now },
      },
      {
        $set: {
          status: DiscountCampaignStatus.EXPIRED,
        },
      },
    );

    return result.modifiedCount;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runAutoExpireJob(): Promise<void> {
    const modifiedCount = await this.autoExpireCampaigns();
    if (modifiedCount > 0) {
      this.logger.log(`Auto-expired ${modifiedCount} discount campaign(s).`);
    }
  }

  async create(dto: CreateDiscountCampaignDto) {
    await this.autoExpireCampaigns();

    const startsAt = this.parseDate(dto.startsAt);
    const endsAt = this.parseDate(dto.endsAt);
    this.validateCampaignWindow(startsAt, endsAt);
    this.validateDiscountValueByType(dto.discountType, dto.discountValue);

    const scope = dto.scope;
    const productIds =
      scope === DiscountCampaignScope.PRODUCT_SET
        ? this.normalizeObjectIds(dto.productIds)
        : [];
    const categoryIds =
      scope === DiscountCampaignScope.CATEGORY
        ? this.normalizeObjectIds(dto.categoryIds)
        : [];
    const targetUserIds = this.normalizeObjectIds(dto.targetUserIds);

    this.validateScopePayload(scope, productIds, categoryIds);
    await this.validateReferencedEntities(productIds, categoryIds, targetUserIds);

    const now = new Date();
    const requestedStatus = this.normalizeLifecycleStatus(
      dto.status ?? DiscountCampaignStatus.DRAFT,
    );
    const derivedStatus =
      endsAt <= now ? DiscountCampaignStatus.EXPIRED : requestedStatus;

    const created = await this.campaignModel.create({
      name: dto.name.trim(),
      scope,
      productIds,
      categoryIds,
      targetUserIds,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      minOrderAmount: dto.minOrderAmount ?? null,
      maxRedemptions: dto.maxRedemptions ?? null,
      startsAt,
      endsAt,
      status: derivedStatus,
      stackable: dto.stackable ?? false,
    });

    return this.toResponse(created);
  }

  async findAll() {
    await this.autoExpireCampaigns();

    const campaigns = await this.campaignModel
      .find()
      .sort({ updatedAt: -1, createdAt: -1 });

    return campaigns.map((campaign) => this.toResponse(campaign));
  }

  async update(id: string, dto: UpdateDiscountCampaignDto) {
    await this.autoExpireCampaigns();

    const existing = await this.getByIdOrThrow(id);

    const startsAt = this.parseDate(dto.startsAt ?? existing.startsAt);
    const endsAt = this.parseDate(dto.endsAt ?? existing.endsAt);
    this.validateCampaignWindow(startsAt, endsAt);

    const scope = dto.scope ?? existing.scope;
    const existingProductIds = existing.productIds.map((entry) => String(entry));
    const existingCategoryIds = existing.categoryIds.map((entry) => String(entry));
    const existingTargetUserIds = Array.isArray(existing.targetUserIds)
      ? existing.targetUserIds.map((entry) => String(entry))
      : [];

    const productIds =
      scope === DiscountCampaignScope.PRODUCT_SET
        ? this.normalizeObjectIds(dto.productIds ?? existingProductIds)
        : [];

    const categoryIds =
      scope === DiscountCampaignScope.CATEGORY
        ? this.normalizeObjectIds(dto.categoryIds ?? existingCategoryIds)
        : [];
    const targetUserIds = this.normalizeObjectIds(
      dto.targetUserIds ?? existingTargetUserIds,
    );

    this.validateScopePayload(scope, productIds, categoryIds);
    await this.validateReferencedEntities(
      productIds,
      categoryIds,
      targetUserIds,
    );

    const now = new Date();
    const discountType = dto.discountType ?? existing.discountType;
    const discountValue = dto.discountValue ?? existing.discountValue;
    this.validateDiscountValueByType(discountType, discountValue);

    const requestedStatus = this.normalizeLifecycleStatus(
      dto.status ?? existing.status,
    );
    const derivedStatus =
      endsAt <= now ? DiscountCampaignStatus.EXPIRED : requestedStatus;

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            scope,
            productIds,
            categoryIds,
            targetUserIds,
            ...(dto.discountType !== undefined
              ? { discountType: dto.discountType }
              : {}),
            ...(dto.discountValue !== undefined
              ? { discountValue: dto.discountValue }
              : {}),
            ...(dto.minOrderAmount !== undefined
              ? { minOrderAmount: dto.minOrderAmount }
              : {}),
            ...(dto.maxRedemptions !== undefined
              ? { maxRedemptions: dto.maxRedemptions }
              : {}),
            startsAt,
            endsAt,
            status: derivedStatus,
            ...(dto.stackable !== undefined ? { stackable: dto.stackable } : {}),
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Discount campaign not found');
    }

    return this.toResponse(updated);
  }

  async remove(id: string) {
    const deleted = await this.campaignModel.findByIdAndDelete(id);
    if (!deleted) {
      throw new NotFoundException('Discount campaign not found');
    }

    return this.toResponse(deleted);
  }

  async activate(id: string) {
    await this.autoExpireCampaigns();

    const campaign = await this.getByIdOrThrow(id);
    const now = new Date();
    const currentStatus = this.normalizeLifecycleStatus(campaign.status);

    if (campaign.endsAt <= now) {
      await this.campaignModel.findByIdAndUpdate(id, {
        $set: { status: DiscountCampaignStatus.EXPIRED },
      });

      throw new BadRequestException('Cannot activate an expired campaign');
    }

    if (currentStatus === DiscountCampaignStatus.ACTIVE) {
      return this.toResponse(campaign);
    }

    if (currentStatus === DiscountCampaignStatus.EXPIRED) {
      throw new BadRequestException('Cannot activate an expired campaign');
    }

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: DiscountCampaignStatus.ACTIVE,
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Discount campaign not found');
    }

    return this.toResponse(updated);
  }

  async moveToDraft(id: string) {
    await this.autoExpireCampaigns();

    const campaign = await this.getByIdOrThrow(id);
    const currentStatus = this.normalizeLifecycleStatus(campaign.status);

    if (currentStatus === DiscountCampaignStatus.EXPIRED) {
      throw new BadRequestException('Cannot move an expired campaign to draft');
    }

    if (currentStatus === DiscountCampaignStatus.DRAFT) {
      return this.toResponse(campaign);
    }

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: DiscountCampaignStatus.DRAFT,
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Discount campaign not found');
    }

    return this.toResponse(updated);
  }
}
