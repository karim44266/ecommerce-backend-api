import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
  })
  orderId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ default: 'PENDING' })
  status: string;

  @Prop({ default: 'mock' })
  provider: string;

  @Prop({ type: String, default: null })
  providerPaymentId: string | null;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
applyCommonSchemaOptions(PaymentSchema);
