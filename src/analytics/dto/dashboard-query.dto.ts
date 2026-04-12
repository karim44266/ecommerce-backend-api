import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class DashboardTrendsQueryDto {
  @ApiPropertyOptional({
    description: 'Number of trailing days to include in trends',
    example: 7,
    minimum: 1,
    maximum: 90,
  })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(90)
  days = 7;
}
