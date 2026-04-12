import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type OrderDocument = HydratedDocument<Order>;

@Schema()
export class OrderItem {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  })
  productId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  unitPrice: number;

  @Prop({ required: true, default: 0 })
  unitCost: number;
}

@Schema()
export class OrderStatusEntry {
  @Prop({ required: true })
  status: string;

  @Prop({ type: String, default: null })
  note: string | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null })
  changedBy: mongoose.Types.ObjectId | null;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

@Schema({ _id: false })
export class ShippingAddress {
  @Prop() fullName: string;
  @Prop() addressLine1: string;
  @Prop() addressLine2?: string;
  @Prop() city: string;
  @Prop() state: string;
  @Prop() postalCode: string;
  @Prop() country: string;
  @Prop() clientPhone: string;
  @Prop() clientEmail: string;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);
export const OrderStatusEntrySchema =
  SchemaFactory.createForClass(OrderStatusEntry);
export const ShippingAddressSchema =
  SchemaFactory.createForClass(ShippingAddress);

@Schema({ timestamps: true, collection: 'orders' })
export class Order {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  @Prop({ default: 'DRAFT', index: true })
  status: string;

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ type: ShippingAddressSchema, default: null })
  shippingAddress: ShippingAddress | null;

  @Prop({ type: String, default: null })
  trackingNumber: string | null;

  @Prop({ type: String, default: null })
  carrier: string | null;

  @Prop({ type: String, default: null, index: true })
  erpReference: string | null;

  @Prop({ type: String, default: null })
  deliveryCode: string | null;

  @Prop({ type: String, default: 'NOT_SYNCED', index: true })
  erpSyncStatus: 'NOT_SYNCED' | 'PENDING' | 'SYNCED' | 'FAILED';

  @Prop({ type: Number, default: 0 })
  erpSyncAttempts: number;

  @Prop({ type: String, default: null })
  erpLastSyncError: string | null;

  @Prop({ type: Date, default: null })
  erpLastSyncedAt: Date | null;

  @Prop({ type: [OrderItemSchema], default: [] })
  items: OrderItem[];

  @Prop({ type: [OrderStatusEntrySchema], default: [] })
  statusHistory: OrderStatusEntry[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);
applyCommonSchemaOptions(OrderSchema);
OrderSchema.index({ userId: 1, createdAt: -1 });
