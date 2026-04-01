import { IsMongoId, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignShipmentDto {
  @ApiProperty({
    description: 'New staff user MongoDB ObjectId to reassign the shipment to',
  })
  @IsMongoId()
  @IsNotEmpty()
  staffUserId: string;
}
