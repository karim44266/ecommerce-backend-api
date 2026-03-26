import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type SettlementDocument = HydratedDocument<Settlement>;

export const SETTLEMENT_STATUSES = [
  'PENDING_VALIDATION',
  'VALIDATED',
  'REJECTED',
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'check',
  'other',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

@Schema({ timestamps: true, collection: 'settlements' })
export class Settlement {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  resellerId: mongoose.Types.ObjectId;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    required: true,
  })
  orderIds: mongoose.Types.ObjectId[];

  @Prop({ required: true })
  amountCents: number;

  @Prop({
    type: String,
    required: true,
    enum: PAYMENT_METHODS,
  })
  method: string;

  @Prop({ type: String, default: null })
  reference: string | null;

  @Prop({ type: String, default: null })
  note: string | null;

  @Prop({
    type: String,
    default: 'PENDING_VALIDATION',
    enum: SETTLEMENT_STATUSES,
    index: true,
  })
  status: string;

  @Prop({ type: String, default: null })
  erpReference: string | null;

  @Prop({ type: Date, default: null })
  validatedAt: Date | null;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  validatedBy: mongoose.Types.ObjectId | null;

  @Prop({ type: String, default: null })
  rejectionReason: string | null;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);
applyCommonSchemaOptions(SettlementSchema);
SettlementSchema.index({ resellerId: 1, createdAt: -1 });
SettlementSchema.index({ status: 1, createdAt: -1 });
