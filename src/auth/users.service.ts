import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  async createUser(
    email: string,
    passwordHash: string,
    name: string,
  ): Promise<UserDocument> {
    return this.userModel.create({
      email: email.toLowerCase(),
      name: name.trim(),
      passwordHash,
      roles: ['CUSTOMER'],
    });
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const user = await this.userModel.findById(userId).select('roles');
    return user?.roles ?? [];
  }

  async assignRoleToUser(userId: string, roleName: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { roles: roleName.toUpperCase() },
    });
  }

  async ensureDefaultRole(userId: string): Promise<void> {
    await this.assignRoleToUser(userId, 'CUSTOMER');
  }

  async setMfaOtp(
    email: string,
    otpHash: string,
    otpExpiresAt: Date,
  ): Promise<void> {
    await this.userModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      { mfaOtpHash: otpHash, mfaOtpExpiresAt: otpExpiresAt },
    );
  }

  async clearMfaOtp(email: string): Promise<void> {
    await this.userModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      { mfaOtpHash: null, mfaOtpExpiresAt: null },
    );
  }

  async findById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId);
  }

  async toggleMfa(userId: string, enabled: boolean): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      mfaEnabled: enabled,
      mfaOtpHash: null,
      mfaOtpExpiresAt: null,
    });
  }
}
