import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { LoginDto } from './dto/login.dto';
import { MfaToggleDto } from './dto/mfa-toggle.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RegisterDto } from './dto/register.dto';
import { MailerService } from './mailer.service';
import { UsersService } from './users.service';

@Injectable()
export class AuthService {
  private readonly otpTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken?: string; mfaRequired?: boolean }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
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
      await this.mailerService.sendMfaOtp(user.email, otp);

      return { mfaRequired: true };
    }

    const roles = await this.usersService.getUserRoles(user.id);
    const accessToken = await this.signToken(user.id, user.email, roles);
    return { accessToken };
  }

  async register(dto: RegisterDto): Promise<{ accessToken: string }> {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.createUser(dto.email, passwordHash);

    await this.usersService.ensureDefaultRole(user.id);
    const roles = await this.usersService.getUserRoles(user.id);
    const accessToken = await this.signToken(user.id, user.email, roles);
    return { accessToken };
  }

  async verifyMfa(dto: MfaVerifyDto): Promise<{ accessToken: string }> {
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

    return { accessToken };
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
}
