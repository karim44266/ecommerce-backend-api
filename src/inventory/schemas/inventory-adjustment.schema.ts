import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type InventoryAdjustmentDocument = HydratedDocument<InventoryAdjustment>;

@Schema({ timestamps: true, collection: 'inventory_adjustments' })
export class InventoryAdjustment {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  })
  productId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  adjustment: number;

  @Prop({ type: String, default: null })
  reason: string | null;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  adjustedBy: mongoose.Types.ObjectId | null;
}

export const InventoryAdjustmentSchema =
  SchemaFactory.createForClass(InventoryAdjustment);
applyCommonSchemaOptions(InventoryAdjustmentSchema);
InventoryAdjustmentSchema.index({ productId: 1, createdAt: -1 });
