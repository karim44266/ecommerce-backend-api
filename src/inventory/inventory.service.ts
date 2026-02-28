import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, lte, or, sql, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import {
  InventoryQueryDto,
  InventorySortBy,
  SortOrder,
  StockFilter,
} from './dto/inventory-query.dto';
import { HistoryQueryDto } from './dto/inventory-query.dto';

type InventoryRow = {
  inventory: typeof schema.inventoryItems.$inferSelect;
  productName: string;
  productSku: string;
  productStatus: string;
};

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ───── Escape LIKE wildcards to prevent injection via % and _ ─────
  private escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, '\\$&');
  }

  // ───── Shared response mapper (DRY) ─────
  private toResponse(r: InventoryRow, overrides?: { isLowStock?: boolean }) {
    return {
      id: r.inventory.id,
      productId: r.inventory.productId,
      productName: r.productName,
      productSku: r.productSku,
      productStatus: r.productStatus,
      quantity: r.inventory.quantity,
      lowStockThreshold: r.inventory.lowStockThreshold,
      isLowStock:
        overrides?.isLowStock ??
        r.inventory.quantity <= r.inventory.lowStockThreshold,
      lastAdjustedAt: r.inventory.lastAdjustedAt,
      createdAt: r.inventory.createdAt,
    };
  }

  // ───── Shared base query builder ─────
  private baseQuery() {
    return this.db
      .select({
        inventory: schema.inventoryItems,
        productName: schema.products.name,
        productSku: schema.products.sku,
        productStatus: schema.products.status,
      })
      .from(schema.inventoryItems)
      .innerJoin(
        schema.products,
        eq(schema.inventoryItems.productId, schema.products.id),
      );
  }

  // ───── Build reusable count query from same join ─────
  private countQuery() {
    return this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.inventoryItems)
      .innerJoin(
        schema.products,
        eq(schema.inventoryItems.productId, schema.products.id),
      );
  }

  // ───── Build WHERE conditions for stock status filter ─────
  private buildStatusCondition(status: StockFilter): SQL | undefined {
    switch (status) {
      case StockFilter.OUT:
        return lte(schema.inventoryItems.quantity, 0);
      case StockFilter.LOW:
        return and(
          gte(schema.inventoryItems.quantity, 1),
          lte(
            schema.inventoryItems.quantity,
            sql`${schema.inventoryItems.lowStockThreshold}`,
          ),
        );
      case StockFilter.IN_STOCK:
        return sql`${schema.inventoryItems.quantity} > ${schema.inventoryItems.lowStockThreshold}`;
      default:
        return undefined;
    }
  }

  // ───── Ensure inventory record exists (ON CONFLICT safe) ─────
  async ensureInventory(productId: string, initialQuantity = 0) {
    const [record] = await this.db
      .insert(schema.inventoryItems)
      .values({
        productId,
        quantity: initialQuantity,
      })
      .onConflictDoNothing({ target: schema.inventoryItems.productId })
      .returning();

    // If conflict occurred, returning() yields nothing — fetch existing
    if (!record) {
      const existing = await this.db.query.inventoryItems.findFirst({
        where: eq(schema.inventoryItems.productId, productId),
      });
      return existing!;
    }

    return record;
  }

  // ───── Inventory summary (accurate counts across ALL data) ─────
  async getSummary() {
    const [result] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        low: sql<number>`count(*) filter (where ${schema.inventoryItems.quantity} > 0 and ${schema.inventoryItems.quantity} <= ${schema.inventoryItems.lowStockThreshold})::int`,
        out: sql<number>`count(*) filter (where ${schema.inventoryItems.quantity} <= 0)::int`,
        inStock: sql<number>`count(*) filter (where ${schema.inventoryItems.quantity} > ${schema.inventoryItems.lowStockThreshold})::int`,
      })
      .from(schema.inventoryItems);

    return result;
  }

  // ───── List inventory items (paginated, filterable, sortable) ─────
  async findAll(query: InventoryQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    // Build WHERE conditions
    const conditions: SQL[] = [];

    if (query.search) {
      const escaped = this.escapeLike(query.search);
      conditions.push(
        or(
          ilike(schema.products.name, `%${escaped}%`),
          ilike(schema.products.sku, `%${escaped}%`),
        )!,
      );
    }

    if (query.status && query.status !== StockFilter.ALL) {
      const statusCond = this.buildStatusCondition(query.status);
      if (statusCond) conditions.push(statusCond);
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Build ORDER BY
    const sortDir = query.order === SortOrder.DESC ? desc : asc;
    let orderCol: SQL | ReturnType<typeof asc>;
    switch (query.sortBy) {
      case InventorySortBy.QUANTITY:
        orderCol = sortDir(schema.inventoryItems.quantity);
        break;
      case InventorySortBy.THRESHOLD:
        orderCol = sortDir(schema.inventoryItems.lowStockThreshold);
        break;
      case InventorySortBy.LAST_ADJUSTED:
        orderCol = sortDir(schema.inventoryItems.lastAdjustedAt);
        break;
      default:
        orderCol = sortDir(schema.products.name);
    }

    // Count total (reuses shared join — DRY)
    const [{ count }] = await this.countQuery().where(whereClause);

    // Fetch page
    const rows = await this.baseQuery()
      .where(whereClause)
      .orderBy(orderCol)
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.toResponse(r)),
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  // ───── Get single inventory record by productId ─────
  async findByProductId(productId: string) {
    const rows = await this.baseQuery()
      .where(eq(schema.inventoryItems.productId, productId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(
        'Inventory record not found for this product',
      );
    }

    return this.toResponse(rows[0]);
  }

  // ───── Low stock items (paginated) ─────
  async findLowStock(query: InventoryQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const lowStockCondition = lte(
      schema.inventoryItems.quantity,
      sql`${schema.inventoryItems.lowStockThreshold}`,
    );

    const [{ count }] = await this.countQuery().where(lowStockCondition);

    const rows = await this.baseQuery()
      .where(lowStockCondition)
      .orderBy(schema.inventoryItems.quantity)
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.toResponse(r, { isLowStock: true })),
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  // ───── Adjust stock (atomic — race-condition safe) ─────
  async adjust(
    productId: string,
    adjustment: number,
    reason?: string,
    adjustedBy?: string,
  ) {
    return this.db.transaction(async (tx) => {
      // Atomic read inside transaction with row lock (FOR UPDATE)
      const items = await tx
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.productId, productId))
        .for('update');

      if (items.length === 0) {
        throw new NotFoundException(
          'Inventory record not found for this product',
        );
      }

      const item = items[0];
      const newQuantity = item.quantity + adjustment;

      if (newQuantity < 0) {
        throw new BadRequestException(
          `Cannot reduce stock below 0. Current: ${item.quantity}, requested adjustment: ${adjustment}`,
        );
      }

      // Atomic update
      await tx
        .update(schema.inventoryItems)
        .set({
          quantity: newQuantity,
          lastAdjustedAt: new Date(),
        })
        .where(eq(schema.inventoryItems.id, item.id));

      // Keep products.inventory in sync
      await tx
        .update(schema.products)
        .set({
          inventory: newQuantity,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, productId));

      // Record the audit log
      await tx.insert(schema.inventoryAdjustments).values({
        inventoryItemId: item.id,
        adjustment,
        reason: reason ?? null,
        adjustedBy: adjustedBy ?? null,
      });

      // Resolve who made the change
      let adjustedByEmail: string | null = null;
      if (adjustedBy) {
        const user = await tx.query.users.findFirst({
          where: eq(schema.users.id, adjustedBy),
          columns: { email: true },
        });
        adjustedByEmail = user?.email ?? null;
      }

      // Return updated record (still inside tx for consistency)
      const updated = await tx
        .select({
          inventory: schema.inventoryItems,
          productName: schema.products.name,
          productSku: schema.products.sku,
          productStatus: schema.products.status,
        })
        .from(schema.inventoryItems)
        .innerJoin(
          schema.products,
          eq(schema.inventoryItems.productId, schema.products.id),
        )
        .where(eq(schema.inventoryItems.productId, productId))
        .limit(1);

      return {
        ...this.toResponse(updated[0]),
        adjustedBy: adjustedByEmail,
        adjustmentApplied: adjustment,
      };
    });
  }

  // ───── Update low-stock threshold for a product ─────
  async updateThreshold(productId: string, newThreshold: number) {
    const item = await this.db.query.inventoryItems.findFirst({
      where: eq(schema.inventoryItems.productId, productId),
    });

    if (!item) {
      throw new NotFoundException(
        'Inventory record not found for this product',
      );
    }

    await this.db
      .update(schema.inventoryItems)
      .set({ lowStockThreshold: newThreshold })
      .where(eq(schema.inventoryItems.id, item.id));

    return this.findByProductId(productId);
  }

  // ───── Get adjustment history (paginated) ─────
  async getAdjustmentHistory(productId: string, query: HistoryQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const item = await this.db.query.inventoryItems.findFirst({
      where: eq(schema.inventoryItems.productId, productId),
    });

    if (!item) {
      throw new NotFoundException(
        'Inventory record not found for this product',
      );
    }

    // Count total
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.inventoryAdjustments)
      .where(eq(schema.inventoryAdjustments.inventoryItemId, item.id));

    // Fetch page
    const rows = await this.db
      .select({
        adjustment: schema.inventoryAdjustments,
        adjustedByEmail: schema.users.email,
      })
      .from(schema.inventoryAdjustments)
      .leftJoin(
        schema.users,
        eq(schema.inventoryAdjustments.adjustedBy, schema.users.id),
      )
      .where(eq(schema.inventoryAdjustments.inventoryItemId, item.id))
      .orderBy(sql`${schema.inventoryAdjustments.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => ({
        id: r.adjustment.id,
        adjustment: r.adjustment.adjustment,
        reason: r.adjustment.reason,
        adjustedBy: r.adjustedByEmail ?? null,
        createdAt: r.adjustment.createdAt,
      })),
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  // ───── Backfill: create inventory records for products that lack one (transactional) ─────
  async backfill() {
    return this.db.transaction(async (tx) => {
      const missing = await tx
        .select({ id: schema.products.id, inventory: schema.products.inventory })
        .from(schema.products)
        .leftJoin(
          schema.inventoryItems,
          eq(schema.products.id, schema.inventoryItems.productId),
        )
        .where(sql`${schema.inventoryItems.id} IS NULL`);

      if (missing.length === 0) {
        return { created: 0, message: 'All products already have inventory records' };
      }

      const values = missing.map((p) => ({
        productId: p.id,
        quantity: p.inventory ?? 0,
      }));

      await tx.insert(schema.inventoryItems).values(values);

      return {
        created: missing.length,
        message: `Created inventory records for ${missing.length} product(s)`,
      };
    });
  }
}
