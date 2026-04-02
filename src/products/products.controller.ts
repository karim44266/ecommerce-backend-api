import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import {
  ProductListResponseDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products (with search/category/pagination)' })
  @ApiOkResponse({
    description: 'Paginated product list',
    type: ProductListResponseDto,
  })
  async findAll(@Query() query: ProductQueryDto, @Req() req: any) {
    const isAuthenticated = Boolean(req?.user?.userId);

    if (!isAuthenticated) {
      query.status = 'active';
    }

    return this.productsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiOkResponse({ description: 'Product detail', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const isAuthenticated = Boolean(req?.user?.userId);

    const product = await this.productsService.findById(id);

    if (!isAuthenticated && product.status !== 'active') {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product (admin only)' })
  @ApiCreatedResponse({ description: 'Product created' })
  @ApiConflictResponse({ description: 'Duplicate SKU' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a product (admin only)' })
  @ApiOkResponse({ description: 'Updated product' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiConflictResponse({ description: 'Duplicate SKU' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a product (admin only)' })
  @ApiOkResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
