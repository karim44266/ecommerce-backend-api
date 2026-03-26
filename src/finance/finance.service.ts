import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Settlement, SettlementDocument } from './schemas/settlement.schema';
import {
  DeclarePaymentDto,
  ExportQueryDto,
  FinanceQueryDto,
  ValidatePaymentDto,
} from './dto/finance.dto';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  private readonly overdueDays = Math.max(
    1,
    Number(process.env.SETTLEMENT_OVERDUE_DAYS ?? 7),
  );

  constructor(
    @InjectModel(Settlement.name)
    private readonly settlementModel: Model<SettlementDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  Financial Dashboard
  // ────────────────────────────────────────────────────────────────

  async getDashboard(resellerId: string, isAdmin: boolean) {
    const userFilter: FilterQuery<OrderDocument> = isAdmin
      ? {}
      : { userId: new Types.ObjectId(resellerId) };

    // Aggregate order financials
    const [orderStats] = await this.orderModel.aggregate([
      { $match: userFilter },
      {
        $group: {
          _id: null,
          totalDeliveredCents: {
            $sum: {
              $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$totalAmount', 0],
            },
          },
          totalSettledCents: {
            $sum: {
              $cond: [{ $eq: ['$status', 'SETTLED'] }, '$totalAmount', 0],
            },
          },
          deliveredCount: {
            $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] },
          },
          settledCount: {
            $sum: { $cond: [{ $eq: ['$status', 'SETTLED'] }, 1, 0] },
          },
          totalOrderCount: { $sum: 1 },
          inProgressCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$status',
                    ['DRAFT', 'CONFIRMED', 'IN_PREPARATION'],
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const stats = orderStats || {
      totalDeliveredCents: 0,
      totalSettledCents: 0,
      deliveredCount: 0,
      settledCount: 0,
      totalOrderCount: 0,
      inProgressCount: 0,
    };

    // Count overdue orders
    const overdueThreshold = new Date();
    overdueThreshold.setDate(overdueThreshold.getDate() - this.overdueDays);

    const overdueCount = await this.orderModel.countDocuments({
      ...userFilter,
      status: 'DELIVERED',
      updatedAt: { $lte: overdueThreshold },
    });

    // Pending settlements count
    const pendingSettlementsFilter: FilterQuery<SettlementDocument> = isAdmin
      ? { status: 'PENDING_VALIDATION' }
      : { resellerId: new Types.ObjectId(resellerId), status: 'PENDING_VALIDATION' };

    const pendingSettlements = await this.settlementModel.countDocuments(
      pendingSettlementsFilter,
    );

    // Estimated margin: 20% discount means the reseller's potential margin
    // is 25% of reseller price (since reseller price = 80% of public price,
    // the 20% discount / 80% = 25% potential margin on reseller cost).
    // But more intuitively: margin = publicPrice - resellerPrice = 0.20 * publicPrice
    // Since we only store reseller price (already discounted), we approximate:
    // estimatedMarginCents = settledAmount * 0.25 (the reseller paid 80%, so their 20% discount = 25% of what they paid)
    const estimatedMarginCents = Math.round(
      (stats.totalSettledCents + stats.totalDeliveredCents) * 0.25,
    );

    return {
      totalOwed: stats.totalDeliveredCents / 100,
      totalOwedCents: stats.totalDeliveredCents,
      totalSettled: stats.totalSettledCents / 100,
      totalSettledCents: stats.totalSettledCents,
      estimatedMargin: estimatedMarginCents / 100,
      estimatedMarginCents,
      deliveredCount: stats.deliveredCount,
      settledCount: stats.settledCount,
      inProgressCount: stats.inProgressCount,
      totalOrderCount: stats.totalOrderCount,
      overdueCount,
      pendingSettlements,
      overdueDays: this.overdueDays,
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Debt Detail (Delivered but unsettled orders)
  // ────────────────────────────────────────────────────────────────

  async getDebtDetail(
    resellerId: string,
    isAdmin: boolean,
    query: FinanceQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter: FilterQuery<OrderDocument> = {
      status: 'DELIVERED',
      ...(isAdmin ? {} : { userId: new Types.ObjectId(resellerId) }),
    };

    if (query.from) {
      filter.updatedAt = { ...((filter.updatedAt as object) || {}), $gte: new Date(query.from) };
    }
    if (query.to) {
      const toDate = new Date(query.to);
      toDate.setHours(23, 59, 59, 999);
      filter.updatedAt = { ...((filter.updatedAt as object) || {}), $lte: toDate };
    }

    const [total, rows] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .populate('userId', 'email name')
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit),
    ]);

    const data = rows.map((order) => this.formatDebtOrder(order));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Overdue Orders
  // ────────────────────────────────────────────────────────────────

  async getOverdueOrders(resellerId: string, isAdmin: boolean) {
    const overdueThreshold = new Date();
    overdueThreshold.setDate(overdueThreshold.getDate() - this.overdueDays);

    const filter: FilterQuery<OrderDocument> = {
      status: 'DELIVERED',
      updatedAt: { $lte: overdueThreshold },
      ...(isAdmin ? {} : { userId: new Types.ObjectId(resellerId) }),
    };

    const rows = await this.orderModel
      .find(filter)
      .populate('userId', 'email name')
      .sort({ updatedAt: 1 })
      .limit(50);

    return {
      overdueDays: this.overdueDays,
      count: rows.length,
      orders: rows.map((order) => this.formatDebtOrder(order)),
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Declare Payment (Reseller)
  // ────────────────────────────────────────────────────────────────

  async declarePayment(resellerId: string, dto: DeclarePaymentDto) {
    // Validate all orders belong to the reseller and are in DELIVERED status
    const orders = await this.orderModel.find({
      _id: { $in: dto.orderIds.map((id) => new Types.ObjectId(id)) },
    });

    if (orders.length !== dto.orderIds.length) {
      throw new NotFoundException('One or more orders not found');
    }

    let totalCents = 0;

    for (const order of orders) {
      if (String(order.userId) !== resellerId) {
        throw new ForbiddenException(
          `Order ${order.id} does not belong to you`,
        );
      }

      if (order.status !== 'DELIVERED') {
        throw new BadRequestException(
          `Order ${order.id} is in "${order.status}" status. Only DELIVERED orders can be settled.`,
        );
      }

      // Check if this order is already part of a pending settlement
      const existingSettlement = await this.settlementModel.findOne({
        orderIds: order._id,
        status: 'PENDING_VALIDATION',
      });

      if (existingSettlement) {
        throw new BadRequestException(
          `Order ${order.id} already has a pending settlement declaration`,
        );
      }

      totalCents += order.totalAmount;
    }

    const settlement = await this.settlementModel.create({
      resellerId: new Types.ObjectId(resellerId),
      orderIds: dto.orderIds.map((id) => new Types.ObjectId(id)),
      amountCents: totalCents,
      method: dto.method,
      reference: dto.reference?.trim() || null,
      note: dto.note?.trim() || null,
      status: 'PENDING_VALIDATION',
    });

    this.logger.log(
      `[Finance] Payment declared by reseller ${resellerId}: ${settlement.id} for ${totalCents / 100} covering ${dto.orderIds.length} orders`,
    );

    return this.formatSettlement(settlement);
  }

  // ────────────────────────────────────────────────────────────────
  //  Validate Payment (Admin / ERP)
  // ────────────────────────────────────────────────────────────────

  async validatePayment(
    settlementId: string,
    adminUserId: string,
    dto: ValidatePaymentDto,
  ) {
    const settlement = await this.settlementModel.findById(settlementId);

    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    if (settlement.status !== 'PENDING_VALIDATION') {
      throw new BadRequestException(
        `Settlement is already ${settlement.status}`,
      );
    }

    if (dto.status === 'REJECTED') {
      if (!dto.rejectionReason || dto.rejectionReason.trim().length === 0) {
        throw new BadRequestException(
          'Rejection reason is required when rejecting a settlement',
        );
      }

      await this.settlementModel.findByIdAndUpdate(settlementId, {
        $set: {
          status: 'REJECTED',
          rejectionReason: dto.rejectionReason.trim(),
          validatedAt: new Date(),
          validatedBy: new Types.ObjectId(adminUserId),
        },
      });

      this.logger.log(
        `[Finance] Settlement ${settlementId} rejected by ${adminUserId}: ${dto.rejectionReason}`,
      );

      const updated = await this.settlementModel
        .findById(settlementId)
        .populate('resellerId', 'email name')
        .populate('validatedBy', 'email');
      return this.formatSettlement(updated!);
    }

    // VALIDATED — transition all covered orders to SETTLED
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        for (const orderId of settlement.orderIds) {
          await this.orderModel.findByIdAndUpdate(
            orderId,
            {
              $set: { status: 'SETTLED' },
              $push: {
                statusHistory: {
                  status: 'SETTLED',
                  note: `Payment validated (settlement ${settlementId})`,
                  changedBy: new Types.ObjectId(adminUserId),
                  createdAt: new Date(),
                },
              },
            },
            { session },
          );
        }

        await this.settlementModel.findByIdAndUpdate(
          settlementId,
          {
            $set: {
              status: 'VALIDATED',
              erpReference: dto.erpReference?.trim() || null,
              validatedAt: new Date(),
              validatedBy: new Types.ObjectId(adminUserId),
            },
          },
          { session },
        );
      });

      this.logger.log(
        `[Finance] Settlement ${settlementId} validated by ${adminUserId}. ${settlement.orderIds.length} orders moved to SETTLED.`,
      );

      const updated = await this.settlementModel
        .findById(settlementId)
        .populate('resellerId', 'email name')
        .populate('validatedBy', 'email');
      return this.formatSettlement(updated!);
    } finally {
      await session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  ERP Webhook Validate
  // ────────────────────────────────────────────────────────────────

  async erpValidatePayment(
    settlementId: string,
    status: 'VALIDATED' | 'REJECTED',
    erpReference?: string,
    rejectionReason?: string,
  ) {
    // Reuse validatePayment with a system-level admin context
    return this.validatePayment(settlementId, 'ERP_SYSTEM', {
      status,
      erpReference,
      rejectionReason,
    });
  }

  // ────────────────────────────────────────────────────────────────
  //  Payment History (Ledger)
  // ────────────────────────────────────────────────────────────────

  async getPaymentHistory(
    resellerId: string,
    isAdmin: boolean,
    query: FinanceQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter: FilterQuery<SettlementDocument> = isAdmin
      ? {}
      : { resellerId: new Types.ObjectId(resellerId) };

    if (query.status) {
      filter.status = query.status;
    }
    if (query.from) {
      filter.createdAt = {
        ...((filter.createdAt as object) || {}),
        $gte: new Date(query.from),
      };
    }
    if (query.to) {
      const toDate = new Date(query.to);
      toDate.setHours(23, 59, 59, 999);
      filter.createdAt = {
        ...((filter.createdAt as object) || {}),
        $lte: toDate,
      };
    }

    const [total, rows] = await Promise.all([
      this.settlementModel.countDocuments(filter),
      this.settlementModel
        .find(filter)
        .populate('resellerId', 'email name')
        .populate('validatedBy', 'email')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
    ]);

    const data = rows.map((s) => this.formatSettlement(s));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Settlement Detail
  // ────────────────────────────────────────────────────────────────

  async getSettlementById(
    settlementId: string,
    resellerId: string,
    isAdmin: boolean,
  ) {
    const settlement = await this.settlementModel
      .findById(settlementId)
      .populate('resellerId', 'email name')
      .populate('validatedBy', 'email')
      .populate({
        path: 'orderIds',
        select: 'status totalAmount shippingAddress items createdAt updatedAt',
      });

    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    if (!isAdmin && String(settlement.resellerId) !== resellerId) {
      // Handle populated resellerId
      const resellerIdStr =
        settlement.resellerId &&
        typeof settlement.resellerId === 'object' &&
        '_id' in (settlement.resellerId as object)
          ? String(
              (settlement.resellerId as { _id: Types.ObjectId })._id,
            )
          : String(settlement.resellerId);

      if (resellerIdStr !== resellerId) {
        throw new ForbiddenException(
          'You do not have access to this settlement',
        );
      }
    }

    return this.formatSettlement(settlement);
  }

  // ────────────────────────────────────────────────────────────────
  //  Export Statement (CSV / PDF)
  // ────────────────────────────────────────────────────────────────

  async exportStatement(
    resellerId: string,
    isAdmin: boolean,
    query: ExportQueryDto,
  ) {
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);
    toDate.setHours(23, 59, 59, 999);

    const format = query.format || 'csv';

    // Get all settlements in the date range
    const settlementFilter: FilterQuery<SettlementDocument> = {
      createdAt: { $gte: fromDate, $lte: toDate },
      ...(isAdmin ? {} : { resellerId: new Types.ObjectId(resellerId) }),
    };

    const settlements = await this.settlementModel
      .find(settlementFilter)
      .populate('resellerId', 'email name')
      .populate('validatedBy', 'email')
      .sort({ createdAt: -1 });

    // Get all delivered/settled orders in the date range
    const orderFilter: FilterQuery<OrderDocument> = {
      status: { $in: ['DELIVERED', 'SETTLED'] },
      updatedAt: { $gte: fromDate, $lte: toDate },
      ...(isAdmin ? {} : { userId: new Types.ObjectId(resellerId) }),
    };

    const orders = await this.orderModel
      .find(orderFilter)
      .populate('userId', 'email name')
      .sort({ updatedAt: -1 });

    if (format === 'csv') {
      return this.generateCsv(settlements, orders, fromDate, toDate);
    }

    return this.generatePdfHtml(settlements, orders, fromDate, toDate);
  }

  // ────────────────────────────────────────────────────────────────
  //  Format helpers
  // ────────────────────────────────────────────────────────────────

  private formatDebtOrder(order: OrderDocument | Record<string, unknown>) {
    const plain =
      typeof (order as OrderDocument).toJSON === 'function'
        ? ((order as OrderDocument).toJSON() as Record<string, any>)
        : (order as Record<string, any>);

    const user =
      plain.userId && typeof plain.userId === 'object'
        ? plain.userId
        : null;

    // Calculate days since delivery (based on updatedAt, which is when status changed)
    const deliveredDate = plain.updatedAt ? new Date(plain.updatedAt) : null;
    const daysSinceDelivery = deliveredDate
      ? Math.floor(
          (Date.now() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    return {
      id: plain.id,
      userId: user?.id ?? String(plain.userId),
      userEmail: user?.email ?? null,
      userName: user?.name ?? null,
      status: plain.status,
      totalAmount: Number(plain.totalAmount) / 100,
      totalAmountCents: Number(plain.totalAmount),
      shippingAddress: plain.shippingAddress,
      itemCount: (plain.items ?? []).length,
      deliveredAt: deliveredDate?.toISOString() ?? null,
      daysSinceDelivery,
      isOverdue: daysSinceDelivery > this.overdueDays,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }

  private formatSettlement(
    settlement: SettlementDocument | Record<string, unknown>,
  ) {
    const plain =
      typeof (settlement as SettlementDocument).toJSON === 'function'
        ? ((settlement as SettlementDocument).toJSON() as Record<string, any>)
        : (settlement as Record<string, any>);

    const reseller =
      plain.resellerId && typeof plain.resellerId === 'object'
        ? plain.resellerId
        : null;

    const validator =
      plain.validatedBy && typeof plain.validatedBy === 'object'
        ? plain.validatedBy
        : null;

    return {
      id: plain.id,
      resellerId: reseller?.id ?? String(plain.resellerId),
      resellerEmail: reseller?.email ?? null,
      resellerName: reseller?.name ?? null,
      orderIds: (plain.orderIds ?? []).map((oid: any) => {
        if (typeof oid === 'object' && oid !== null && oid.id) {
          return oid.id;
        }
        return String(oid);
      }),
      orderCount: (plain.orderIds ?? []).length,
      amount: plain.amountCents / 100,
      amountCents: plain.amountCents,
      method: plain.method,
      reference: plain.reference,
      note: plain.note,
      status: plain.status,
      erpReference: plain.erpReference,
      validatedAt: plain.validatedAt,
      validatedBy: validator?.id ?? (plain.validatedBy ? String(plain.validatedBy) : null),
      validatedByEmail: validator?.email ?? null,
      rejectionReason: plain.rejectionReason,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  CSV Generation
  // ────────────────────────────────────────────────────────────────

  private generateCsv(
    settlements: SettlementDocument[],
    orders: OrderDocument[],
    from: Date,
    to: Date,
  ): { content: string; contentType: string; filename: string } {
    const lines: string[] = [];

    // Header
    lines.push('FINANCIAL STATEMENT');
    lines.push(`Period: ${from.toISOString().split('T')[0]} to ${to.toISOString().split('T')[0]}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Orders section
    lines.push('--- ORDERS ---');
    lines.push(
      'Order ID,Status,Customer Email,Total Amount,Delivered Date,Items',
    );

    for (const order of orders) {
      const plain = order.toJSON() as Record<string, any>;
      const user =
        plain.userId && typeof plain.userId === 'object'
          ? plain.userId
          : null;

      lines.push(
        [
          plain.id,
          plain.status,
          user?.email ?? '',
          (Number(plain.totalAmount) / 100).toFixed(2),
          plain.updatedAt
            ? new Date(plain.updatedAt).toISOString().split('T')[0]
            : '',
          (plain.items ?? []).length,
        ].join(','),
      );
    }

    lines.push('');

    // Settlements section
    lines.push('--- SETTLEMENTS ---');
    lines.push(
      'Settlement ID,Status,Method,Amount,Reference,Orders Covered,Created Date,Validated Date',
    );

    for (const settlement of settlements) {
      const plain = settlement.toJSON() as Record<string, any>;

      lines.push(
        [
          plain.id,
          plain.status,
          plain.method,
          (plain.amountCents / 100).toFixed(2),
          plain.reference ?? '',
          (plain.orderIds ?? []).length,
          plain.createdAt
            ? new Date(plain.createdAt).toISOString().split('T')[0]
            : '',
          plain.validatedAt
            ? new Date(plain.validatedAt).toISOString().split('T')[0]
            : '',
        ].join(','),
      );
    }

    // Summary
    lines.push('');
    lines.push('--- SUMMARY ---');
    const totalOrders = orders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );
    const totalSettled = settlements
      .filter((s) => s.status === 'VALIDATED')
      .reduce((sum, s) => sum + s.amountCents, 0);

    lines.push(`Total Order Value,${(totalOrders / 100).toFixed(2)}`);
    lines.push(`Total Settled,${(totalSettled / 100).toFixed(2)}`);
    lines.push(
      `Outstanding Balance,${((totalOrders - totalSettled) / 100).toFixed(2)}`,
    );

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    return {
      content: lines.join('\n'),
      contentType: 'text/csv',
      filename: `financial-statement_${fromStr}_${toStr}.csv`,
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  PDF (HTML) Generation
  // ────────────────────────────────────────────────────────────────

  private generatePdfHtml(
    settlements: SettlementDocument[],
    orders: OrderDocument[],
    from: Date,
    to: Date,
  ): { content: string; contentType: string; filename: string } {
    const totalOrders = orders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );
    const totalSettled = settlements
      .filter((s) => s.status === 'VALIDATED')
      .reduce((sum, s) => sum + s.amountCents, 0);

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    let html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Financial Statement ${fromStr} to ${toStr}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 2em; color: #333; }
  h1 { color: #1a1a2e; border-bottom: 2px solid #16213e; padding-bottom: 0.5em; }
  h2 { color: #16213e; margin-top: 2em; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
  th { background: #16213e; color: white; padding: 10px 8px; text-align: left; }
  td { padding: 8px; border-bottom: 1px solid #ddd; }
  tr:nth-child(even) { background: #f8f9fa; }
  .summary { background: #e8f4f8; padding: 1.5em; border-radius: 8px; margin-top: 2em; }
  .summary h3 { margin-top: 0; }
  .amount { font-family: monospace; }
  .status-validated { color: #28a745; font-weight: bold; }
  .status-pending { color: #ffc107; font-weight: bold; }
  .status-rejected { color: #dc3545; font-weight: bold; }
  .meta { color: #666; font-size: 0.85em; margin-bottom: 2em; }
</style>
</head><body>
<h1>Financial Statement</h1>
<div class="meta">
  <p>Period: ${fromStr} to ${toStr}</p>
  <p>Generated: ${new Date().toISOString().split('T')[0]}</p>
</div>`;

    // Orders table
    html += `<h2>Orders</h2>
<table>
<tr><th>Order ID</th><th>Status</th><th>Customer</th><th>Amount</th><th>Date</th></tr>`;

    for (const order of orders) {
      const plain = order.toJSON() as Record<string, any>;
      const user =
        plain.userId && typeof plain.userId === 'object'
          ? plain.userId
          : null;

      html += `<tr>
  <td>${plain.id}</td>
  <td>${plain.status}</td>
  <td>${user?.email ?? '—'}</td>
  <td class="amount">$${(Number(plain.totalAmount) / 100).toFixed(2)}</td>
  <td>${plain.updatedAt ? new Date(plain.updatedAt).toLocaleDateString() : '—'}</td>
</tr>`;
    }

    html += '</table>';

    // Settlements table
    html += `<h2>Settlements</h2>
<table>
<tr><th>ID</th><th>Status</th><th>Method</th><th>Amount</th><th>Reference</th><th>Orders</th><th>Date</th></tr>`;

    for (const settlement of settlements) {
      const plain = settlement.toJSON() as Record<string, any>;
      const statusClass =
        plain.status === 'VALIDATED'
          ? 'status-validated'
          : plain.status === 'REJECTED'
            ? 'status-rejected'
            : 'status-pending';

      html += `<tr>
  <td>${plain.id}</td>
  <td class="${statusClass}">${plain.status}</td>
  <td>${plain.method}</td>
  <td class="amount">$${(plain.amountCents / 100).toFixed(2)}</td>
  <td>${plain.reference ?? '—'}</td>
  <td>${(plain.orderIds ?? []).length}</td>
  <td>${plain.createdAt ? new Date(plain.createdAt).toLocaleDateString() : '—'}</td>
</tr>`;
    }

    html += '</table>';

    // Summary
    html += `<div class="summary">
<h3>Summary</h3>
<p><strong>Total Order Value:</strong> <span class="amount">$${(totalOrders / 100).toFixed(2)}</span></p>
<p><strong>Total Settled:</strong> <span class="amount">$${(totalSettled / 100).toFixed(2)}</span></p>
<p><strong>Outstanding Balance:</strong> <span class="amount">$${((totalOrders - totalSettled) / 100).toFixed(2)}</span></p>
</div>
</body></html>`;

    return {
      content: html,
      contentType: 'text/html',
      filename: `financial-statement_${fromStr}_${toStr}.html`,
    };
  }
}
