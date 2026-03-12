import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { applyCommonSchemaOptions } from '../../common/mongoose/schema-transform';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true, collection: 'categories' })
export class Category {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, index: true, trim: true })
  slug: string;

  @Prop({ type: String, default: null })
  description: string | null;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
applyCommonSchemaOptions(CategorySchema);
