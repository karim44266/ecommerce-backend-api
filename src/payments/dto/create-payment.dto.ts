import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Order ID to create payment for' })
  @IsUUID()
  @IsNotEmpty()
  orderId: string;
}
