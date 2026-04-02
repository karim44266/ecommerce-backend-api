import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  MinLength,
  IsString,
  IsOptional,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'CUSTOMER', enum: ['ADMIN', 'STAFF', 'CUSTOMER'] })
  @IsString()
  @IsOptional()
  @IsIn(['ADMIN', 'STAFF', 'CUSTOMER'])
  role?: string;
}
