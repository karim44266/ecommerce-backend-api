import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  DeclarePaymentDto,
  ErpValidatePaymentDto,
  ExportQueryDto,
  FinanceQueryDto,
  ValidatePaymentDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

interface JwtUser {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ── Dashboard ──────────────────────────────────────────────────

  @Get('dashboard')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get financial dashboard (reseller sees own, admin sees all)',
  })
  @ApiOkResponse({ description: 'Financial dashboard metrics' })
  getDashboard(@Req() req: { user: JwtUser }) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.financeService.getDashboard(req.user.userId, isAdmin);
  }

  // ── Debt Detail ────────────────────────────────────────────────

  @Get('debts')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get delivered but unsettled orders (debt detail)',
  })
  @ApiOkResponse({ description: 'Paginated debt list' })
  getDebtDetail(
    @Req() req: { user: JwtUser },
    @Query() query: FinanceQueryDto,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.financeService.getDebtDetail(
      req.user.userId,
      isAdmin,
      query,
    );
  }

  // ── Overdue Orders ─────────────────────────────────────────────

  @Get('overdue')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get overdue unsettled orders' })
  @ApiOkResponse({ description: 'Overdue orders list' })
  getOverdueOrders(@Req() req: { user: JwtUser }) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.financeService.getOverdueOrders(req.user.userId, isAdmin);
  }

  // ── Declare Payment (Reseller) ─────────────────────────────────

  @Post('settlements')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('RESELLER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Declare a payment for delivered orders (reseller)',
  })
  @ApiOkResponse({ description: 'Settlement created' })
  @ApiBadRequestResponse({ description: 'Invalid order selection' })
  @ApiForbiddenResponse({ description: 'Order does not belong to reseller' })
  declarePayment(
    @Req() req: { user: JwtUser },
    @Body() dto: DeclarePaymentDto,
  ) {
    return this.financeService.declarePayment(req.user.userId, dto);
  }

  // ── Payment History (Ledger) ───────────────────────────────────

  @Get('settlements')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get payment history ledger (reseller sees own, admin sees all)',
  })
  @ApiOkResponse({ description: 'Paginated settlement list' })
  getPaymentHistory(
    @Req() req: { user: JwtUser },
    @Query() query: FinanceQueryDto,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.financeService.getPaymentHistory(
      req.user.userId,
      isAdmin,
      query,
    );
  }

  // ── Settlement Detail ──────────────────────────────────────────

  @Get('settlements/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get settlement detail' })
  @ApiOkResponse({ description: 'Settlement detail' })
  @ApiNotFoundResponse({ description: 'Settlement not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  getSettlementById(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    return this.financeService.getSettlementById(
      id,
      req.user.userId,
      isAdmin,
    );
  }

  // ── Validate / Reject Settlement (Admin) ───────────────────────

  @Patch('settlements/:id/validate')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Validate or reject a settlement (admin only)',
  })
  @ApiOkResponse({ description: 'Updated settlement' })
  @ApiBadRequestResponse({ description: 'Invalid validation request' })
  @ApiNotFoundResponse({ description: 'Settlement not found' })
  validatePayment(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: ValidatePaymentDto,
  ) {
    return this.financeService.validatePayment(id, req.user.userId, dto);
  }

  // ── ERP Webhook — Validate Payment ─────────────────────────────

  @Post('erp-validate')
  @ApiOperation({
    summary:
      'ERP webhook to validate/reject a settlement (API key auth)',
  })
  @ApiOkResponse({ description: 'Settlement validated/rejected' })
  async erpValidatePayment(
    @Headers('authorization') authHeader: string,
    @Body() dto: ErpValidatePaymentDto,
  ) {
    const expectedKey = process.env.ERP_API_KEY ?? '';
    const providedKey = (authHeader ?? '').replace(/^Bearer\s+/i, '');

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid or missing ERP API key');
    }

    return this.financeService.erpValidatePayment(
      dto.settlementId,
      dto.status,
      dto.erpReference,
      dto.rejectionReason,
    );
  }

  // ── Export Statement ───────────────────────────────────────────

  @Get('export')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Export financial statement (CSV or PDF/HTML)',
  })
  @ApiOkResponse({ description: 'Downloadable file' })
  async exportStatement(
    @Req() req: { user: JwtUser },
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    const isAdmin = req.user.roles.includes('ADMIN');
    const result = await this.financeService.exportStatement(
      req.user.userId,
      isAdmin,
      query,
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.content);
  }
}
