import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { BlockedAppealDto } from './dto/blocked-appeal.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MfaToggleDto } from './dto/mfa-toggle.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({ description: 'Returns access token + refresh token, or MFA challenge' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @ApiForbiddenResponse({ description: 'Account is blocked' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiOkResponse({ description: 'Returns access token + refresh token for the new account' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(@Body() dto: { email: string; password: string }) {
    return this.authService.register(dto);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user info' })
  @ApiOkResponse({ description: 'Returns user id, email, and roles' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  me(@Req() request: { user: { userId: string; email: string; roles: string[] } }) {
    return request.user;
  }

  @Post('mfa/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60,
    },
  })
  @ApiOperation({ summary: 'Verify MFA OTP code' })
  @ApiOkResponse({ description: 'Returns access token + refresh token on valid OTP' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired OTP' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts' })
  async verifyMfa(@Body() dto: MfaVerifyDto) {
    return this.authService.verifyMfa(dto);
  }

  @Patch('mfa')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable MFA for the current user' })
  @ApiOkResponse({ description: 'Returns updated MFA status' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async toggleMfa(
    @Req() request: { user: { userId: string } },
    @Body() dto: MfaToggleDto,
  ) {
    return this.authService.toggleMfa(request.user.userId, dto);
  }

  // --- Refresh Token ---

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using a valid refresh token' })
  @ApiOkResponse({ description: 'Returns new access token + refresh token' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  @ApiOkResponse({ description: 'Logged out successfully' })
  async logout(@Req() request: { user: { userId: string } }) {
    return this.authService.logout(request.user.userId);
  }

  // --- Forgot Password ---

  @Post('forgot-password')
  @ApiOperation({ summary: 'Submit a forgot-password request for admin review' })
  @ApiOkResponse({ description: 'Request submitted successfully' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // --- Blocked Account Appeal ---

  @Post('blocked-appeal')
  @ApiOperation({ summary: 'Submit an appeal for a blocked account' })
  @ApiOkResponse({ description: 'Appeal submitted successfully' })
  async blockedAppeal(@Body() dto: BlockedAppealDto) {
    return this.authService.submitBlockedAppeal(dto);
  }

  // --- Inactivity Config ---

  @Get('inactivity-config')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get inactivity timeout configuration' })
  @ApiOkResponse({ description: 'Returns timeout in minutes' })
  getInactivityConfig() {
    return this.authService.getInactivityConfig();
  }
}
