import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BehaviorTrackingController } from '../behavior-tracking/behavior-tracking.controller';
import { BehaviorTrackingService } from '../behavior-tracking/behavior-tracking.service';
import {
  UserEvent,
  UserEventSchema,
} from '../behavior-tracking/schemas/user-event.schema';
import { CategoriesModule } from '../categories/categories.module';
import { Category, CategorySchema } from '../categories/schemas/category.schema';
import { DiscountCampaignsModule } from '../discount-campaigns/discount-campaigns.module';
import { InventoryModule } from '../inventory/inventory.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { ProductsModule } from '../products/products.module';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { AdminPromotionConfigController } from './admin-promotion-config.controller';
import { DiscountOfferSuggestionService } from './discount-offer-suggestion.service';
import { FeatureEngineeringService } from './feature-engineering.service';
import { InventoryPromotionService } from './inventory-promotion.service';
import { ProfileRecomputeJob } from './jobs/profile-recompute.job';
import { PromotionConfigService } from './promotion-config.service';
import { PromotionMetricsService } from './promotion-metrics.service';
import { PromotionsController } from './promotions.controller';
import { PromotionRecommendationService } from './recommendation.service';
import {
  PromotionConversion,
  PromotionConversionSchema,
} from './schemas/promotion-conversion.schema';
import {
  DailyMetricsSnapshot,
  DailyMetricsSnapshotSchema,
} from './schemas/daily-metrics-snapshot.schema';
import { JobLock, JobLockSchema } from './schemas/job-lock.schema';
import {
  PromotionConfig,
  PromotionConfigSchema,
} from './schemas/promotion-config.schema';
import { UserProfile, UserProfileSchema } from './schemas/user-profile.schema';

@Module({
  imports: [
    InventoryModule,
    ProductsModule,
    CategoriesModule,
    DiscountCampaignsModule,
    MongooseModule.forFeature([
      { name: UserEvent.name, schema: UserEventSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: PromotionConfig.name, schema: PromotionConfigSchema },
      { name: JobLock.name, schema: JobLockSchema },
      { name: DailyMetricsSnapshot.name, schema: DailyMetricsSnapshotSchema },
      { name: PromotionConversion.name, schema: PromotionConversionSchema },
    ]),
  ],
  controllers: [
    PromotionsController,
    AdminPromotionConfigController,
    BehaviorTrackingController,
  ],
  providers: [
    BehaviorTrackingService,
    FeatureEngineeringService,
    DiscountOfferSuggestionService,
    InventoryPromotionService,
    PromotionConfigService,
    PromotionMetricsService,
    PromotionRecommendationService,
    ProfileRecomputeJob,
  ],
  exports: [
    PromotionRecommendationService,
    BehaviorTrackingService,
    PromotionMetricsService,
  ],
})
export class PromotionsModule {}
