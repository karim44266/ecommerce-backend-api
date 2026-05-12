import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type PromotionConversionDocument = HydratedDocument<PromotionConversion>;

@Schema({ collection: 'promotion_conversions', timestamps: true })
export class PromotionConversion {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null })
  userId: mongoose.Types.ObjectId | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true })
  productId: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  sessionId: string;

  @Prop({ type: Date, required: true })
  impressedAt: Date;

  @Prop({ type: Date, default: null })
  clickedAt: Date | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null })
  orderId: mongoose.Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  orderedAt: Date | null;

  @Prop({ type: String, default: 'popular' })
  source: string;

  @Prop({ type: Number, default: -1 })
  position: number;

  @Prop({ type: Boolean, default: false })
  isAdminForced: boolean;

  @Prop({ type: Boolean, default: false })
  converted: boolean;
}

export const PromotionConversionSchema =
  SchemaFactory.createForClass(PromotionConversion);
applyCommonSchemaOptions(PromotionConversionSchema);

PromotionConversionSchema.index({ userId: 1, converted: 1, impressedAt: -1 });
PromotionConversionSchema.index({ productId: 1, orderedAt: -1 });
