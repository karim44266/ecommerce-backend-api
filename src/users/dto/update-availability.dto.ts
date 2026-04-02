import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class UpdateAvailabilityDto {
  @ApiProperty({
    example: 'AVAILABLE',
    enum: ['AVAILABLE', 'UNAVAILABLE'],
  })
  @IsString()
  @IsIn(['AVAILABLE', 'UNAVAILABLE'])
  availabilityStatus: string;
}
