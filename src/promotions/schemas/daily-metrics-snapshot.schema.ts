import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type DailyMetricsSnapshotDocument = HydratedDocument<DailyMetricsSnapshot>;

@Schema({ collection: 'promotion_daily_metrics_snapshots', timestamps: true })
export class DailyMetricsSnapshot {
  @Prop({ type: Date, required: true, index: true })
  snapshotDate: Date;

  @Prop({ type: Number, default: 0, min: 0 })
  impressions: number;

  @Prop({ type: Number, default: 0, min: 0 })
  clicks: number;

  @Prop({ type: Number, default: 0, min: 0 })
  conversions: number;

  @Prop({ type: Number, default: 0, min: 0 })
  revenueAttributed: number;

  @Prop({ type: Object, default: {} })
  bySource: Record<string, unknown>;
}

export const DailyMetricsSnapshotSchema =
  SchemaFactory.createForClass(DailyMetricsSnapshot);
applyCommonSchemaOptions(DailyMetricsSnapshotSchema);

DailyMetricsSnapshotSchema.index({ snapshotDate: 1 }, { unique: true });
