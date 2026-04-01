import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { PaymentsService } from './payments.service';

interface JwtUser {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('payments')
@Controller('payments')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a payment intent for an order' })
  @ApiOkResponse({ description: 'Payment created' })
  create(@Req() req: { user: JwtUser }, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(dto.orderId, req.user.userId);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm / process a payment (mock)' })
  @ApiOkResponse({ description: 'Payment result' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  confirm(
    @Req() req: { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.paymentsService.confirmPayment(
      id,
      req.user.userId,
      dto.cardNumber,
    );
  }

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get payment by order ID' })
  @ApiOkResponse({ description: 'Payment details or null' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  getByOrder(@Req() req: { user: JwtUser }, @Param('orderId') orderId: string) {
    return this.paymentsService.getByOrderId(orderId, req.user.userId);
  }
}
