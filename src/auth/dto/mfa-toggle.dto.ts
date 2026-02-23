import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class MfaToggleDto {
  @ApiProperty({ example: true, description: 'Enable or disable MFA for the current user' })
  @IsBoolean()
  enabled: boolean;
}
