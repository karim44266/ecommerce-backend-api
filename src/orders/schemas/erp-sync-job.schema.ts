import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type ErpSyncJobDocument = HydratedDocument<ErpSyncJob>;

export type ErpSyncJobStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

@Schema({ timestamps: true, collection: 'erp_sync_jobs' })
export class ErpSyncJob {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: mongoose.Types.ObjectId;

  @Prop({ type: String, default: 'PENDING', index: true })
  status: ErpSyncJobStatus;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: Number, default: 3 })
  maxAttempts: number;

  @Prop({ type: Date, default: () => new Date(), index: true })
  nextRunAt: Date;

  @Prop({ type: Date, default: null })
  lockedAt: Date | null;

  @Prop({ type: String, default: null })
  reason: string | null;

  @Prop({ type: Boolean, default: false })
  force: boolean;

  @Prop({ type: String, default: null })
  lastError: string | null;
}

export const ErpSyncJobSchema = SchemaFactory.createForClass(ErpSyncJob);
applyCommonSchemaOptions(ErpSyncJobSchema);
ErpSyncJobSchema.index({ status: 1, nextRunAt: 1, createdAt: 1 });
