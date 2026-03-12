import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { Payment, PaymentDocument } from './schemas/payment.schema';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  /**
   * Create a payment intent (mock) for an order.
   * Only the order owner can create a payment.
   * The order must be in PENDING_PAYMENT status.
   */
  async createPayment(orderId: string, userId: string) {
    const order = await this.orderModel.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (String(order.userId) !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException(
        `Order is in "${order.status}" status. Payment only allowed for PENDING_PAYMENT orders.`,
      );
    }

    const existing = await this.paymentModel.findOne({ orderId });

    if (existing) {
      if (existing.status === 'PENDING') {
        return this.formatPayment(existing);
      }
      throw new BadRequestException('Payment already processed for this order');
    }

    const payment = await this.paymentModel.create({
      orderId,
      amount: order.totalAmount,
      status: 'PENDING',
      provider: 'mock',
      providerPaymentId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    });

    return this.formatPayment(payment);
  }

  /**
   * Confirm / process a payment (mock — always succeeds unless card starts with 0000).
   * Updates order status to PAID on success.
   */
  async confirmPayment(
    paymentId: string,
    userId: string,
    cardNumber?: string,
  ) {
    const payment = await this.paymentModel.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const order = await this.orderModel.findById(payment.orderId);

    if (!order || String(order.userId) !== userId) {
      throw new ForbiddenException('You do not have access to this payment');
    }

    if (payment.status !== 'PENDING') {
      throw new BadRequestException(`Payment is already ${payment.status}`);
    }

    // Mock: simulate failure if card starts with 0000
    const simulateFailure =
      cardNumber && cardNumber.replace(/\s/g, '').startsWith('0000');

    if (simulateFailure) {
      await this.paymentModel.findByIdAndUpdate(paymentId, { status: 'FAILED' });

      return {
        id: payment.id,
        orderId: payment.orderId,
        status: 'FAILED',
        message: 'Payment was declined. Please try a different card.',
      };
    }

    const session = await this.connection.startSession();

    try {
      let updatedPayment: PaymentDocument | null = null;

      await session.withTransaction(async () => {
        updatedPayment = await this.paymentModel.findByIdAndUpdate(
          paymentId,
          { status: 'COMPLETED' },
          { new: true, session },
        );

        await this.orderModel.findByIdAndUpdate(
          payment.orderId,
          {
            $set: { status: 'PAID' },
            $push: {
              statusHistory: {
                status: 'PAID',
                note: 'Payment confirmed (mock provider)',
                changedBy: userId,
                createdAt: new Date(),
              },
            },
          },
          { session },
        );
      });

      if (!updatedPayment) {
        throw new NotFoundException('Payment not found');
      }

      return this.formatPayment(updatedPayment);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Get payment by order ID (for the order owner).
   */
  async getByOrderId(orderId: string, userId: string) {
    const order = await this.orderModel.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (String(order.userId) !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const payment = await this.paymentModel.findOne({ orderId });

    if (!payment) {
      return null;
    }

    return this.formatPayment(payment);
  }

  private formatPayment(payment: PaymentDocument | Record<string, any>) {
    const plain = typeof (payment as PaymentDocument).toJSON === 'function'
      ? ((payment as PaymentDocument).toJSON() as Record<string, any>)
      : (payment as Record<string, any>);
    return {
      id: plain.id,
      orderId: typeof plain.orderId === 'object' ? plain.orderId.id ?? String(plain.orderId._id) : String(plain.orderId),
      amount: plain.amount / 100,
      amountCents: plain.amount,
      status: plain.status,
      provider: plain.provider,
      providerPaymentId: plain.providerPaymentId,
      createdAt: new Date(plain.createdAt).toISOString(),
      updatedAt: new Date(plain.updatedAt).toISOString(),
    };
  }
}
