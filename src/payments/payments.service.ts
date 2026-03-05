import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Create a payment intent (mock) for an order.
   * Only the order owner can create a payment.
   * The order must be in PENDING_PAYMENT status.
   */
  async createPayment(orderId: string, userId: string) {
    // Verify order exists and belongs to user
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException(
        `Order is in "${order.status}" status. Payment only allowed for PENDING_PAYMENT orders.`,
      );
    }

    // Check if payment already exists for this order
    const [existing] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));

    if (existing) {
      // Return existing payment if still pending
      if (existing.status === 'PENDING') {
        return this.formatPayment(existing);
      }
      throw new BadRequestException('Payment already processed for this order');
    }

    // Create new payment record
    const [payment] = await this.db
      .insert(schema.payments)
      .values({
        orderId,
        amount: order.totalAmount,
        status: 'PENDING',
        provider: 'mock',
        providerPaymentId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      })
      .returning();

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
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId));

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Verify order ownership
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, payment.orderId));

    if (!order || order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this payment');
    }

    if (payment.status !== 'PENDING') {
      throw new BadRequestException(`Payment is already ${payment.status}`);
    }

    // Mock: simulate failure if card starts with 0000
    const simulateFailure =
      cardNumber && cardNumber.replace(/\s/g, '').startsWith('0000');

    if (simulateFailure) {
      await this.db
        .update(schema.payments)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.payments.id, paymentId));

      return {
        id: payment.id,
        orderId: payment.orderId,
        status: 'FAILED',
        message: 'Payment was declined. Please try a different card.',
      };
    }

    // Mock success — update payment + order status in a transaction
    const result = await this.db.transaction(async (tx) => {
      const [updatedPayment] = await tx
        .update(schema.payments)
        .set({ status: 'COMPLETED', updatedAt: new Date() })
        .where(eq(schema.payments.id, paymentId))
        .returning();

      await tx
        .update(schema.orders)
        .set({ status: 'PAID', updatedAt: new Date() })
        .where(eq(schema.orders.id, payment.orderId));

      // Add status history entry
      await tx.insert(schema.orderStatusHistory).values({
        orderId: payment.orderId,
        status: 'PAID',
        note: 'Payment confirmed (mock provider)',
        changedBy: userId,
      });

      return updatedPayment;
    });

    return this.formatPayment(result);
  }

  /**
   * Get payment by order ID (for the order owner).
   */
  async getByOrderId(orderId: string, userId: string) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));

    if (!payment) {
      return null;
    }

    return this.formatPayment(payment);
  }

  private formatPayment(payment: typeof schema.payments.$inferSelect) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount / 100,
      amountCents: payment.amount,
      status: payment.status,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
