import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, sql, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { AssignShipmentDto } from './dto/assign-shipment.dto';

@Injectable()
export class ShipmentsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────

  private formatShipment(
    shipment: typeof schema.shipments.$inferSelect,
    staffEmail?: string | null,
    staffName?: string | null,
    orderStatus?: string | null,
    customerEmail?: string | null,
  ) {
    return {
      id: shipment.id,
      orderId: shipment.orderId,
      staffUserId: shipment.staffUserId,
      staffEmail: staffEmail ?? undefined,
      staffName: staffName ?? undefined,
      orderStatus: orderStatus ?? undefined,
      customerEmail: customerEmail ?? undefined,
      status: shipment.status,
      trackingNumber: shipment.trackingNumber,
      assignedAt: shipment.assignedAt,
      deliveredAt: shipment.deliveredAt,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  Create Shipment (ADMIN)
  // ──────────────────────────────────────────────────────────────

  async create(dto: CreateShipmentDto) {
    // 1) Validate order exists and has PAID or PROCESSING status
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, dto.orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!['PAID', 'PROCESSING'].includes(order.status)) {
      throw new BadRequestException(
        `Order must be in PAID or PROCESSING status to create a shipment (current: ${order.status})`,
      );
    }

    // 2) Check no existing shipment for this order
    const [existing] = await this.db
      .select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(eq(schema.shipments.orderId, dto.orderId))
      .limit(1);

    if (existing) {
      throw new BadRequestException('A shipment already exists for this order');
    }

    // 3) Validate staff user exists and has STAFF role
    const [staffUser] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, dto.staffUserId))
      .limit(1);

    if (!staffUser) {
      throw new NotFoundException('Staff user not found');
    }

    if (staffUser.role !== 'staff') {
      throw new BadRequestException('Assigned user must have the STAFF role');
    }

    // 4) Transactionally create shipment + transition order to PROCESSING
    return this.db.transaction(async (tx) => {
      const [shipment] = await tx
        .insert(schema.shipments)
        .values({
          orderId: dto.orderId,
          staffUserId: dto.staffUserId,
          status: 'ASSIGNED',
          trackingNumber: dto.trackingNumber ?? null,
        })
        .returning();

      // Transition order to PROCESSING if it's still PAID
      if (order.status === 'PAID') {
        await tx
          .update(schema.orders)
          .set({ status: 'PROCESSING', updatedAt: new Date() })
          .where(eq(schema.orders.id, dto.orderId));

        await tx.insert(schema.orderStatusHistory).values({
          orderId: dto.orderId,
          status: 'PROCESSING',
          note: 'Shipment created – order moved to PROCESSING',
          changedBy: null,
        });
      }

      return this.formatShipment(shipment);
    });
  }

  // ──────────────────────────────────────────────────────────────
  //  List Shipments (ADMIN sees all, STAFF sees own)
  // ──────────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    isAdmin: boolean,
    query?: { status?: string; staffId?: string },
  ) {
    const staffAlias = schema.users;

    const conditions: SQL[] = [];

    // STAFF can only see their own shipments
    if (!isAdmin) {
      conditions.push(eq(schema.shipments.staffUserId, userId));
    }

    if (query?.status) {
      conditions.push(eq(schema.shipments.status, query.status));
    }

    if (query?.staffId) {
      conditions.push(eq(schema.shipments.staffUserId, query.staffId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        shipment: schema.shipments,
        staffEmail: staffAlias.email,
        staffName: staffAlias.name,
        orderStatus: schema.orders.status,
      })
      .from(schema.shipments)
      .leftJoin(staffAlias, eq(schema.shipments.staffUserId, staffAlias.id))
      .leftJoin(schema.orders, eq(schema.shipments.orderId, schema.orders.id))
      .where(whereClause)
      .orderBy(desc(schema.shipments.createdAt));

    return rows.map((r) =>
      this.formatShipment(r.shipment, r.staffEmail, r.staffName, r.orderStatus),
    );
  }

  // ──────────────────────────────────────────────────────────────
  //  Get Single Shipment (ADMIN or own STAFF)
  // ──────────────────────────────────────────────────────────────

  async findById(id: string, userId: string, isAdmin: boolean) {
    const rows = await this.db
      .select({
        shipment: schema.shipments,
        staffEmail: schema.users.email,
        staffName: schema.users.name,
        orderStatus: schema.orders.status,
      })
      .from(schema.shipments)
      .leftJoin(schema.users, eq(schema.shipments.staffUserId, schema.users.id))
      .leftJoin(schema.orders, eq(schema.shipments.orderId, schema.orders.id))
      .where(eq(schema.shipments.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Shipment not found');
    }

    const row = rows[0];

    // STAFF can only view their own
    if (!isAdmin && row.shipment.staffUserId !== userId) {
      throw new ForbiddenException('You do not have access to this shipment');
    }

    return this.formatShipment(
      row.shipment,
      row.staffEmail,
      row.staffName,
      row.orderStatus,
    );
  }

  // ──────────────────────────────────────────────────────────────
  //  Reassign Shipment (ADMIN)
  // ──────────────────────────────────────────────────────────────

  async reassign(shipmentId: string, dto: AssignShipmentDto) {
    // Validate shipment exists
    const [shipment] = await this.db
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.id, shipmentId))
      .limit(1);

    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    // Can only reassign shipments that are ASSIGNED (not yet in transit/delivered)
    if (shipment.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Can only reassign shipments in ASSIGNED status (current: ${shipment.status})`,
      );
    }

    // Validate new staff user
    const [newStaff] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, dto.staffUserId))
      .limit(1);

    if (!newStaff) {
      throw new NotFoundException('Staff user not found');
    }

    if (newStaff.role !== 'staff') {
      throw new BadRequestException('Assigned user must have the STAFF role');
    }

    const [updated] = await this.db
      .update(schema.shipments)
      .set({
        staffUserId: dto.staffUserId,
        assignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.shipments.id, shipmentId))
      .returning();

    return this.formatShipment(updated);
  }

  // ──────────────────────────────────────────────────────────────
  //  Get Staff Users (helper for admin dropdown)
  // ──────────────────────────────────────────────────────────────

  async getStaffUsers() {
    const rows = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
      })
      .from(schema.users)
      .where(eq(schema.users.role, 'staff'))
      .orderBy(asc(schema.users.name));

    return rows;
  }

  // ──────────────────────────────────────────────────────────────
  //  Get Assignable Orders (PAID/PROCESSING without a shipment)
  // ──────────────────────────────────────────────────────────────

  async getAssignableOrders() {
    const rows = await this.db
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        customerEmail: schema.users.email,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .leftJoin(schema.shipments, eq(schema.orders.id, schema.shipments.orderId))
      .where(
        and(
          sql`${schema.orders.status} IN ('PAID', 'PROCESSING')`,
          sql`${schema.shipments.id} IS NULL`,
        ),
      )
      .orderBy(desc(schema.orders.createdAt));

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      totalAmount: r.totalAmount / 100,
      customerEmail: r.customerEmail,
      createdAt: r.createdAt,
    }));
  }
}
