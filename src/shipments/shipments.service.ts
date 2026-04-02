import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { AssignShipmentDto } from './dto/assign-shipment.dto';
import {
  UpdateShipmentStatusDto,
  SHIPMENT_STATUS_TRANSITIONS,
} from './dto/update-shipment-status.dto';
import { Shipment, ShipmentDocument } from './schemas/shipment.schema';

@Injectable()
export class ShipmentsService {
  constructor(
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────

  private formatShipment(shipment: ShipmentDocument | Record<string, unknown>) {
    const plain =
      typeof (shipment as ShipmentDocument).toJSON === 'function'
        ? ((shipment as ShipmentDocument).toJSON() as Record<string, any>)
        : (shipment as Record<string, any>);
    const staff =
      plain.staffUserId && typeof plain.staffUserId === 'object'
        ? plain.staffUserId
        : null;
    const order =
      plain.orderId && typeof plain.orderId === 'object' ? plain.orderId : null;
    const customer =
      order?.userId && typeof order.userId === 'object' ? order.userId : null;

    return {
      id: plain.id,
      orderId: order?.id ?? String(plain.orderId),
      staffUserId: staff?.id ?? String(plain.staffUserId),
      staffEmail: staff?.email ?? undefined,
      staffName: staff?.name ?? undefined,
      orderStatus: order?.status ?? undefined,
      customerEmail: customer?.email ?? undefined,
      shippingAddress: order?.shippingAddress ?? undefined,
      status: plain.status,
      trackingNumber: plain.trackingNumber,
      assignedAt: plain.assignedAt,
      deliveredAt: plain.deliveredAt,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  Create Shipment (ADMIN)
  // ──────────────────────────────────────────────────────────────

  async create(dto: CreateShipmentDto) {
    const order = await this.orderModel.findById(dto.orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!['CONFIRMED', 'IN_PREPARATION'].includes(order.status)) {
      throw new BadRequestException(
        `Order must be in CONFIRMED or IN_PREPARATION status to create a shipment (current: ${order.status})`,
      );
    }

    const existing = await this.shipmentModel
      .findOne({ orderId: dto.orderId })
      .select('_id');

    if (existing) {
      throw new BadRequestException('A shipment already exists for this order');
    }

    const staffUser = await this.userModel
      .findById(dto.staffUserId)
      .select('roles status availabilityStatus');

    if (!staffUser) {
      throw new NotFoundException('Staff user not found');
    }

    if (!(staffUser.roles ?? []).includes('STAFF')) {
      throw new BadRequestException('Assigned user must have the STAFF role');
    }

    if (staffUser.status !== 'active') {
      throw new BadRequestException('Assigned staff user is not active');
    }

    if (staffUser.availabilityStatus !== 'AVAILABLE') {
      throw new BadRequestException('Assigned staff user is not available');
    }

    const session = await this.connection.startSession();

    try {
      let createdShipmentId: string | null = null;

      await session.withTransaction(async () => {
        const [shipment] = await this.shipmentModel.create(
          [
            {
              orderId: dto.orderId,
              staffUserId: dto.staffUserId,
              status: 'ASSIGNED',
              trackingNumber: dto.trackingNumber ?? null,
            },
          ],
          { session },
        );
        createdShipmentId = shipment.id;

        if (order.status === 'CONFIRMED') {
          await this.orderModel.findByIdAndUpdate(
            dto.orderId,
            {
              $set: { status: 'IN_PREPARATION' },
              $push: {
                statusHistory: {
                  status: 'IN_PREPARATION',
                  note: 'Shipment created – order moved to IN_PREPARATION',
                  changedBy: null,
                  createdAt: new Date(),
                },
              },
            },
            { session },
          );
        }
      });

      if (!createdShipmentId) {
        throw new BadRequestException('Unable to create shipment');
      }

      const populated = await this.shipmentModel
        .findById(createdShipmentId)
        .populate('staffUserId', 'email name')
        .populate({
          path: 'orderId',
          select: 'status shippingAddress userId',
          populate: { path: 'userId', select: 'email' },
        });

      if (!populated) {
        throw new NotFoundException('Shipment not found after creation');
      }

      return this.formatShipment(populated);
    } finally {
      await session.endSession();
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  List Shipments (ADMIN sees all, STAFF sees own)
  // ──────────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    isAdmin: boolean,
    query?: {
      status?: string;
      staffId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (!isAdmin) {
      filter.staffUserId = userId;
    }

    if (query?.status) {
      filter.status = query.status;
    }

    if (query?.staffId) {
      filter.staffUserId = query.staffId;
    }

    const [total, rows] = await Promise.all([
      this.shipmentModel.countDocuments(filter),
      this.shipmentModel
        .find(filter)
        .populate('staffUserId', 'email name')
        .populate({
          path: 'orderId',
          select: 'status shippingAddress userId',
          populate: { path: 'userId', select: 'email' },
        })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
    ]);

    return {
      data: rows.map((row) => this.formatShipment(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  Get Single Shipment (ADMIN or own STAFF)
  // ──────────────────────────────────────────────────────────────

  async findById(id: string, userId: string, isAdmin: boolean) {
    const shipment = await this.shipmentModel
      .findById(id)
      .populate('staffUserId', 'email name')
      .populate({
        path: 'orderId',
        select: 'status shippingAddress userId',
        populate: { path: 'userId', select: 'email' },
      });

    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    const shipmentStaffId =
      shipment.staffUserId &&
      typeof shipment.staffUserId === 'object' &&
      '_id' in (shipment.staffUserId as object)
        ? String((shipment.staffUserId as { _id: Types.ObjectId })._id)
        : String(shipment.staffUserId);

    if (!isAdmin && shipmentStaffId !== userId) {
      throw new ForbiddenException('You do not have access to this shipment');
    }

    return this.formatShipment(shipment);
  }

  // ──────────────────────────────────────────────────────────────
  //  Reassign Shipment (ADMIN)
  // ──────────────────────────────────────────────────────────────

  async reassign(shipmentId: string, dto: AssignShipmentDto) {
    const shipment = await this.shipmentModel.findById(shipmentId);

    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    if (!['ASSIGNED', 'PENDING'].includes(shipment.status)) {
      throw new BadRequestException(
        `Can only reassign shipments in ASSIGNED or PENDING status (current: ${shipment.status})`,
      );
    }

    const newStaff = await this.userModel
      .findById(dto.staffUserId)
      .select('roles status availabilityStatus');

    if (!newStaff) {
      throw new NotFoundException('Staff user not found');
    }

    if (!(newStaff.roles ?? []).includes('STAFF')) {
      throw new BadRequestException('Assigned user must have the STAFF role');
    }

    if (newStaff.status !== 'active') {
      throw new BadRequestException('Assigned staff user is not active');
    }

    if (newStaff.availabilityStatus !== 'AVAILABLE') {
      throw new BadRequestException('Assigned staff user is not available');
    }

    const updated = await this.shipmentModel.findByIdAndUpdate(
      shipmentId,
      {
        staffUserId: dto.staffUserId,
        status: 'ASSIGNED',
        assignedAt: new Date(),
      },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Shipment not found');
    }

    return this.formatShipment(updated);
  }

  // ──────────────────────────────────────────────────────────────
  //  Update Shipment Status (ADMIN or owning STAFF)
  // ──────────────────────────────────────────────────────────────

  async updateStatus(
    shipmentId: string,
    dto: UpdateShipmentStatusDto,
    userId: string,
    isAdmin: boolean,
  ) {
    const shipment = await this.shipmentModel.findById(shipmentId);

    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    if (!isAdmin && String(shipment.staffUserId) !== userId) {
      throw new ForbiddenException('You can only update your own shipments');
    }

    const currentStatus = shipment.status;
    const allowed = SHIPMENT_STATUS_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition shipment from ${currentStatus} to ${dto.status}. ` +
          `Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }

    const order = await this.orderModel.findById(shipment.orderId);
    if (!order) {
      throw new NotFoundException('Corresponding order not found');
    }

    if (dto.status === 'DELIVERED') {
      if (!dto.deliveryCode) {
        throw new BadRequestException(
          'A 4-digit delivery code from the customer is required to mark the shipment as delivered.',
        );
      }
      if (order.deliveryCode && order.deliveryCode !== dto.deliveryCode) {
        throw new ForbiddenException(
          'Invalid delivery code. Please ask the customer for the correct 4-digit code.',
        );
      }
    }

    const orderStatusMap: Record<string, string> = {
      DELIVERED: 'DELIVERED',
      FAILED: 'IN_PREPARATION',
    };
    const newOrderStatus = orderStatusMap[dto.status];

    const session = await this.connection.startSession();

    try {
      let updatedShipment: ShipmentDocument | null = null;

      await session.withTransaction(async () => {
        const setFields: Record<string, unknown> = {
          status: dto.status,
        };

        if (dto.status === 'DELIVERED') {
          setFields.deliveredAt = new Date();
        }

        updatedShipment = await this.shipmentModel.findByIdAndUpdate(
          shipmentId,
          { $set: setFields },
          { new: true, session },
        );

        if (newOrderStatus) {
          await this.orderModel.findByIdAndUpdate(
            shipment.orderId,
            {
              $set: { status: newOrderStatus },
              $push: {
                statusHistory: {
                  status: newOrderStatus,
                  note:
                    dto.note ??
                    `Shipment ${dto.status.replace(/_/g, ' ').toLowerCase()} – order moved to ${newOrderStatus}`,
                  changedBy: userId,
                  createdAt: new Date(),
                },
              },
            },
            { session },
          );
        }
      });

      if (!updatedShipment) {
        throw new NotFoundException('Shipment not found');
      }

      return this.formatShipment(updatedShipment);
    } finally {
      await session.endSession();
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Get Staff Users (helper for admin dropdown)
  // ──────────────────────────────────────────────────────────────

  async getStaffUsers(includeUnavailable = false) {
    const filter: Record<string, unknown> = {
      roles: 'STAFF',
      status: 'active',
    };

    if (!includeUnavailable) {
      filter.availabilityStatus = 'AVAILABLE';
    }

    const rows = await this.userModel
      .find(filter)
      .select('email name availabilityStatus')
      .sort({ name: 1 });

    return rows.map((row) => row.toJSON());
  }

  // ──────────────────────────────────────────────────────────────
  //  Get Assignable Orders (CONFIRMED/IN_PREPARATION without a shipment)
  // ──────────────────────────────────────────────────────────────

  async getAssignableOrders() {
    const [orders, shipments] = await Promise.all([
      this.orderModel
        .find({ status: { $in: ['CONFIRMED', 'IN_PREPARATION'] } })
        .populate('userId', 'email')
        .sort({ createdAt: -1 }),
      this.shipmentModel.find().select('orderId'),
    ]);

    const assignedOrderIds = new Set(
      shipments.map((shipment) => String(shipment.orderId)),
    );

    return orders
      .filter((order) => !assignedOrderIds.has(order.id))
      .map((order) => {
        const plain = order.toJSON() as Record<string, any>;
        return {
          id: plain.id,
          status: plain.status,
          totalAmount: Number(plain.totalAmount) / 100,
          customerEmail:
            plain.userId && typeof plain.userId === 'object'
              ? (plain.userId.email ?? null)
              : null,
          shippingAddress: plain.shippingAddress,
          createdAt: plain.createdAt,
        };
      });
  }
}
