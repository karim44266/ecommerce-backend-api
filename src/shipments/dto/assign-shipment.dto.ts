import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignShipmentDto {
  @ApiProperty({ description: 'New staff user UUID to reassign the shipment to' })
  @IsUUID()
  @IsNotEmpty()
  staffUserId: string;
}
