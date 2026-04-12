import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardTrendsQueryDto } from './dto/dashboard-query.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics/dashboard')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
@Roles('ADMIN')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get dashboard summary KPIs' })
  @ApiOkResponse({ description: 'Dashboard KPI summary' })
  getSummary() {
    return this.analyticsService.getDashboardSummary();
  }

  @Get('trends')
  @ApiOperation({ summary: 'Get dashboard trends for trailing days' })
  @ApiOkResponse({ description: 'Orders and revenue trends' })
  getTrends(@Query() query: DashboardTrendsQueryDto) {
    return this.analyticsService.getDashboardTrends(query.days);
  }

  @Get('status-distribution')
  @ApiOperation({ summary: 'Get dashboard order status distribution' })
  @ApiOkResponse({ description: 'Order statuses with counts' })
  getStatusDistribution() {
    return this.analyticsService.getStatusDistribution();
  }
}
