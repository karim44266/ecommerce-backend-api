import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class BlockedAppealDto {
  @ApiProperty({ example: 'Ahmed Ben Ali' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'RES-00042' })
  @IsString()
  @MinLength(1)
  accountNumber: string;

  @ApiProperty({ example: 'My account was blocked by mistake, I have settled all payments.' })
  @IsString()
  @MinLength(10)
  explanation: string;
}
