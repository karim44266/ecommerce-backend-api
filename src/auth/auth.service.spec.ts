import { NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { MailerService } from './mailer.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const createUser = (overrides: Partial<{
  id: string;
  email: string;
  passwordHash: string;
  mfaEnabled: boolean;
  mfaOtpHash: string | null;
  mfaOtpExpiresAt: Date | null;
  status: string;
  refreshTokenHash: string | null;
  refreshTokenExpiresAt: Date | null;
}> = {}) => ({
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'hashed-password',
  mfaEnabled: false,
  mfaOtpHash: null,
  mfaOtpExpiresAt: null,
  status: 'active',
  refreshTokenHash: null,
  refreshTokenExpiresAt: null,
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
    setRefreshToken: jest.Mock;
    clearRefreshToken: jest.Mock;
    createPasswordResetRequest: jest.Mock;
    createAccountAppeal: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let mailerService: { sendMfaOtp: jest.Mock };
  let configService: { get: jest.Mock };
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
      setRefreshToken: jest.fn(),
      clearRefreshToken: jest.fn(),
      createPasswordResetRequest: jest.fn(),
      createAccountAppeal: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('jwt-token'),
    };
    mailerService = {
      sendMfaOtp: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string, fallback: string) => {
        const map: Record<string, string> = {
          REFRESH_TOKEN_EXPIRY_DAYS: '7',
          INACTIVITY_TIMEOUT_MINUTES: '30',
        };
        return map[key] ?? fallback;
      }),
    };

    authService = new AuthService(
      usersService as unknown as import('./users.service').UsersService,
      jwtService as unknown as import('@nestjs/jwt').JwtService,
      mailerService as unknown as MailerService,
      configService as unknown as import('@nestjs/config').ConfigService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --- Login ---

  it('returns accessToken and refreshToken when MFA is disabled', async () => {
    usersService.findByEmail.mockResolvedValue(createUser({ mfaEnabled: false }));
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-hash');

    const result = await authService.login({ email: 'user@example.com', password: 'secret' });

    expect(result).toHaveProperty('accessToken', 'jwt-token');
    expect(result).toHaveProperty('refreshToken');
    expect(result.refreshToken).toContain(':');
    expect(usersService.setRefreshToken).toHaveBeenCalled();
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

  it('throws ForbiddenException for blocked users', async () => {
    usersService.findByEmail.mockResolvedValue(createUser({ status: 'blocked' }));

    await expect(authService.login({ email: 'user@example.com', password: 'secret' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // --- MFA Verify ---

  it('verifies MFA OTP and returns both tokens', async () => {
    usersService.findByEmail.mockResolvedValue(
      createUser({
        mfaEnabled: true,
        mfaOtpHash: 'otp-hash',
        mfaOtpExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-hash');

    const result = await authService.verifyMfa({ email: 'user@example.com', otp: '123456' });

    expect(result).toHaveProperty('accessToken', 'jwt-token');
    expect(result).toHaveProperty('refreshToken');
    expect(usersService.clearMfaOtp).toHaveBeenCalledWith('user@example.com');
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

  // --- Register ---

  it('assigns default role on register and returns both tokens', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUser.mockResolvedValue(createUser({ id: 'user-2' }));
    usersService.getUserRoles.mockResolvedValue(['CUSTOMER']);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    const result = await authService.register({ email: 'new@example.com', password: 'secret' });

    expect(usersService.ensureDefaultRole).toHaveBeenCalledWith('user-2');
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });

  // --- MFA Toggle ---

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

  // --- Refresh Token ---

  it('issues new tokens with valid refresh token', async () => {
    const user = createUser({
      refreshTokenHash: 'stored-hash',
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
    });
    usersService.findById.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-refresh-hash');

    const result = await authService.refresh('user-1:valid-uuid');

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(usersService.setRefreshToken).toHaveBeenCalled();
  });

  it('rejects expired refresh token', async () => {
    const user = createUser({
      refreshTokenHash: 'stored-hash',
      refreshTokenExpiresAt: new Date(Date.now() - 1000),
    });
    usersService.findById.mockResolvedValue(user);

    await expect(authService.refresh('user-1:expired-uuid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.clearRefreshToken).toHaveBeenCalledWith('user-1');
  });

  it('rejects invalid refresh token format', async () => {
    await expect(authService.refresh('invalid-format')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects refresh for blocked user', async () => {
    const user = createUser({
      status: 'blocked',
      refreshTokenHash: 'stored-hash',
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
    });
    usersService.findById.mockResolvedValue(user);

    await expect(authService.refresh('user-1:some-uuid')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // --- Logout ---

  it('clears refresh token on logout', async () => {
    const result = await authService.logout('user-1');

    expect(result).toEqual({ message: 'Logged out successfully' });
    expect(usersService.clearRefreshToken).toHaveBeenCalledWith('user-1');
  });

  // --- Forgot Password ---

  it('creates a password reset request', async () => {
    usersService.createPasswordResetRequest.mockResolvedValue({ id: 'req-1' });

    const result = await authService.forgotPassword({ identifier: 'user@example.com' });

    expect(result).toHaveProperty('message');
    expect(usersService.createPasswordResetRequest).toHaveBeenCalledWith('user@example.com', undefined);
  });

  // --- Blocked Appeal ---

  it('creates an account appeal', async () => {
    usersService.createAccountAppeal.mockResolvedValue({ id: 'appeal-1' });

    const result = await authService.submitBlockedAppeal({
      name: 'Ahmed',
      accountNumber: 'RES-001',
      explanation: 'This is a detailed explanation of my situation.',
    });

    expect(result).toHaveProperty('message');
    expect(usersService.createAccountAppeal).toHaveBeenCalledWith(
      'Ahmed',
      'RES-001',
      'This is a detailed explanation of my situation.',
    );
  });

  // --- Inactivity Config ---

  it('returns inactivity config', () => {
    const result = authService.getInactivityConfig();
    expect(result).toEqual({ timeoutMinutes: 30 });
  });
});
