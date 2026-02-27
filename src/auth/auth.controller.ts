import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MfaToggleDto } from './dto/mfa-toggle.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({ description: 'Returns access token or MFA challenge' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiOkResponse({ description: 'Returns access token for the new account' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(@Body() dto: RegisterDto) {
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
  @ApiOkResponse({ description: 'Returns access token on valid OTP' })
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
}
