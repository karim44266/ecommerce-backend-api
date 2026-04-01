import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsString,
  IsOptional,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'reseller@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'RESELLER' })
  @IsString()
  @IsOptional()
  role?: string;
}
