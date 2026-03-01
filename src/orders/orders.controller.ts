import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { OrdersService } from './orders.service';

interface JwtUser {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ─── Create Order (authenticated customer) ──────────────────────
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new order (authenticated user)' })
  create(@Req() req: { user: JwtUser }, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, dto);
  }

  // ─── List Orders ────────────────────────────────────────────────
  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List orders (admin sees all, customer sees own)' })
  @ApiOkResponse({ description: 'Paginated order list' })
  findAll(@Req() req: { user: JwtUser }, @Query() query: OrderQueryDto) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.ordersService.findAll(query, req.user.userId, isAdmin);
  }

  // ─── Get Order Detail ───────────────────────────────────────────
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get order detail with items and status history' })
  @ApiOkResponse({ description: 'Order detail' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  findOne(@Req() req: { user: JwtUser }, @Param('id', ParseUUIDPipe) id: string) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.ordersService.findById(id, req.user.userId, isAdmin);
  }

  // ─── Update Order Status (admin) ───────────────────────────────
  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update order status (admin only)' })
  @ApiOkResponse({ description: 'Updated order' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateStatus(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto, req.user.userId);
  }

  // ─── Update Tracking Info (admin) ──────────────────────────────
  @Post(':id/tracking')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add/update tracking info (admin only)' })
  @ApiOkResponse({ description: 'Updated order with tracking' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateTracking(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackingDto,
  ) {
    return this.ordersService.updateTracking(id, dto, req.user.userId);
  }
}
