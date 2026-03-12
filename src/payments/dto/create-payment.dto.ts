import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Order ID to create payment for' })
  @IsMongoId()
  @IsNotEmpty()
  orderId: string;
}
