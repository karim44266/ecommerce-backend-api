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
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { AssignShipmentDto } from './dto/assign-shipment.dto';
import { ShipmentsService } from './shipments.service';

interface JwtUser {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('shipments')
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  // ─── Create Shipment (ADMIN) ────────────────────────────────
  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a shipment for an order (admin only)' })
  @ApiOkResponse({ description: 'Shipment created' })
  create(@Body() dto: CreateShipmentDto) {
    return this.shipmentsService.create(dto);
  }

  // ─── List Shipments ─────────────────────────────────────────
  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List shipments (admin sees all, staff sees own)' })
  @ApiOkResponse({ description: 'Shipment list' })
  findAll(
    @Req() req: { user: JwtUser },
    @Query('status') status?: string,
    @Query('staffId') staffId?: string,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.shipmentsService.findAll(req.user.userId, isAdmin, { status, staffId });
  }

  // ─── Get Assignable Orders (ADMIN) ─────────────────────────
  @Get('assignable-orders')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get orders eligible for shipment assignment (PAID/PROCESSING without existing shipment)' })
  @ApiOkResponse({ description: 'List of assignable orders' })
  getAssignableOrders() {
    return this.shipmentsService.getAssignableOrders();
  }

  // ─── Get Staff Users (ADMIN) ───────────────────────────────
  @Get('staff')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get staff users available for assignment' })
  @ApiOkResponse({ description: 'List of staff users' })
  getStaffUsers() {
    return this.shipmentsService.getStaffUsers();
  }

  // ─── Get Single Shipment ───────────────────────────────────
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get shipment detail' })
  @ApiOkResponse({ description: 'Shipment detail' })
  @ApiNotFoundResponse({ description: 'Shipment not found' })
  @ApiForbiddenResponse({ description: 'Access denied (staff can only view own)' })
  findOne(
    @Req() req: { user: JwtUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.shipmentsService.findById(id, req.user.userId, isAdmin);
  }

  // ─── Reassign Shipment (ADMIN) ─────────────────────────────
  @Patch(':id/assign')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reassign shipment to different staff (admin only)' })
  @ApiOkResponse({ description: 'Shipment reassigned' })
  @ApiNotFoundResponse({ description: 'Shipment not found' })
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignShipmentDto,
  ) {
    return this.shipmentsService.reassign(id, dto);
  }
}
