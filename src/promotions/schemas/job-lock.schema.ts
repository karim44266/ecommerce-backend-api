import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type JobLockDocument = HydratedDocument<JobLock>;

@Schema({ collection: 'promotion_job_locks' })
export class JobLock {
  @Prop({ required: true, unique: true, index: true })
  jobName: string;

  @Prop({ type: Date, required: true })
  lockedAt: Date;

  @Prop({ type: Date, required: true })
  ttl: Date;
}

export const JobLockSchema = SchemaFactory.createForClass(JobLock);
applyCommonSchemaOptions(JobLockSchema);

JobLockSchema.index({ ttl: 1 }, { expireAfterSeconds: 0 });
