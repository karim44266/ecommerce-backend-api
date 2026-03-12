import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderStatusDto, STATUS_TRANSITIONS } from './dto/update-order-status.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { Order, OrderDocument } from './schemas/order.schema';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ────────────────────────────────────────────────────────────────
  //  Create Order
  // ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateOrderDto) {
    const productIds = dto.items.map((i) => i.productId);

    const dbProducts = await this.productModel.find({ _id: { $in: productIds } });

    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
      if (product.status !== 'active') {
        throw new BadRequestException(`Product "${product.name}" is not available`);
      }
      if (product.inventory < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}" (available: ${product.inventory})`,
        );
      }
    }

    let totalCents = 0;
    const itemsWithPrice = dto.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPriceCents = Math.round(product.price * 100);
      totalCents += unitPriceCents * item.quantity;
      return {
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPriceCents,
      };
    });

    const session = await this.connection.startSession();

    try {
      let createdOrder: OrderDocument | null = null;

      await session.withTransaction(async () => {
        for (const item of dto.items) {
          const updated = await this.productModel.findOneAndUpdate(
            { _id: item.productId, inventory: { $gte: item.quantity } },
            {
              $inc: {
                inventory: -item.quantity,
                'inventoryInfo.quantity': -item.quantity,
              },
            },
            { new: true, session },
          );

          if (!updated) {
            throw new BadRequestException(
              `Stock changed for product "${productMap.get(item.productId)?.name}". Please refresh and try again.`,
            );
          }
        }

        const [order] = await this.orderModel.create(
          [
            {
              userId,
              status: 'PENDING',
              totalAmount: totalCents,
              shippingAddress: dto.shippingAddress,
              items: itemsWithPrice.map((item) => ({
                productId: item.productId,
                name: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPriceCents,
              })),
              statusHistory: [
                {
                  status: 'PENDING',
                  note: 'Order placed – awaiting admin confirmation',
                  changedBy: userId,
                  createdAt: new Date(),
                },
              ],
            },
          ],
          { session },
        );

        createdOrder = order;
      });

      if (!createdOrder) {
        throw new BadRequestException('Unable to create order');
      }

      return this.formatOrder(createdOrder);
    } finally {
      await session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  List Orders (admin or customer)
  // ────────────────────────────────────────────────────────────────

  async findAll(query: OrderQueryDto, userId: string, isAdmin: boolean) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: FilterQuery<OrderDocument>[] = [];
    if (!isAdmin) {
      conditions.push({ userId });
    }
    if (query.status) {
      conditions.push({ status: query.status });
    }
    if (query.from) {
      conditions.push({ createdAt: { $gte: new Date(query.from) } });
    }
    if (query.to) {
      const toDate = new Date(query.to);
      toDate.setHours(23, 59, 59, 999);
      conditions.push({ createdAt: { ...(conditions.find((condition) => 'createdAt' in condition)?.createdAt as object), $lte: toDate } });
    }

    const filter: FilterQuery<OrderDocument> =
      conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { $and: conditions };

    if (query.search) {
      const escaped = this.escapeRegex(query.search);
      const orConditions: FilterQuery<OrderDocument>[] = [];

      if (Types.ObjectId.isValid(query.search)) {
        orConditions.push({ _id: new Types.ObjectId(query.search) });
      }

      const matchingUsers = await this.userModel
        .find({ email: { $regex: escaped, $options: 'i' } })
        .select('_id');

      if (matchingUsers.length > 0) {
        orConditions.push({ userId: { $in: matchingUsers.map((user) => user._id) } });
      }

      if (orConditions.length > 0) {
        if ('$and' in filter) {
          (filter.$and as FilterQuery<OrderDocument>[]).push({ $or: orConditions });
        } else if (Object.keys(filter).length > 0) {
          Object.assign(filter, { $and: [filter, { $or: orConditions }] });
        } else {
          Object.assign(filter, { $or: orConditions });
        }
      } else {
        Object.assign(filter, { _id: { $exists: false } });
      }
    }

    const sortColumnMap: Record<string, string> = {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      totalAmount: 'totalAmount',
      status: 'status',
    };
    const sortField = sortColumnMap[query.sortBy ?? 'createdAt'] ?? 'createdAt';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;

    const [total, rows] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .populate('userId', 'email')
        .sort({ [sortField]: sortDir })
        .skip(offset)
        .limit(limit),
    ]);

    const data = rows.map((order) => this.formatOrder(order));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  Get Order Detail (owner or ADMIN)
  // ────────────────────────────────────────────────────────────────

  async findById(orderId: string, userId: string, isAdmin: boolean) {
    const order = await this.orderModel
      .findById(orderId)
      .populate('userId', 'email')
      .populate('statusHistory.changedBy', 'email');

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const ownerId =
      order.userId && typeof order.userId === 'object' && '_id' in (order.userId as object)
        ? String((order.userId as { _id: Types.ObjectId })._id)
        : String(order.userId);

    if (!isAdmin && ownerId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return this.formatOrder(order);
  }

  // ────────────────────────────────────────────────────────────────
  //  Update Order Status (ADMIN only, with transition validation)
  // ────────────────────────────────────────────────────────────────

  async updateStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    adminUserId: string,
  ) {
    const order = await this.orderModel.findById(orderId);

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

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        $set: { status: dto.status },
        $push: {
          statusHistory: {
            status: dto.status,
            note: dto.note ?? `Status changed from ${currentStatus} to ${dto.status}`,
            changedBy: adminUserId,
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Order not found');
    }

    return this.formatOrder(updated);
  }

  // ────────────────────────────────────────────────────────────────
  //  Update Tracking Info (ADMIN only)
  // ────────────────────────────────────────────────────────────────

  async updateTracking(
    orderId: string,
    dto: UpdateTrackingDto,
    adminUserId: string,
  ) {
    const order = await this.orderModel.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        $set: {
          trackingNumber: dto.trackingNumber,
          carrier: dto.carrier,
        },
        $push: {
          statusHistory: {
            status: order.status,
            note: dto.note ?? `Tracking updated: ${dto.carrier} ${dto.trackingNumber}`,
            changedBy: adminUserId,
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Order not found');
    }

    return this.formatOrder(updated);
  }

  // ────────────────────────────────────────────────────────────────
  //  Get Status History (audit trail)
  // ────────────────────────────────────────────────────────────────

  async getStatusHistory(orderId: string, userId: string, roles: string[]) {
    const order = await this.orderModel
      .findById(orderId)
      .populate('statusHistory.changedBy', 'email')
      .populate('userId', 'email');

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isAdmin = roles.includes('ADMIN');
    const ownerId =
      order.userId && typeof order.userId === 'object' && '_id' in (order.userId as object)
        ? String((order.userId as { _id: Types.ObjectId })._id)
        : String(order.userId);

    if (!isAdmin && ownerId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const formatted = this.formatOrder(order);
    return formatted.statusHistory;
  }

  // ────────────────────────────────────────────────────────────────
  //  Format helper
  // ────────────────────────────────────────────────────────────────

  private formatOrder(order: OrderDocument | Record<string, unknown>) {
    const plain = typeof (order as OrderDocument).toJSON === 'function'
      ? ((order as OrderDocument).toJSON() as Record<string, any>)
      : (order as Record<string, any>);
    const customer = plain.userId && typeof plain.userId === 'object' ? plain.userId : null;

    return {
      id: plain.id,
      userId: customer?.id ?? String(plain.userId),
      status: plain.status,
      totalAmount: Number(plain.totalAmount) / 100,
      shippingAddress: plain.shippingAddress,
      trackingNumber: plain.trackingNumber,
      carrier: plain.carrier,
      customerEmail: customer?.email,
      items: (plain.items ?? []).map((item: Record<string, any>) => ({
        id: item.id ?? String(item._id),
        productId: typeof item.productId === 'object' && item.productId !== null ? item.productId.id ?? String(item.productId._id) : String(item.productId),
        name: item.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice) / 100,
      })),
      statusHistory: (plain.statusHistory ?? []).map((entry: Record<string, any>) => ({
        id: entry.id ?? String(entry._id),
        status: entry.status,
        note: entry.note,
        changedBy:
          entry.changedBy && typeof entry.changedBy === 'object'
            ? entry.changedBy.id ?? String(entry.changedBy._id)
            : entry.changedBy ?? null,
        changedByEmail:
          entry.changedBy && typeof entry.changedBy === 'object'
            ? entry.changedBy.email ?? null
            : null,
        createdAt: entry.createdAt,
      })),
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }
}
