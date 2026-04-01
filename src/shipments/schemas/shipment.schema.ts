import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type ShipmentDocument = HydratedDocument<Shipment>;

@Schema({ timestamps: true, collection: 'shipments' })
export class Shipment {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
  })
  orderId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  staffUserId: mongoose.Types.ObjectId;

  @Prop({ default: 'ASSIGNED', index: true })
  status: string;

  @Prop({ type: String, default: null })
  trackingNumber: string | null;

  @Prop({ default: () => new Date() })
  assignedAt: Date;

  @Prop({ type: Date, default: null })
  deliveredAt: Date | null;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);
applyCommonSchemaOptions(ShipmentSchema);
