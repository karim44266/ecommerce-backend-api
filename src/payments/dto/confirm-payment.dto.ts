import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiPropertyOptional({ description: 'Mock card number (for demo purposes)' })
  @IsOptional()
  @IsString()
  cardNumber?: string;

  @ApiPropertyOptional({ description: 'Mock card holder name' })
  @IsOptional()
  @IsString()
  cardHolder?: string;
}
