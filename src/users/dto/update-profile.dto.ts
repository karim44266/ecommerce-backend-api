import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', description: 'Display name for storefront account' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;
}