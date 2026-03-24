import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PasswordResetRequest, PasswordResetRequestDocument } from './schemas/password-reset-request.schema';
import { AccountAppeal, AccountAppealDocument } from './schemas/account-appeal.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(PasswordResetRequest.name)
    private readonly passwordResetRequestModel: Model<PasswordResetRequestDocument>,
    @InjectModel(AccountAppeal.name)
    private readonly accountAppealModel: Model<AccountAppealDocument>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  async createUser(email: string, passwordHash: string): Promise<UserDocument> {
    return this.userModel.create({
      email: email.toLowerCase(),
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

  async setMfaOtp(email: string, otpHash: string, otpExpiresAt: Date): Promise<void> {
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

  // --- Refresh Token ---

  async setRefreshToken(userId: string, hash: string, expiresAt: Date): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      refreshTokenHash: hash,
      refreshTokenExpiresAt: expiresAt,
    });
  }

  async clearRefreshToken(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    });
  }

  // --- Password Reset Requests ---

  async createPasswordResetRequest(identifier: string, message?: string): Promise<PasswordResetRequestDocument> {
    return this.passwordResetRequestModel.create({
      identifier: identifier.toLowerCase(),
      message: message ?? '',
    });
  }

  async getPasswordResetRequests(status?: string) {
    const filter = status ? { status } : {};
    return this.passwordResetRequestModel.find(filter).sort({ createdAt: -1 });
  }

  // --- Account Appeals ---

  async createAccountAppeal(name: string, accountNumber: string, explanation: string): Promise<AccountAppealDocument> {
    return this.accountAppealModel.create({ name, accountNumber, explanation });
  }
}
