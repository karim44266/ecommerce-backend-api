import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { BehaviorTrackingService } from './behavior-tracking.service';
import { CreateUserEventDto } from './dto/create-user-event.dto';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

type TrackingRequest = Request & { user?: { userId?: string } };

@ApiTags('tracking')
@Controller('tracking')
export class BehaviorTrackingController {
  constructor(
    private readonly behaviorTrackingService: BehaviorTrackingService,
  ) {}

  private resolveSessionId(request: Request): string {
    const headerValue = request.headers['x-session-id'];

    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      return headerValue;
    }

    if (
      Array.isArray(headerValue) &&
      typeof headerValue[0] === 'string' &&
      headerValue[0].trim().length > 0
    ) {
      return headerValue[0];
    }

    return randomUUID();
  }

  @Post('event')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OptionalJwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 60,
      ttl: 60,
    },
  })
  @ApiOperation({ summary: 'Track user behavior event (anonymous-safe)' })
  @ApiBearerAuth()
  @ApiAcceptedResponse({ description: 'Event accepted for async processing' })
  @ApiTooManyRequestsResponse({ description: 'Too many events from this IP' })
  createEvent(
    @Body() dto: CreateUserEventDto,
    @Req() request: TrackingRequest,
    @Res() response: Response,
  ): void {
    const userId = request.user?.userId;
    const sessionId = this.resolveSessionId(request);

    void this.behaviorTrackingService.recordEvent(dto, userId, sessionId);

    // Raw response prevents accidental wrapping by future global 2xx interceptors.
    response.status(HttpStatus.ACCEPTED).send();
  }
}
