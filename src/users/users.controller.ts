import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiConflictResponse } from '@nestjs/swagger';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiOkResponse({ description: 'Current user profile' })
  me(@Req() request: { user: { userId: string } }) {
    return this.usersService.findById(request.user.userId);
  }

  @Patch('me/profile')
  @ApiOperation({ summary: 'Update current authenticated user profile' })
  @ApiOkResponse({ description: 'Updated profile' })
  updateOwnProfile(
    @Req() request: { user: { userId: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateOwnProfile(request.user.userId, dto);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change current authenticated user password' })
  @ApiOkResponse({ description: 'Password changed' })
  changeOwnPassword(
    @Req() request: { user: { userId: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changeOwnPassword(
      request.user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiOkResponse({ description: 'Paginated user list' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search: search || undefined,
    });
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  @ApiCreatedResponse({ description: 'User created successfully' })
  @ApiConflictResponse({ description: 'Email already exists' })
  async create(@Body() dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.createUser(dto.email, passwordHash, dto.role || 'CUSTOMER');
    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      status: user.status,
    };
  }

  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get user by ID (admin only)' })
  @ApiOkResponse({ description: 'User detail' })
  @ApiNotFoundResponse({ description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id/role')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update user role (admin only)' })
  @ApiOkResponse({ description: 'Updated user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(id, dto.role);
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Block / unblock user (admin only)' })
  @ApiOkResponse({ description: 'Updated user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.usersService.updateStatus(id, dto.status);
  }
}
