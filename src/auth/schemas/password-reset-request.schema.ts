import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PasswordResetRequestDocument = HydratedDocument<PasswordResetRequest>;

@Schema({ timestamps: true, collection: 'password_reset_requests' })
export class PasswordResetRequest {
  @Prop({ required: true, trim: true, lowercase: true })
  identifier: string;

  @Prop({ default: '' })
  message: string;

  @Prop({ default: 'pending', enum: ['pending', 'resolved'] })
  status: string;
}

export const PasswordResetRequestSchema = SchemaFactory.createForClass(PasswordResetRequest);
