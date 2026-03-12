import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryController } from './inventory.controller';
import { InventoryAdjustment, InventoryAdjustmentSchema } from './schemas/inventory-adjustment.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: InventoryAdjustment.name, schema: InventoryAdjustmentSchema },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
