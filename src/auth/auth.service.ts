import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
import { BlockedAppealDto } from './dto/blocked-appeal.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MfaToggleDto } from './dto/mfa-toggle.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MailerService } from './mailer.service';
import { UsersService } from './users.service';

@Injectable()
export class AuthService {
  private readonly otpTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly refreshTokenExpiryDays: number;
  private readonly inactivityTimeoutMinutes: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {
    this.refreshTokenExpiryDays = parseInt(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRY_DAYS', '7'),
      10,
    );
    this.inactivityTimeoutMinutes = parseInt(
      this.configService.get<string>('INACTIVITY_TIMEOUT_MINUTES', '30'),
      10,
    );
  }

  async login(dto: LoginDto): Promise<{
    accessToken?: string;
    refreshToken?: string;
    mfaRequired?: boolean;
    blocked?: boolean;
    blockedMessage?: string;
  }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Blocked account handling
    if (user.status === 'blocked') {
      throw new ForbiddenException({
        blocked: true,
        message: 'Your account has been temporarily suspended. Please contact the administration.',
      });
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfaEnabled) {
      const otp = this.generateOtp();
      const otpHash = await bcrypt.hash(otp, 10);
      const otpExpiresAt = new Date(Date.now() + this.otpTtlMs);

      await this.usersService.setMfaOtp(user.email, otpHash, otpExpiresAt);
      this.mailerService.sendMfaOtp(user.email, otp);

      return { mfaRequired: true };
    }

    const roles = await this.usersService.getUserRoles(user.id);
    const accessToken = await this.signToken(user.id, user.email, roles);
    const refreshToken = await this.generateAndStoreRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  async register(dto: { email: string; password: string }): Promise<{ accessToken: string; refreshToken: string }> {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.createUser(dto.email, passwordHash);

    await this.usersService.ensureDefaultRole(user.id);
    const roles = await this.usersService.getUserRoles(user.id);
    const accessToken = await this.signToken(user.id, user.email, roles);
    const refreshToken = await this.generateAndStoreRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  async verifyMfa(dto: MfaVerifyDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.mfaEnabled || !user.mfaOtpHash || !user.mfaOtpExpiresAt) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (user.mfaOtpExpiresAt.getTime() < Date.now()) {
      await this.usersService.clearMfaOtp(user.email);
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const otpValid = await bcrypt.compare(dto.otp, user.mfaOtpHash);
    if (!otpValid) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    await this.usersService.clearMfaOtp(user.email);
    const roles = await this.usersService.getUserRoles(user.id);
    const accessToken = await this.signToken(user.id, user.email, roles);
    const refreshToken = await this.generateAndStoreRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async refresh(rawRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Find user by iterating (in production, store a token identifier to look up)
    // For now, we extract userId from the token format: userId:uuid
    const parts = rawRefreshToken.split(':');
    if (parts.length !== 2) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [userId, tokenValue] = parts;
    const user = await this.usersService.findById(userId);
    if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (user.status === 'blocked') {
      throw new ForbiddenException({
        blocked: true,
        message: 'Votre compte a été temporairement suspendu. Veuillez contacter l\'administration.',
      });
    }

    if (user.refreshTokenExpiresAt.getTime() < Date.now()) {
      await this.usersService.clearRefreshToken(userId);
      throw new UnauthorizedException('Refresh token expired');
    }

    const valid = await bcrypt.compare(tokenValue, user.refreshTokenHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const roles = await this.usersService.getUserRoles(user.id);
    const accessToken = await this.signToken(user.id, user.email, roles);
    const refreshToken = await this.generateAndStoreRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  async logout(userId: string): Promise<{ message: string }> {
    await this.usersService.clearRefreshToken(userId);
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.usersService.createPasswordResetRequest(dto.identifier, dto.message);
    return {
      message: 'Your request has been submitted. Our team will contact you as soon as possible.',
    };
  }

  async submitBlockedAppeal(dto: BlockedAppealDto): Promise<{ message: string }> {
    await this.usersService.createAccountAppeal(dto.name, dto.accountNumber, dto.explanation);
    return {
      message: 'Your message has been received. Our team will contact you as soon as possible.',
    };
  }

  getInactivityConfig(): { timeoutMinutes: number } {
    return { timeoutMinutes: this.inactivityTimeoutMinutes };
  }

  private async signToken(userId: string, email: string, roles: string[]): Promise<string> {
    return this.jwtService.signAsync({ sub: userId, email, roles });
  }

  async toggleMfa(userId: string, dto: MfaToggleDto): Promise<{ mfaEnabled: boolean }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.usersService.toggleMfa(userId, dto.enabled);
    return { mfaEnabled: dto.enabled };
  }

  private generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async generateAndStoreRefreshToken(userId: string): Promise<string> {
    const tokenValue = randomUUID();
    const hash = await bcrypt.hash(tokenValue, 10);
    const expiresAt = new Date(Date.now() + this.refreshTokenExpiryDays * 24 * 60 * 60 * 1000);

    await this.usersService.setRefreshToken(userId, hash, expiresAt);

    // Return compound token: userId:uuid (userId needed for lookup)
    return `${userId}:${tokenValue}`;
  }
}
