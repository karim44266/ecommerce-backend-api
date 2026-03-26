import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
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
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ── Create ──────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new order (authenticated user)' })
  create(@Req() req: { user: JwtUser }, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, dto);
  }

  // ── List ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List orders (admin sees all, customer sees own)' })
  @ApiOkResponse({ description: 'Paginated order list' })
  findAll(@Req() req: { user: JwtUser }, @Query() query: OrderQueryDto) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.ordersService.findAll(query, req.user.userId, isAdmin);
  }

  // ── Detail ──────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get order detail with items, tracking & status history' })
  @ApiOkResponse({ description: 'Order detail' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  findOne(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.ordersService.findById(id, req.user.userId, isAdmin);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit order (owner or admin, only DRAFT/CONFIRMED)' })
  @ApiOkResponse({ description: 'Updated order' })
  @ApiBadRequestResponse({ description: 'Order not editable in current status' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateOrder(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.ordersService.updateOrder(id, req.user.userId, isAdmin, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel order (owner or admin, reason required before shipment)' })
  @ApiOkResponse({ description: 'Cancelled order' })
  @ApiBadRequestResponse({ description: 'Invalid cancellation request' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  cancelOrder(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.ordersService.cancelOrder(id, req.user.userId, isAdmin, dto.reason);
  }

  // ── Update Status (ADMIN) ──────────────────────────────────────

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update order status (ADMIN only, validates transitions)' })
  @ApiOkResponse({ description: 'Updated order' })
  @ApiBadRequestResponse({ description: 'Invalid status transition' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateStatus(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto, req.user.userId);
  }

  // ── Update Tracking (ADMIN) ────────────────────────────────────

  @Post(':id/tracking')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update tracking info (admin only)' })
  @ApiOkResponse({ description: 'Order with updated tracking info' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateTracking(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: UpdateTrackingDto,
  ) {
    return this.ordersService.updateTracking(id, dto, req.user.userId);
  }

  // ── Status History / Audit Trail ───────────────────────────────

  @Get(':id/history')
  @ApiOperation({ summary: 'Get order status history / audit trail' })
  @ApiOkResponse({ description: 'Status change history with actor info' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Not your order' })
  getStatusHistory(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
  ) {
    return this.ordersService.getStatusHistory(
      id,
      req.user.userId,
      req.user.roles,
    );
  }
}
