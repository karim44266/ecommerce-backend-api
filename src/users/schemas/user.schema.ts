import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
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

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] })
  personalCatalog: mongoose.Types.ObjectId[];
}

export const UserSchema = SchemaFactory.createForClass(User);
applyCommonSchemaOptions(UserSchema);
