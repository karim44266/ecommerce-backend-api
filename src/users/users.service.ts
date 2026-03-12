import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getPrimaryRole(roles: string[] = []): string {
    return (roles.find((role) => role !== 'CUSTOMER') ?? roles[0] ?? 'CUSTOMER').toLowerCase();
  }

  /** Strip sensitive fields before returning to client. */
  private sanitize(user: UserDocument | (Record<string, unknown> & { roles?: string[] })) {
    const plain = typeof (user as UserDocument).toJSON === 'function'
      ? ((user as UserDocument).toJSON() as Record<string, unknown> & { roles?: string[] })
      : user;

    const { passwordHash: _pw, mfaOtpHash: _otp, mfaOtpExpiresAt: _exp, ...safe } = plain;

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
            { email: { $regex: this.escapeRegex(query.search), $options: 'i' } },
            { name: { $regex: this.escapeRegex(query.search), $options: 'i' } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      this.userModel.countDocuments(filter),
      this.userModel.find(filter).sort({ createdAt: 1 }).skip(offset).limit(limit),
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
    const roles = Array.from(new Set([normalizedRole, 'CUSTOMER']));
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
    const updated = await this.userModel.findByIdAndUpdate(id, { status }, { new: true });
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(updated);
  }
}
