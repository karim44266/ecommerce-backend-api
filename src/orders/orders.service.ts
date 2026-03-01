import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderStatusDto, STATUS_TRANSITIONS } from './dto/update-order-status.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  Create Order
  // ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateOrderDto) {
    const productIds = dto.items.map((i) => i.productId);

    const dbProducts = await this.db
      .select()
      .from(schema.products)
      .where(inArray(schema.products.id, productIds));

    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
      if (product.status !== 'active') {
        throw new BadRequestException(
          `Product "${product.name}" is not available for purchase`,
        );
      }
      if (product.inventory < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}": requested ${item.quantity}, available ${product.inventory}`,
        );
      }
    }

    let totalCents = 0;
    const itemsWithPrice = dto.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPriceCents = Math.round(Number(product.price) * 100);
      totalCents += unitPriceCents * item.quantity;
      return {
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPriceCents,
      };
    });

    const result = await this.db.transaction(async (tx) => {
      for (const item of dto.items) {
        const [updated] = await tx
          .update(schema.products)
          .set({
            inventory: sql`${schema.products.inventory} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            sql`${schema.products.id} = ${item.productId} AND ${schema.products.inventory} >= ${item.quantity}`,
          )
          .returning({ id: schema.products.id });

        if (!updated) {
          throw new BadRequestException(
            `Stock changed for product "${productMap.get(item.productId)?.name}". Please refresh and try again.`,
          );
        }
      }

      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId,
          status: 'PENDING_PAYMENT',
          totalAmount: totalCents,
          shippingAddress: dto.shippingAddress as unknown as Record<string, unknown>,
        })
        .returning();

      const orderItemValues = itemsWithPrice.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPriceCents,
      }));

      const insertedItems = await tx
        .insert(schema.orderItems)
        .values(orderItemValues)
        .returning();

      // Record initial status in audit trail
      await tx.insert(schema.orderStatusHistory).values({
        orderId: order.id,
        status: 'PENDING_PAYMENT',
        note: 'Order created',
        changedBy: userId,
      });

      return { order, items: insertedItems };
    });

    return this.formatOrder(result.order, result.items);
  }

  // ────────────────────────────────────────────────────────────────
  //  List Orders (admin or customer)
  // ────────────────────────────────────────────────────────────────

  async findAll(userId: string, roles: string[], query: OrderQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const isAdmin = roles.includes('ADMIN');

    const conditions: ReturnType<typeof eq>[] = [];
    if (!isAdmin) {
      conditions.push(eq(schema.orders.userId, userId));
    }
    if (query.status) {
      conditions.push(eq(schema.orders.status, query.status));
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Build search condition (requires LEFT JOIN on users)
    const searchCondition = query.search
      ? or(
          sql`${schema.orders.id}::text ILIKE ${'%' + query.search + '%'}`,
          ilike(schema.users.email, `%${query.search}%`),
        )
      : undefined;

    const finalWhere = searchCondition
      ? whereClause
        ? and(whereClause, searchCondition)
        : searchCondition
      : whereClause;

    // Count
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(finalWhere);

    const total = countResult?.count ?? 0;

    // Sort
    const sortDir = query.sortOrder === 'asc' ? asc : desc;
    const sortColumnMap: Record<string, unknown> = {
      createdAt: schema.orders.createdAt,
      updatedAt: schema.orders.updatedAt,
      totalAmount: schema.orders.totalAmount,
      status: schema.orders.status,
    };
    const orderBy = sortDir(
      (sortColumnMap[query.sortBy ?? 'createdAt'] ?? schema.orders.createdAt) as typeof schema.orders.createdAt,
    );

    // Fetch rows with user email
    const rows = await this.db
      .select({
        order: schema.orders,
        customerEmail: schema.users.email,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(finalWhere)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // Fetch items for all orders in one query
    const orderIds = rows.map((r) => r.order.id);
    const allItems =
      orderIds.length > 0
        ? await this.db
            .select()
            .from(schema.orderItems)
            .where(inArray(schema.orderItems.orderId, orderIds))
        : [];

    const itemsByOrder = new Map<string, (typeof allItems)[number][]>();
    for (const item of allItems) {
      const arr = itemsByOrder.get(item.orderId) ?? [];
      arr.push(item);
      itemsByOrder.set(item.orderId, arr);
    }

    const data = rows.map((r) => ({
      ...this.formatOrder(r.order, itemsByOrder.get(r.order.id) ?? []),
      customerEmail: r.customerEmail,
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Get Order Detail (owner or ADMIN)
  // ────────────────────────────────────────────────────────────────

  async findById(orderId: string, userId: string, roles: string[]) {
    const rows = await this.db
      .select({
        order: schema.orders,
        customerEmail: schema.users.email,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Order not found');
    }

    const { order, customerEmail } = rows[0];
    const isAdmin = roles.includes('ADMIN');
    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    // Fetch audit trail
    const history = await this.db
      .select({
        id: schema.orderStatusHistory.id,
        status: schema.orderStatusHistory.status,
        note: schema.orderStatusHistory.note,
        changedBy: schema.orderStatusHistory.changedBy,
        changedByEmail: schema.users.email,
        createdAt: schema.orderStatusHistory.createdAt,
      })
      .from(schema.orderStatusHistory)
      .leftJoin(
        schema.users,
        eq(schema.orderStatusHistory.changedBy, schema.users.id),
      )
      .where(eq(schema.orderStatusHistory.orderId, orderId))
      .orderBy(asc(schema.orderStatusHistory.createdAt));

    return {
      ...this.formatOrder(order, items),
      customerEmail,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      statusHistory: history.map((h) => ({
        id: h.id,
        status: h.status,
        note: h.note,
        changedBy: h.changedBy,
        changedByEmail: h.changedByEmail,
        createdAt: h.createdAt,
      })),
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Update Order Status (ADMIN only, with transition validation)
  // ────────────────────────────────────────────────────────────────

  async updateStatus(
    orderId: string,
    adminUserId: string,
    dto: UpdateOrderStatusDto,
  ) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const currentStatus = order.status;
    const allowedNext = STATUS_TRANSITIONS[currentStatus] ?? [];

    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${dto.status}. Allowed: ${allowedNext.join(', ') || 'none (terminal state)'}`,
      );
    }

    const result = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.orders)
        .set({
          status: dto.status,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId))
        .returning();

      await tx.insert(schema.orderStatusHistory).values({
        orderId,
        status: dto.status,
        note: dto.note ?? `Status changed from ${currentStatus} to ${dto.status}`,
        changedBy: adminUserId,
      });

      return updated;
    });

    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    return this.formatOrder(result, items);
  }

  // ────────────────────────────────────────────────────────────────
  //  Update Tracking Info (ADMIN only)
  // ────────────────────────────────────────────────────────────────

  async updateTracking(
    orderId: string,
    adminUserId: string,
    dto: UpdateTrackingDto,
  ) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const result = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.orders)
        .set({
          trackingNumber: dto.trackingNumber,
          carrier: dto.carrier,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId))
        .returning();

      await tx.insert(schema.orderStatusHistory).values({
        orderId,
        status: order.status, // keep current status
        note:
          dto.note ??
          `Tracking updated: ${dto.carrier} ${dto.trackingNumber}`,
        changedBy: adminUserId,
      });

      return updated;
    });

    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    return this.formatOrder(result, items);
  }

  // ────────────────────────────────────────────────────────────────
  //  Get Status History (audit trail)
  // ────────────────────────────────────────────────────────────────

  async getStatusHistory(orderId: string, userId: string, roles: string[]) {
    // Verify access
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isAdmin = roles.includes('ADMIN');
    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const history = await this.db
      .select({
        id: schema.orderStatusHistory.id,
        status: schema.orderStatusHistory.status,
        note: schema.orderStatusHistory.note,
        changedBy: schema.orderStatusHistory.changedBy,
        changedByEmail: schema.users.email,
        createdAt: schema.orderStatusHistory.createdAt,
      })
      .from(schema.orderStatusHistory)
      .leftJoin(
        schema.users,
        eq(schema.orderStatusHistory.changedBy, schema.users.id),
      )
      .where(eq(schema.orderStatusHistory.orderId, orderId))
      .orderBy(asc(schema.orderStatusHistory.createdAt));

    return history;
  }

  // ────────────────────────────────────────────────────────────────
  //  Format helper
  // ────────────────────────────────────────────────────────────────

  private formatOrder(
    order: typeof schema.orders.$inferSelect,
    items: (typeof schema.orderItems.$inferSelect)[],
  ) {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      totalAmount: order.totalAmount / 100,
      shippingAddress: order.shippingAddress,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice / 100,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
