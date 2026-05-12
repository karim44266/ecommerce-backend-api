import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsObject, IsOptional } from 'class-validator';
import {
  UserEventEntityType,
  UserEventType,
} from '../schemas/user-event.schema';

export class CreateUserEventDto {
  @ApiProperty({
    enum: UserEventType,
    example: UserEventType.VIEW_PRODUCT,
  })
  @IsEnum(UserEventType)
  eventType: UserEventType;

  @ApiProperty({
    description: 'Entity identifier (product/category/order)',
    example: '67a4d24d8ee2f3a1b56f9e20',
  })
  @IsMongoId()
  entityId: string;

  @ApiProperty({
    enum: UserEventEntityType,
    example: UserEventEntityType.PRODUCT,
  })
  @IsEnum(UserEventEntityType)
  entityType: UserEventEntityType;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    description: 'Sanitized, non-sensitive metadata for analytics only',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
