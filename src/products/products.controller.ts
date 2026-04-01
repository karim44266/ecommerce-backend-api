import {
  BadRequestException,
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
import { UsersService } from '../users/users.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import {
  ProductListResponseDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import { ToggleCatalogItemDto } from './dto/toggle-catalog-item.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List products (with search/category/pagination)' })
  @ApiOkResponse({
    description: 'Paginated product list',
    type: ProductListResponseDto,
  })
  async findAll(@Query() query: ProductQueryDto, @Req() req: any) {
    const userRoles: string[] = Array.isArray(req?.user?.roles)
      ? req.user.roles
      : [];
    const isReseller = userRoles.includes('RESELLER');
    const isAuthenticated = Boolean(req?.user?.userId);

    if (!isAuthenticated) {
      query.status = 'active';
    }

    if (isReseller) {
      query.status = 'active'; // Enforce ERP published state
    }
    const personalCatalog =
      isReseller && req?.user?.userId
        ? await this.usersService.getPersonalCatalog(req.user.userId)
        : [];

    return this.productsService.findAll(query, { isReseller, personalCatalog });
  }

  @Get('personal')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('RESELLER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List products currently in the reseller personal catalog',
  })
  @ApiOkResponse({
    description: 'Paginated product list',
    type: ProductListResponseDto,
  })
  async findPersonalCatalog(@Query() query: ProductQueryDto, @Req() req: any) {
    const personalCatalog = await this.usersService.getPersonalCatalog(
      req.user.userId,
    );
    if (!personalCatalog.length) {
      return {
        data: [],
        meta: { total: 0, page: 1, limit: query.limit || 20, totalPages: 0 },
      };
    }
    query.status = 'active'; // Only active products
    return this.productsService.findAll(query, {
      isReseller: true,
      personalCatalog,
      allowedProductIds: personalCatalog,
    });
  }

  @Post('personal/toggle')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('RESELLER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle a product in the personal catalog' })
  @ApiOkResponse({ description: 'Toggled state' })
  async togglePersonalCatalog(
    @Body() dto: ToggleCatalogItemDto,
    @Req() req: any,
  ) {
    const product = await this.productsService.findById(dto.productId);
    if (product.status !== 'active') {
      throw new BadRequestException(
        'Only active (ERP-published) products can be selected',
      );
    }
    return this.usersService.togglePersonalCatalogItem(
      req.user.userId,
      dto.productId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiOkResponse({ description: 'Product detail', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    if (id === 'personal' || id === 'personal/toggle') return; // Guard for route collision

    const userRoles: string[] = Array.isArray(req?.user?.roles)
      ? req.user.roles
      : [];
    const isReseller = userRoles.includes('RESELLER');
    const isAuthenticated = Boolean(req?.user?.userId);
    const personalCatalog =
      isReseller && req?.user?.userId
        ? await this.usersService.getPersonalCatalog(req.user.userId)
        : [];

    const product = await this.productsService.findById(id, {
      isReseller,
      personalCatalog,
    });

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
