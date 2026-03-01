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
  ApiBadRequestResponse,
  ApiCreatedResponse,
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
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ── Create ──────────────────────────────────────────────────────

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

  // ── List ────────────────────────────────────────────────────────

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

  // ── Detail ──────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get single order (owner or ADMIN)' })
  @ApiOkResponse({ description: 'Order detail with items, tracking & status history' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Not your order' })
  findOne(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.findById(id, req.user.userId, req.user.roles);
  }

  // ── Update Status (ADMIN) ──────────────────────────────────────

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update order status (ADMIN only, validates transitions)' })
  @ApiOkResponse({ description: 'Order with updated status' })
  @ApiBadRequestResponse({ description: 'Invalid status transition' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateStatus(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, req.user.userId, dto);
  }

  // ── Update Tracking (ADMIN) ────────────────────────────────────

  @Post(':id/tracking')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update tracking info (ADMIN only)' })
  @ApiOkResponse({ description: 'Order with updated tracking info' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateTracking(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackingDto,
  ) {
    return this.ordersService.updateTracking(id, req.user.userId, dto);
  }

  // ── Status History / Audit Trail ───────────────────────────────

  @Get(':id/history')
  @ApiOperation({ summary: 'Get order status history / audit trail' })
  @ApiOkResponse({ description: 'Status change history with actor info' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Not your order' })
  getStatusHistory(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getStatusHistory(
      id,
      req.user.userId,
      req.user.roles,
    );
  }
}
