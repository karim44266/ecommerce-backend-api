import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from '../categories/schemas/category.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DiscountCampaignsController } from './discount-campaigns.controller';
import { DiscountCampaignsService } from './discount-campaigns.service';
import {
  DiscountCampaign,
  DiscountCampaignSchema,
} from './schemas/discount-campaign.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DiscountCampaign.name, schema: DiscountCampaignSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [DiscountCampaignsController],
  providers: [DiscountCampaignsService],
  exports: [DiscountCampaignsService],
})
export class DiscountCampaignsModule {}
