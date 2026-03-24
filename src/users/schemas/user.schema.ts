import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, index: true, trim: true, lowercase: true })
  email: string;

  @Prop({ default: '' })
  name: string;

  @Prop({ type: [String], default: ['CUSTOMER'] })
  roles: string[];

  @Prop({ default: 'active' })
  status: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: false })
  mfaEnabled: boolean;

  @Prop({ type: String, default: null })
  mfaOtpHash: string | null;

  @Prop({ type: Date, default: null })
  mfaOtpExpiresAt: Date | null;

  @Prop({ type: String, default: null })
  refreshTokenHash: string | null;

  @Prop({ type: Date, default: null })
  refreshTokenExpiresAt: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
applyCommonSchemaOptions(UserSchema);
