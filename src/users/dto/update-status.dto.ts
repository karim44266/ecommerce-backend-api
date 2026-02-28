import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({
    example: 'active',
    enum: ['active', 'blocked'],
    description: 'New account status',
  })
  @IsString()
  @IsIn(['active', 'blocked'])
  status: string;
}
