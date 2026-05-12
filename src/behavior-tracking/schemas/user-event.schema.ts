import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type UserEventDocument = HydratedDocument<UserEvent>;

export enum UserEventType {
  VIEW_PRODUCT = 'VIEW_PRODUCT',
  VIEW_CATEGORY = 'VIEW_CATEGORY',
  ADD_TO_CART = 'ADD_TO_CART',
  REMOVE_FROM_CART = 'REMOVE_FROM_CART',
  COMPLETE_ORDER = 'COMPLETE_ORDER',
  SEARCH = 'SEARCH',
}

export enum UserEventEntityType {
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  ORDER = 'ORDER',
}

@Schema({
  collection: 'user_events',
  timestamps: { createdAt: true, updatedAt: false },
})
export class UserEvent {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  userId: mongoose.Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  sessionId: string;

  @Prop({ type: String, required: true, enum: UserEventType, index: true })
  eventType: UserEventType;

  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  entityId: mongoose.Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: UserEventEntityType,
    index: true,
  })
  entityType: UserEventEntityType;

  /**
   * Security warning: never store raw user-input strings in this field.
   * Keep metadata sanitized and bounded.
   */
  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ type: Date })
  createdAt: Date;
}

export const UserEventSchema = SchemaFactory.createForClass(UserEvent);
applyCommonSchemaOptions(UserEventSchema);

UserEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
UserEventSchema.index({ userId: 1, entityType: 1, createdAt: -1 });
UserEventSchema.index({ sessionId: 1, createdAt: -1 });
