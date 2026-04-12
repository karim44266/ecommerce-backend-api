import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type ProductDocument = HydratedDocument<Product>;

@Schema({ _id: false })
export class InventoryInfo {
  @Prop({ default: 0 })
  quantity: number;

  @Prop({ default: 10 })
  lowStockThreshold: number;

  @Prop({ type: Date, default: null })
  lastAdjustedAt: Date | null;
}

export const InventoryInfoSchema = SchemaFactory.createForClass(InventoryInfo);

@Schema({ timestamps: true, collection: 'products' })
export class Product {
  @Prop({ required: true, index: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, index: true, trim: true })
  sku: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true, type: Number, min: 0 })
  price: number;

  @Prop({ type: Number, min: 0, default: 0 })
  costPrice: number;

  @Prop({ default: '' })
  image: string;

  @Prop({ default: 0 })
  inventory: number;

  @Prop({ default: 'active', index: true })
  status: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true,
  })
  categoryId: mongoose.Types.ObjectId | null;

  @Prop({ type: InventoryInfoSchema, default: () => ({}) })
  inventoryInfo: InventoryInfo;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
applyCommonSchemaOptions(ProductSchema);
ProductSchema.index({ name: 'text' });
