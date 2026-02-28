import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryQueryDto, HistoryQueryDto } from './dto/inventory-query.dto';
import {
  AdjustResultDto,
  BackfillResponseDto,
  InventoryResponseDto,
  InventorySummaryDto,
  PaginatedHistoryResponseDto,
  PaginatedInventoryResponseDto,
} from './dto/inventory-response.dto';
import { UpdateThresholdDto } from './dto/update-threshold.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'List inventory items (paginated, filterable, sortable)' })
  @ApiOkResponse({ description: 'Paginated inventory list', type: PaginatedInventoryResponseDto })
  findAll(@Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll(query);
  }

  @Get('summary')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Get inventory summary counts (total, low, out, in-stock)' })
  @ApiOkResponse({ description: 'Inventory summary', type: InventorySummaryDto })
  getSummary() {
    return this.inventoryService.getSummary();
  }

  @Get('low-stock')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'List products with low stock (paginated)' })
  @ApiOkResponse({ description: 'Paginated low-stock inventory list', type: PaginatedInventoryResponseDto })
  findLowStock(@Query() query: InventoryQueryDto) {
    return this.inventoryService.findLowStock(query);
  }

  @Post('backfill')
  @HttpCode(200)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create inventory records for products missing one' })
  @ApiOkResponse({ description: 'Backfill result', type: BackfillResponseDto })
  backfill() {
    return this.inventoryService.backfill();
  }

  @Get(':productId')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Get inventory for a specific product' })
  @ApiOkResponse({ description: 'Inventory record', type: InventoryResponseDto })
  @ApiNotFoundResponse({ description: 'Inventory not found' })
  findByProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.inventoryService.findByProductId(productId);
  }

  @Get(':productId/history')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Get paginated adjustment history for a product' })
  @ApiOkResponse({ description: 'Paginated adjustment history', type: PaginatedHistoryResponseDto })
  @ApiNotFoundResponse({ description: 'Inventory not found' })
  getHistory(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.inventoryService.getAdjustmentHistory(productId, query);
  }

  @Post(':productId/adjust')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Adjust stock for a product (admin only, race-safe)' })
  @ApiCreatedResponse({ description: 'Updated inventory record with adjustment info', type: AdjustResultDto })
  @ApiBadRequestResponse({ description: 'Stock cannot go below 0' })
  @ApiNotFoundResponse({ description: 'Inventory not found' })
  adjust(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AdjustStockDto,
    @Req() req: { user?: { userId?: string } },
  ) {
    return this.inventoryService.adjust(
      productId,
      dto.adjustment,
      dto.reason,
      req.user?.userId,
    );
  }

  @Patch(':productId/threshold')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update low-stock threshold for a product' })
  @ApiOkResponse({ description: 'Updated inventory record', type: InventoryResponseDto })
  @ApiNotFoundResponse({ description: 'Inventory not found' })
  updateThreshold(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateThresholdDto,
  ) {
    return this.inventoryService.updateThreshold(
      productId,
      dto.lowStockThreshold,
    );
  }
}
