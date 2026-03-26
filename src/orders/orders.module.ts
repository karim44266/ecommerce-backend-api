import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { OrdersController } from './orders.controller';
import { ErpSyncService } from './erp-sync.service';
import { ErpSyncJob, ErpSyncJobSchema } from './schemas/erp-sync-job.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: ErpSyncJob.name, schema: ErpSyncJobSchema },
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, ErpSyncService],
  exports: [OrdersService],
})
export class OrdersModule {}
