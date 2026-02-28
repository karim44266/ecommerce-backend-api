import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class UpdateRoleDto {
  @ApiProperty({
    example: 'staff',
    enum: ['admin', 'staff', 'customer'],
    description: 'New role for the user',
  })
  @IsString()
  @IsIn(['admin', 'staff', 'customer'])
  role: string;
}
