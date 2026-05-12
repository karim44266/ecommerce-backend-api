import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BehaviorTrackingController } from './behavior-tracking.controller';
import { BehaviorTrackingService } from './behavior-tracking.service';
import { UserEvent, UserEventSchema } from './schemas/user-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEvent.name, schema: UserEventSchema },
    ]),
  ],
  controllers: [BehaviorTrackingController],
  providers: [BehaviorTrackingService],
  exports: [BehaviorTrackingService],
})
export class BehaviorTrackingModule {}
