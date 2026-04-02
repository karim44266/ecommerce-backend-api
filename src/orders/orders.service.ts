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
import { UpdateOrderDto } from './dto/update-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import {
  UpdateOrderStatusDto,
  STATUS_TRANSITIONS,
} from './dto/update-order-status.dto';
import { ErpSyncService } from './erp-sync.service';
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
    private readonly erpSyncService: ErpSyncService,
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
    const orderingUser = await this.userModel.findById(userId).select('roles');

    if (!orderingUser) {
      throw new NotFoundException('User not found');
    }

    const productIds = dto.items.map((i) => i.productId);

    const dbProducts = await this.productModel.find({
      _id: { $in: productIds },
    });

    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
      if (product.status !== 'active') {
        throw new BadRequestException(
          `Product "${product.name}" is not available`,
        );
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
      const effectiveUnitPrice = product.price;
      const unitPriceCents = Math.round(effectiveUnitPrice * 100);
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

        const deliveryCode = Math.floor(1000 + Math.random() * 9000).toString();

        const [order] = await this.orderModel.create(
          [
            {
              userId,
              status: 'DRAFT',
              deliveryCode,
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
                  status: 'DRAFT',
                  note: 'Order created in draft state',
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
      conditions.push({
        createdAt: {
          ...(conditions.find((condition) => 'createdAt' in condition)
            ?.createdAt as object),
          $lte: toDate,
        },
      });
    }

    const totalAmountRange: Record<string, number> = {};
    if (query.minTotal !== undefined) {
      totalAmountRange.$gte = Math.round(query.minTotal * 100);
    }
    if (query.maxTotal !== undefined) {
      totalAmountRange.$lte = Math.round(query.maxTotal * 100);
    }
    if (Object.keys(totalAmountRange).length > 0) {
      conditions.push({ totalAmount: totalAmountRange });
    }

    const filter: FilterQuery<OrderDocument> =
      conditions.length === 0
        ? {}
        : conditions.length === 1
          ? conditions[0]
          : { $and: conditions };

    if (query.search) {
      const escaped = this.escapeRegex(query.search);
      const orConditions: FilterQuery<OrderDocument>[] = [];

      if (Types.ObjectId.isValid(query.search)) {
        orConditions.push({ _id: new Types.ObjectId(query.search) });
      }

      orConditions.push(
        { 'shippingAddress.fullName': { $regex: escaped, $options: 'i' } },
        { 'shippingAddress.clientEmail': { $regex: escaped, $options: 'i' } },
        { 'shippingAddress.clientPhone': { $regex: escaped, $options: 'i' } },
      );

      const matchingUsers = await this.userModel
        .find({ email: { $regex: escaped, $options: 'i' } })
        .select('_id');

      if (matchingUsers.length > 0) {
        orConditions.push({
          userId: { $in: matchingUsers.map((user) => user._id) },
        });
      }

      if (orConditions.length > 0) {
        if ('$and' in filter) {
          (filter.$and as FilterQuery<OrderDocument>[]).push({
            $or: orConditions,
          });
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
      order.userId &&
      typeof order.userId === 'object' &&
      '_id' in (order.userId as object)
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

    if (
      dto.status === 'CANCELLED' &&
      (!dto.note || dto.note.trim().length === 0)
    ) {
      throw new BadRequestException(
        'Cancellation reason is required before shipment',
      );
    }

    if (dto.status === 'DELIVERED') {
      if (!dto.deliveryCode) {
        throw new BadRequestException(
          'A 4-digit delivery code is required to mark an order as delivered.',
        );
      }
      if (order.deliveryCode && order.deliveryCode !== dto.deliveryCode) {
        throw new ForbiddenException(
          'Invalid delivery code. Ask the customer for the correct 4-digit code.',
        );
      }
    }

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        $set: { status: dto.status },
        $push: {
          statusHistory: {
            status: dto.status,
            note:
              dto.note ??
              `Status changed from ${currentStatus} to ${dto.status}`,
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

    if (dto.status === 'CONFIRMED') {
      void this.erpSyncService.pushOrderToErp(updated.id);
    }

    return this.formatOrder(updated);
  }

  async updateOrder(
    orderId: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateOrderDto,
  ) {
    const order = await this.orderModel.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!isAdmin && String(order.userId) !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    if (!['DRAFT', 'CONFIRMED'].includes(order.status)) {
      throw new BadRequestException(
        'Only DRAFT or CONFIRMED orders can be edited',
      );
    }

    const hasItems = Array.isArray(dto.items) && dto.items.length > 0;
    const hasAddress = !!dto.shippingAddress;

    if (!hasItems && !hasAddress) {
      throw new BadRequestException(
        'Provide at least items or shippingAddress to update',
      );
    }

    const orderingUser = await this.userModel
      .findById(String(order.userId))
      .select('roles');
    if (!orderingUser) {
      throw new NotFoundException('User not found');
    }

    const currentItems = order.items ?? [];
    const currentQtyByProduct = new Map<string, number>();
    for (const item of currentItems) {
      const productId = String(item.productId);
      currentQtyByProduct.set(
        productId,
        (currentQtyByProduct.get(productId) ?? 0) + item.quantity,
      );
    }

    const targetItems = hasItems
      ? dto.items!.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }))
      : currentItems.map((item) => ({
          productId: String(item.productId),
          quantity: item.quantity,
        }));

    const productIds = Array.from(
      new Set(targetItems.map((item) => item.productId)),
    );
    const dbProducts = await this.productModel.find({
      _id: { $in: productIds },
    });
    const productMap = new Map(
      dbProducts.map((product) => [product.id, product]),
    );

    for (const item of targetItems) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
      if (product.status !== 'active') {
        throw new BadRequestException(
          `Product "${product.name}" is not available`,
        );
      }
    }

    const targetQtyByProduct = new Map<string, number>();
    for (const item of targetItems) {
      targetQtyByProduct.set(
        item.productId,
        (targetQtyByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    const allProductIds = new Set<string>([
      ...Array.from(currentQtyByProduct.keys()),
      ...Array.from(targetQtyByProduct.keys()),
    ]);

    let totalCents = 0;
    const itemsWithPrice = targetItems.map((item) => {
      const product = productMap.get(item.productId)!;
      const effectiveUnitPrice = product.price;
      const unitPriceCents = Math.round(effectiveUnitPrice * 100);
      totalCents += unitPriceCents * item.quantity;
      return {
        productId: item.productId,
        name: product.name,
        quantity: item.quantity,
        unitPrice: unitPriceCents,
      };
    });

    const session = await this.connection.startSession();

    try {
      let updatedOrder: OrderDocument | null = null;

      await session.withTransaction(async () => {
        for (const productId of allProductIds) {
          const currentQty = currentQtyByProduct.get(productId) ?? 0;
          const targetQty = targetQtyByProduct.get(productId) ?? 0;
          const delta = targetQty - currentQty;

          if (delta > 0) {
            const inventoryUpdated = await this.productModel.findOneAndUpdate(
              { _id: productId, inventory: { $gte: delta } },
              {
                $inc: {
                  inventory: -delta,
                  'inventoryInfo.quantity': -delta,
                },
              },
              { new: true, session },
            );

            if (!inventoryUpdated) {
              const product = productMap.get(productId);
              throw new BadRequestException(
                `Insufficient stock for "${product?.name ?? productId}" while updating order`,
              );
            }
          }

          if (delta < 0) {
            await this.productModel.findByIdAndUpdate(
              productId,
              {
                $inc: {
                  inventory: -delta,
                  'inventoryInfo.quantity': -delta,
                },
              },
              { session },
            );
          }
        }

        updatedOrder = await this.orderModel.findByIdAndUpdate(
          orderId,
          {
            $set: {
              items: itemsWithPrice,
              totalAmount: totalCents,
              ...(hasAddress ? { shippingAddress: dto.shippingAddress } : {}),
            },
            $push: {
              statusHistory: {
                status: order.status,
                note: 'Order edited',
                changedBy: userId,
                createdAt: new Date(),
              },
            },
          },
          { new: true, session },
        );
      });

      if (!updatedOrder) {
        throw new NotFoundException('Order not found');
      }

      return this.formatOrder(updatedOrder);
    } finally {
      await session.endSession();
    }
  }

  async cancelOrder(
    orderId: string,
    userId: string,
    isAdmin: boolean,
    reason: string,
  ) {
    const order = await this.orderModel.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!isAdmin && String(order.userId) !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        'Cancellation reason is required before shipment',
      );
    }

    if (!['DRAFT', 'CONFIRMED', 'IN_PREPARATION'].includes(order.status)) {
      throw new BadRequestException(
        'Only orders before delivery can be cancelled',
      );
    }

    const session = await this.connection.startSession();

    try {
      let cancelledOrder: OrderDocument | null = null;

      await session.withTransaction(async () => {
        for (const item of order.items ?? []) {
          await this.productModel.findByIdAndUpdate(
            item.productId,
            {
              $inc: {
                inventory: item.quantity,
                'inventoryInfo.quantity': item.quantity,
              },
            },
            { session },
          );
        }

        cancelledOrder = await this.orderModel.findByIdAndUpdate(
          orderId,
          {
            $set: { status: 'CANCELLED' },
            $push: {
              statusHistory: {
                status: 'CANCELLED',
                note: reason.trim(),
                changedBy: userId,
                createdAt: new Date(),
              },
            },
          },
          { new: true, session },
        );
      });

      if (!cancelledOrder) {
        throw new NotFoundException('Order not found');
      }

      return this.formatOrder(cancelledOrder);
    } finally {
      await session.endSession();
    }
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
            note:
              dto.note ??
              `Tracking updated: ${dto.carrier} ${dto.trackingNumber}`,
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
      order.userId &&
      typeof order.userId === 'object' &&
      '_id' in (order.userId as object)
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
    const plain =
      typeof (order as OrderDocument).toJSON === 'function'
        ? ((order as OrderDocument).toJSON() as Record<string, any>)
        : (order as Record<string, any>);
    const customer =
      plain.userId && typeof plain.userId === 'object' ? plain.userId : null;

    return {
      id: plain.id,
      userId: customer?.id ?? String(plain.userId),
      status: plain.status,
      totalAmount: Number(plain.totalAmount) / 100,
      shippingAddress: plain.shippingAddress,
      trackingNumber: plain.trackingNumber,
      carrier: plain.carrier,
      deliveryCode: plain.deliveryCode ?? null,
      erpReference: plain.erpReference ?? null,
      erpSyncStatus: plain.erpSyncStatus ?? 'NOT_SYNCED',
      erpSyncAttempts: plain.erpSyncAttempts ?? 0,
      erpLastSyncError: plain.erpLastSyncError ?? null,
      erpLastSyncedAt: plain.erpLastSyncedAt ?? null,
      customerEmail: customer?.email,
      items: (plain.items ?? []).map((item: Record<string, any>) => ({
        id: item.id ?? String(item._id),
        productId:
          typeof item.productId === 'object' && item.productId !== null
            ? (item.productId.id ?? String(item.productId._id))
            : String(item.productId),
        name: item.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice) / 100,
      })),
      statusHistory: (plain.statusHistory ?? []).map(
        (entry: Record<string, any>) => ({
          id: entry.id ?? String(entry._id),
          status: entry.status,
          note: entry.note,
          changedBy:
            entry.changedBy && typeof entry.changedBy === 'object'
              ? (entry.changedBy.id ?? String(entry.changedBy._id))
              : (entry.changedBy ?? null),
          changedByEmail:
            entry.changedBy && typeof entry.changedBy === 'object'
              ? (entry.changedBy.email ?? null)
              : null,
          createdAt: entry.createdAt,
        }),
      ),
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }
}
