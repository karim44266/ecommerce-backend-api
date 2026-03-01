import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrdersService } from './orders.service';

interface JwtUser {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create order from cart (authenticated user)' })
  @ApiCreatedResponse({ description: 'Order created with PENDING_PAYMENT status' })
  @ApiBadRequestResponse({ description: 'Validation error or insufficient stock' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  create(
    @Req() req: { user: JwtUser },
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.create(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List authenticated user orders (ADMIN sees all)' })
  @ApiOkResponse({ description: 'Paginated order list' })
  findAll(
    @Req() req: { user: JwtUser },
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findAll(
      req.user.userId,
      req.user.roles,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single order (owner or ADMIN)' })
  @ApiOkResponse({ description: 'Order detail with items' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Not your order' })
  findOne(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.findById(id, req.user.userId, req.user.roles);
  }
}
