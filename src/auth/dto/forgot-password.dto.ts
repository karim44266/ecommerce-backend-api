import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'reseller@example.com', description: 'Email or account number' })
  @IsString()
  @MinLength(1)
  identifier: string;

  @ApiPropertyOptional({ example: 'I forgot my password, please help.' })
  @IsString()
  @IsOptional()
  message?: string;
}
