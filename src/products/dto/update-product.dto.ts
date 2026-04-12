import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
	@ApiPropertyOptional({ example: 50 })
	@IsInt()
	@Min(0)
	@IsOptional()
	@Type(() => Number)
	inventory?: number;
}
