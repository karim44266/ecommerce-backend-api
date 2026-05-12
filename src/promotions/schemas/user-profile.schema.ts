import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type UserProfileDocument = HydratedDocument<UserProfile>;

@Schema({ _id: false })
export class CategoryAffinityEntry {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
  })
  categoryId: mongoose.Types.ObjectId;

  @Prop({ required: true, min: 0, max: 1 })
  score: number;

  @Prop({ required: true, min: 0, default: 0 })
  eventCount: number;
}

@Schema({ _id: false })
export class PreferredPriceRange {
  @Prop({ type: Number, default: 0, min: 0 })
  min: number;

  @Prop({ type: Number, default: 0, min: 0 })
  max: number;
}

export const CategoryAffinityEntrySchema =
  SchemaFactory.createForClass(CategoryAffinityEntry);
export const PreferredPriceRangeSchema =
  SchemaFactory.createForClass(PreferredPriceRange);

@Schema({ collection: 'user_profiles' })
export class UserProfile {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  @Prop({
    type: [CategoryAffinityEntrySchema],
    default: [],
    validate: {
      validator: (entries: CategoryAffinityEntry[]) => entries.length <= 10,
      message: 'categoryAffinities can contain at most 10 entries',
    },
  })
  categoryAffinities: CategoryAffinityEntry[];

  @Prop({ type: [mongoose.Schema.Types.ObjectId], ref: 'Category', default: [] })
  topCategoryIds: mongoose.Types.ObjectId[];

  @Prop({ type: Number, default: 0, min: 0 })
  purchaseFrequency: number;

  @Prop({ type: Number, default: 0, min: 0 })
  avgOrderValue: number;

  @Prop({ type: PreferredPriceRangeSchema, default: () => ({ min: 0, max: 0 }) })
  preferredPriceRange: PreferredPriceRange;

  @Prop({ type: Number, default: 0, min: 0 })
  totalOrders: number;

  @Prop({ type: Date, default: null })
  lastActiveAt: Date | null;

  @Prop({ type: Boolean, default: true, index: true })
  isNewUser: boolean;

  @Prop({ type: Date, default: () => new Date() })
  recomputedAt: Date;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);
applyCommonSchemaOptions(UserProfileSchema);

UserProfileSchema.index({ userId: 1 }, { unique: true });
UserProfileSchema.index({ topCategoryIds: 1 });
UserProfileSchema.index({ lastActiveAt: -1 });
UserProfileSchema.index({ isNewUser: 1 });
