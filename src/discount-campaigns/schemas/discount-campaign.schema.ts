import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type DiscountCampaignDocument = HydratedDocument<DiscountCampaign>;

export enum DiscountCampaignScope {
  ALL_USERS = 'ALL_USERS',
  CATEGORY = 'CATEGORY',
  PRODUCT_SET = 'PRODUCT_SET',
}

export enum DiscountType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export enum DiscountCampaignStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
}

@Schema({ collection: 'discount_campaigns', timestamps: true })
export class DiscountCampaign {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    enum: DiscountCampaignScope,
    index: true,
  })
  scope: DiscountCampaignScope;

  @Prop({
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Product',
    default: [],
  })
  productIds: mongoose.Types.ObjectId[];

  @Prop({
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Category',
    default: [],
  })
  categoryIds: mongoose.Types.ObjectId[];

  @Prop({
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: [],
  })
  targetUserIds: mongoose.Types.ObjectId[];

  @Prop({
    required: true,
    enum: DiscountType,
  })
  discountType: DiscountType;

  @Prop({ required: true, min: 0 })
  discountValue: number;

  @Prop({ type: Number, min: 0, default: null })
  minOrderAmount: number | null;

  @Prop({ type: Number, min: 1, default: null })
  maxRedemptions: number | null;

  @Prop({ required: true, type: Date })
  startsAt: Date;

  @Prop({ required: true, type: Date })
  endsAt: Date;

  @Prop({
    required: true,
    enum: DiscountCampaignStatus,
    default: DiscountCampaignStatus.DRAFT,
    index: true,
  })
  status: DiscountCampaignStatus;

  @Prop({ required: true, type: Boolean, default: false })
  stackable: boolean;
}

export const DiscountCampaignSchema =
  SchemaFactory.createForClass(DiscountCampaign);
applyCommonSchemaOptions(DiscountCampaignSchema);

DiscountCampaignSchema.index({ status: 1 });
DiscountCampaignSchema.index({ startsAt: 1, endsAt: 1 });
DiscountCampaignSchema.index({ targetUserIds: 1, status: 1 });
