import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { MailerService } from './mailer.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const createUser = (overrides: Partial<{ id: string; email: string; passwordHash: string; mfaEnabled: boolean; mfaOtpHash: string | null; mfaOtpExpiresAt: Date | null }> = {}) => ({
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'hashed-password',
  mfaEnabled: false,
  mfaOtpHash: null,
  mfaOtpExpiresAt: null,
  ...overrides,
});

describe('AuthService', () => {
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    setMfaOtp: jest.Mock;
    clearMfaOtp: jest.Mock;
    createUser: jest.Mock;
    getUserRoles: jest.Mock;
    ensureDefaultRole: jest.Mock;
    toggleMfa: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let mailerService: { sendMfaOtp: jest.Mock };
  let authService: AuthService;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      setMfaOtp: jest.fn(),
      clearMfaOtp: jest.fn(),
      createUser: jest.fn(),
      getUserRoles: jest.fn().mockResolvedValue(['ADMIN']),
      ensureDefaultRole: jest.fn(),
      toggleMfa: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('jwt-token'),
    };
    mailerService = {
      sendMfaOtp: jest.fn().mockResolvedValue(undefined),
    };

    authService = new AuthService(
      usersService as unknown as import('./users.service').UsersService,
      jwtService as unknown as import('@nestjs/jwt').JwtService,
      mailerService as unknown as MailerService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns accessToken when MFA is disabled', async () => {
    usersService.findByEmail.mockResolvedValue(createUser({ mfaEnabled: false }));
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await authService.login({ email: 'user@example.com', password: 'secret' });

    expect(result).toEqual({ accessToken: 'jwt-token' });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['ADMIN'] }),
    );
    expect(usersService.setMfaOtp).not.toHaveBeenCalled();
    expect(mailerService.sendMfaOtp).not.toHaveBeenCalled();
  });

  it('returns mfaRequired when MFA is enabled', async () => {
    usersService.findByEmail.mockResolvedValue(createUser({ mfaEnabled: true }));
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('otp-hash');

    const result = await authService.login({ email: 'user@example.com', password: 'secret' });

    expect(result).toEqual({ mfaRequired: true });
    expect(usersService.setMfaOtp).toHaveBeenCalledWith(
      'user@example.com',
      'otp-hash',
      expect.any(Date),
    );
    expect(mailerService.sendMfaOtp).toHaveBeenCalledWith('user@example.com', expect.any(String));
  });

  it('verifies MFA OTP and clears OTP fields', async () => {
    usersService.findByEmail.mockResolvedValue(
      createUser({
        mfaEnabled: true,
        mfaOtpHash: 'otp-hash',
        mfaOtpExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await authService.verifyMfa({ email: 'user@example.com', otp: '123456' });

    expect(result).toEqual({ accessToken: 'jwt-token' });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['ADMIN'] }),
    );
    expect(usersService.clearMfaOtp).toHaveBeenCalledWith('user@example.com');
  });

  it('assigns default role on register', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUser.mockResolvedValue(createUser({ id: 'user-2' }));
    usersService.getUserRoles.mockResolvedValue(['CUSTOMER']);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    await authService.register({ email: 'new@example.com', password: 'secret' });

    expect(usersService.ensureDefaultRole).toHaveBeenCalledWith('user-2');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['CUSTOMER'] }),
    );
  });

  it('rejects expired MFA OTP and clears OTP fields', async () => {
    usersService.findByEmail.mockResolvedValue(
      createUser({
        mfaEnabled: true,
        mfaOtpHash: 'otp-hash',
        mfaOtpExpiresAt: new Date(Date.now() - 1_000),
      }),
    );

    await expect(authService.verifyMfa({ email: 'user@example.com', otp: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.clearMfaOtp).toHaveBeenCalledWith('user@example.com');
  });

  it('rejects invalid MFA OTP', async () => {
    usersService.findByEmail.mockResolvedValue(
      createUser({
        mfaEnabled: true,
        mfaOtpHash: 'otp-hash',
        mfaOtpExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(authService.verifyMfa({ email: 'user@example.com', otp: '000000' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('enables MFA for authenticated user', async () => {
    usersService.findById.mockResolvedValue(createUser({ id: 'user-1', mfaEnabled: false }));

    const result = await authService.toggleMfa('user-1', { enabled: true });

    expect(result).toEqual({ mfaEnabled: true });
    expect(usersService.toggleMfa).toHaveBeenCalledWith('user-1', true);
  });

  it('disables MFA for authenticated user', async () => {
    usersService.findById.mockResolvedValue(createUser({ id: 'user-1', mfaEnabled: true }));

    const result = await authService.toggleMfa('user-1', { enabled: false });

    expect(result).toEqual({ mfaEnabled: false });
    expect(usersService.toggleMfa).toHaveBeenCalledWith('user-1', false);
  });

  it('throws NotFoundException when toggling MFA for non-existent user', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(authService.toggleMfa('non-existent', { enabled: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
