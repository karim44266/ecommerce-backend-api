import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ShipmentsController } from './shipments.controller';
import { Shipment, ShipmentSchema } from './schemas/shipment.schema';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shipment.name, schema: ShipmentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
