import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AccountAppealDocument = HydratedDocument<AccountAppeal>;

@Schema({ timestamps: true, collection: 'account_appeals' })
export class AccountAppeal {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  accountNumber: string;

  @Prop({ required: true })
  explanation: string;

  @Prop({ default: 'pending', enum: ['pending', 'reviewed'] })
  status: string;
}

export const AccountAppealSchema = SchemaFactory.createForClass(AccountAppeal);
