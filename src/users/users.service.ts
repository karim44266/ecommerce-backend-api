import { BadRequestException, Injectable, NotFoundException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async createUser(email: string, passwordHash: string, role: string = 'CUSTOMER'): Promise<UserDocument> {
    const existing = await this.userModel.findOne({ email: email.toLowerCase() });
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
    const updated = await this.userModel.findByIdAndUpdate(id, { status }, { new: true });
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

    const updated = await this.userModel.findByIdAndUpdate(userId, payload, { new: true });
    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return this.sanitize(updated);
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(userId, { passwordHash });

    return { message: 'Password updated successfully' };
  }

  async togglePersonalCatalogItem(userId: string, productId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const personalCatalog = user.personalCatalog || [];
    const index = personalCatalog.findIndex((id) => id.toString() === productId);

    let added = false;
    if (index > -1) {
      personalCatalog.splice(index, 1);
    } else {
      personalCatalog.push(productId as any);
      added = true;
    }

    await this.userModel.findByIdAndUpdate(userId, { personalCatalog });
    return { added };
  }

  async getPersonalCatalog(userId: string): Promise<string[]> {
    const user = await this.userModel.findById(userId).select('personalCatalog');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return (user.personalCatalog || []).map((id) => id.toString());
  }
}
