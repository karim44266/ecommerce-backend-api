import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { ClientPurchasesQueryDto } from './dto/client-purchases-query.dto';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  async createUser(
    email: string,
    passwordHash: string,
    role: string = 'CUSTOMER',
  ): Promise<UserDocument> {
    const existing = await this.userModel.findOne({
      email: email.toLowerCase(),
    });
    if (existing) {
      throw new ConflictException('Email already exists');
    }
    return this.userModel.create({
      email: email.toLowerCase(),
      passwordHash,
      roles: [role.toUpperCase()],
    });
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getPrimaryRole(roles: string[] = []): string {
    return (roles[0] ?? 'CUSTOMER').toLowerCase();
  }

  /** Strip sensitive fields before returning to client. */
  private sanitize(
    user: UserDocument | (Record<string, unknown> & { roles?: string[] }),
  ) {
    const plain =
      typeof (user as UserDocument).toJSON === 'function'
        ? ((user as UserDocument).toJSON() as Record<string, unknown> & {
            roles?: string[];
          })
        : user;

    const {
      passwordHash: _pw,
      mfaOtpHash: _otp,
      mfaOtpExpiresAt: _exp,
      ...safe
    } = plain;

    return {
      ...safe,
      role: this.getPrimaryRole((safe.roles as string[] | undefined) ?? []),
    };
  }

  async findAll(query?: { page?: number; limit?: number; search?: string }) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const offset = (page - 1) * limit;

    const filter = query?.search
      ? {
          $or: [
            {
              email: { $regex: this.escapeRegex(query.search), $options: 'i' },
            },
            { name: { $regex: this.escapeRegex(query.search), $options: 'i' } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      this.userModel.countDocuments(filter),
      this.userModel
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(offset)
        .limit(limit),
    ]);

    return {
      data: rows.map((row) => this.sanitize(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(user);
  }

  async updateRole(id: string, role: string) {
    const normalizedRole = role.toUpperCase();
    const roles = [normalizedRole];
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { roles },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return this.sanitize(updated);
  }

  async updateStatus(id: string, status: string) {
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(updated);
  }

  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    const payload: Partial<User> = {};

    if (dto.name !== undefined) {
      payload.name = dto.name.trim();
    }

    const updated = await this.userModel.findByIdAndUpdate(userId, payload, {
      new: true,
    });
    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return this.sanitize(updated);
  }

  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(userId, { passwordHash });

    return { message: 'Password updated successfully' };
  }

  async getClientPurchases(userId: string, query: ClientPurchasesQueryDto) {
    const clientUser = await this.userModel.findById(userId);
    if (!clientUser) {
      throw new NotFoundException('User not found');
    }
    const client = this.sanitize(clientUser) as {
      id?: string;
      _id?: unknown;
      email: string;
      name?: string;
      status: string;
    };

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) {
        createdAt.$gte = new Date(query.from);
      }
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setHours(23, 59, 59, 999);
        createdAt.$lte = toDate;
      }
      filter.createdAt = createdAt;
    }

    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
      const totalAmount: Record<string, number> = {};
      if (query.minTotal !== undefined) {
        totalAmount.$gte = Math.round(query.minTotal * 100);
      }
      if (query.maxTotal !== undefined) {
        totalAmount.$lte = Math.round(query.maxTotal * 100);
      }
      filter.totalAmount = totalAmount;
    }

    if (query.search?.trim()) {
      const search = query.search.trim();
      if (Types.ObjectId.isValid(search)) {
        filter._id = new Types.ObjectId(search);
      } else {
        filter._id = { $exists: false };
      }
    }

    const [total, rows, summaryRows] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.orderModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalSpentCents: { $sum: '$totalAmount' },
            averageOrderCents: { $avg: '$totalAmount' },
            lastPurchaseDate: { $max: '$createdAt' },
          },
        },
      ]),
    ]);

    const summary = summaryRows[0] ?? {
      totalOrders: 0,
      totalSpentCents: 0,
      averageOrderCents: 0,
      lastPurchaseDate: null,
    };

    const orders = rows.map((order) => ({
      id: order.id,
      createdAt: (order as unknown as { createdAt: Date }).createdAt,
      status: order.status,
      totalAmount: Number(order.totalAmount) / 100,
      itemCount: (order.items ?? []).reduce(
        (acc, item) => acc + (item.quantity ?? 0),
        0,
      ),
    }));

    return {
      client: {
        id: client.id ?? String(client._id),
        email: client.email,
        name: client.name,
        status: client.status,
      },
      summary: {
        totalOrders: summary.totalOrders,
        totalSpent: Number(summary.totalSpentCents || 0) / 100,
        averageOrderValue: Number(summary.averageOrderCents || 0) / 100,
        lastPurchaseDate: summary.lastPurchaseDate,
      },
      orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
