import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Create an order inside a transaction:
   * 1. Validate products exist and are active
   * 2. Check stock availability
   * 3. Calculate total from DB prices (not client-sent)
   * 4. Insert order + order items
   * 5. Decrement inventory atomically
   */
  async create(userId: string, dto: CreateOrderDto) {
    const productIds = dto.items.map((i) => i.productId);

    // Fetch products from DB
    const dbProducts = await this.db
      .select()
      .from(schema.products)
      .where(inArray(schema.products.id, productIds));

    // Build lookup
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    // Validate all products exist and are active
    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(
          `Product ${item.productId} not found`,
        );
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

    // Calculate total in cents from DB prices
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

    // Perform everything in a transaction
    const result = await this.db.transaction(async (tx) => {
      // Decrement inventory with optimistic locking
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

      // Insert order
      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId,
          status: 'PENDING_PAYMENT',
          totalAmount: totalCents,
          shippingAddress: { address: dto.shippingAddress },
        })
        .returning();

      // Insert order items
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

      return { order, items: insertedItems };
    });

    return this.formatOrder(result.order, result.items);
  }

  /**
   * List paginated orders for a user (or all orders for ADMIN).
   */
  async findAll(
    userId: string,
    roles: string[],
    query: OrderQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const isAdmin = roles.includes('ADMIN');

    const conditions = isAdmin ? undefined : eq(schema.orders.userId, userId);

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(conditions);

    const total = countResult?.count ?? 0;

    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(conditions)
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch items for all orders in one query
    const orderIds = rows.map((r) => r.id);
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

    const data = rows.map((order) =>
      this.formatOrder(order, itemsByOrder.get(order.id) ?? []),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single order. Owner or ADMIN only.
   */
  async findById(orderId: string, userId: string, roles: string[]) {
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

    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    return this.formatOrder(order, items);
  }

  /** Format order + items into the API response shape. */
  private formatOrder(
    order: typeof schema.orders.$inferSelect,
    items: (typeof schema.orderItems.$inferSelect)[],
  ) {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      totalAmount: order.totalAmount / 100, // convert cents to dollars
      shippingAddress:
        typeof order.shippingAddress === 'object' &&
        order.shippingAddress !== null &&
        'address' in (order.shippingAddress as Record<string, unknown>)
          ? (order.shippingAddress as { address: string }).address
          : String(order.shippingAddress ?? ''),
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice / 100, // convert cents to dollars
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
