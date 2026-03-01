import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, sql, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────

  /** Convert cents to dollars for API response. */
  private centsToAmount(cents: number): number {
    return cents / 100;
  }

  /** Format a raw order row + items + history into the API response shape. */
  private formatOrder(
    order: typeof schema.orders.$inferSelect,
    items: (typeof schema.orderItems.$inferSelect)[],
    history?: {
      id: string;
      status: string;
      note: string | null;
      changedBy: string | null;
      createdAt: Date;
      changedByEmail?: string | null;
    }[],
    customerEmail?: string | null,
  ) {
    return {
      id: order.id,
      userId: order.userId,
      customerEmail: customerEmail ?? undefined,
      status: order.status,
      totalAmount: this.centsToAmount(order.totalAmount),
      shippingAddress: order.shippingAddress,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      items: items.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.name,
        quantity: it.quantity,
        unitPrice: this.centsToAmount(it.unitPrice),
      })),
      statusHistory: history?.map((h) => ({
        id: h.id,
        status: h.status,
        note: h.note,
        changedBy: h.changedBy,
        changedByEmail: h.changedByEmail ?? undefined,
        createdAt: h.createdAt,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Create Order
  // ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateOrderDto) {
    // Look up all products in a single query
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.db
      .select()
      .from(schema.products)
      .where(
        sql`${schema.products.id} IN (${sql.join(
          productIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate stock & compute total
    let totalCents = 0;
    const orderItemValues: {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }[] = [];

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found`);
      }
      if (product.status !== 'active') {
        throw new BadRequestException(`Product "${product.name}" is not available`);
      }
      if (product.inventory < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}" (available: ${product.inventory})`,
        );
      }
      const priceCents = Math.round(Number(product.price) * 100);
      totalCents += priceCents * item.quantity;
      orderItemValues.push({
        productId: product.id,
        name: product.name!,
        quantity: item.quantity,
        unitPrice: priceCents,
      });
    }

    // Transactional insert: order + items + stock decrement + status history
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId,
          status: 'PENDING_PAYMENT',
          totalAmount: totalCents,
          shippingAddress: dto.shippingAddress,
        })
        .returning();

      const items = await tx
        .insert(schema.orderItems)
        .values(
          orderItemValues.map((v) => ({
            orderId: order.id,
            ...v,
          })),
        )
        .returning();

      // Decrement product inventory
      for (const item of dto.items) {
        await tx
          .update(schema.products)
          .set({
            inventory: sql`${schema.products.inventory} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.products.id, item.productId));
      }

      // Record initial status in history
      await tx.insert(schema.orderStatusHistory).values({
        orderId: order.id,
        status: 'PENDING_PAYMENT',
        note: 'Order created',
        changedBy: userId,
      });

      return this.formatOrder(order, items, [
        {
          id: '',
          status: 'PENDING_PAYMENT',
          note: 'Order created',
          changedBy: userId,
          createdAt: order.createdAt,
        },
      ]);
    });
  }

  // ────────────────────────────────────────────────────────────────
  //  List Orders (admin or customer)
  // ────────────────────────────────────────────────────────────────

  async findAll(query: OrderQueryDto, userId?: string, isAdmin = false) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];

    // Customers can only see their own orders
    if (!isAdmin && userId) {
      conditions.push(eq(schema.orders.userId, userId));
    }

    if (query.status) {
      conditions.push(eq(schema.orders.status, query.status));
    }

    if (query.search) {
      // Search by order ID prefix or customer email
      conditions.push(
        sql`(${schema.orders.id}::text ILIKE ${'%' + query.search + '%'} OR ${schema.users.email} ILIKE ${'%' + query.search + '%'})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Build ordering
    const dir = query.sortOrder === 'asc' ? asc : desc;
    const sortColumnMap: Record<string, unknown> = {
      createdAt: schema.orders.createdAt,
      updatedAt: schema.orders.updatedAt,
      totalAmount: schema.orders.totalAmount,
      status: schema.orders.status,
    };
    const orderBy = dir(
      (sortColumnMap[query.sortBy ?? 'createdAt'] ?? schema.orders.createdAt) as typeof schema.orders.createdAt,
    );

    // Count total
    const [{ count: total }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(whereClause);

    // Fetch rows
    const rows = await this.db
      .select({
        order: schema.orders,
        customerEmail: schema.users.email,
        customerName: schema.users.name,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) => ({
      id: r.order.id,
      userId: r.order.userId,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      status: r.order.status,
      totalAmount: this.centsToAmount(r.order.totalAmount),
      trackingNumber: r.order.trackingNumber,
      carrier: r.order.carrier,
      createdAt: r.order.createdAt,
      updatedAt: r.order.updatedAt,
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Get Order by ID (with items + status history)
  // ────────────────────────────────────────────────────────────────

  async findById(id: string, userId?: string, isAdmin = false) {
    const rows = await this.db
      .select({
        order: schema.orders,
        customerEmail: schema.users.email,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Order not found');
    }

    const order = rows[0].order;

    // Access control: customers can only see their own orders
    if (!isAdmin && userId && order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    // Fetch items
    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));

    // Fetch status history with user emails
    const historyRows = await this.db
      .select({
        history: schema.orderStatusHistory,
        changedByEmail: schema.users.email,
      })
      .from(schema.orderStatusHistory)
      .leftJoin(
        schema.users,
        eq(schema.orderStatusHistory.changedBy, schema.users.id),
      )
      .where(eq(schema.orderStatusHistory.orderId, id))
      .orderBy(asc(schema.orderStatusHistory.createdAt));

    const history = historyRows.map((h) => ({
      id: h.history.id,
      status: h.history.status,
      note: h.history.note,
      changedBy: h.history.changedBy,
      changedByEmail: h.changedByEmail,
      createdAt: h.history.createdAt,
    }));

    return this.formatOrder(order, items, history, rows[0].customerEmail);
  }

  // ────────────────────────────────────────────────────────────────
  //  Update Order Status (admin)
  // ────────────────────────────────────────────────────────────────

  async updateStatus(orderId: string, dto: UpdateOrderStatusDto, changedBy: string) {
    const order = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (order.length === 0) {
      throw new NotFoundException('Order not found');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({ status: dto.status, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId));

      await tx.insert(schema.orderStatusHistory).values({
        orderId,
        status: dto.status,
        note: dto.note ?? null,
        changedBy,
      });
    });

    return this.findById(orderId, undefined, true);
  }

  // ────────────────────────────────────────────────────────────────
  //  Update Tracking Info (admin)
  // ────────────────────────────────────────────────────────────────

  async updateTracking(orderId: string, dto: UpdateTrackingDto, changedBy: string) {
    const order = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (order.length === 0) {
      throw new NotFoundException('Order not found');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({
          trackingNumber: dto.trackingNumber,
          carrier: dto.carrier,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      await tx.insert(schema.orderStatusHistory).values({
        orderId,
        status: order[0].status, // keep current status
        note: dto.note ?? `Tracking updated: ${dto.carrier} ${dto.trackingNumber}`,
        changedBy,
      });
    });

    return this.findById(orderId, undefined, true);
  }
}
