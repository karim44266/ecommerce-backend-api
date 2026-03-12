import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryModule } from '../inventory/inventory.module';
import { Category, CategorySchema } from '../categories/schemas/category.schema';
import { ProductsController } from './products.controller';
import { Product, ProductSchema } from './schemas/product.schema';
import { ProductsService } from './products.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
    InventoryModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
