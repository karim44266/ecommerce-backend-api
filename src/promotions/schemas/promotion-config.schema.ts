import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type PromotionConfigDocument = HydratedDocument<PromotionConfig>;

@Schema({ collection: 'promotion_configs', timestamps: true })
export class PromotionConfig {
  @Prop({ required: true, unique: true, index: true, default: 'default' })
  configKey: string;

  @Prop({ type: [mongoose.Schema.Types.ObjectId], default: [] })
  suppressedProductIds: mongoose.Types.ObjectId[];

  @Prop({ type: [mongoose.Schema.Types.ObjectId], default: [] })
  forcedProductIds: mongoose.Types.ObjectId[];

  @Prop({ type: Number, min: 1, max: 50, default: 10 })
  maxRecommendations: number;

  @Prop({ type: Number, min: 1, max: 10, default: 2 })
  diversityLimit: number;

  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  @Prop({ type: Number, min: 0, max: 100, default: 0 })
  abTestSplitPercent: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null })
  updatedBy: mongoose.Types.ObjectId | null;
}

export const PromotionConfigSchema =
  SchemaFactory.createForClass(PromotionConfig);
applyCommonSchemaOptions(PromotionConfigSchema);

PromotionConfigSchema.index({ configKey: 1 }, { unique: true });
