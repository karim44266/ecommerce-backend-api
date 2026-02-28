import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class UpdateRoleDto {
  @ApiProperty({ example: 'admin', enum: ['admin', 'staff', 'customer'] })
  @IsString()
  @IsIn(['admin', 'staff', 'customer'])
  role: string;
}
