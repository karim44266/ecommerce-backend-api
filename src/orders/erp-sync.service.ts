import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
import { ErpSyncJob, ErpSyncJobDocument } from './schemas/erp-sync-job.schema';

@Injectable()
export class ErpSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpSyncService.name);

  private workerTimer: NodeJS.Timeout | null = null;

  private readonly maxRetries = Math.max(1, Number(process.env.ERP_SYNC_MAX_RETRIES ?? 3));
  private readonly retryDelayMs = Math.max(1000, Number(process.env.ERP_SYNC_RETRY_DELAY_MS ?? 5000));
  private readonly maxRetryDelayMs = Math.max(
    this.retryDelayMs,
    Number(process.env.ERP_SYNC_MAX_RETRY_DELAY_MS ?? 60000),
  );
  private readonly workerIntervalMs = Math.max(
    500,
    Number(process.env.ERP_SYNC_PROCESS_INTERVAL_MS ?? 3000),
  );
  private readonly workerBatchSize = Math.max(1, Number(process.env.ERP_SYNC_BATCH_SIZE ?? 5));

  private readonly erpConnector =
    (process.env.ERP_SYNC_CONNECTOR ?? (process.env.ERP_ORDER_ENDPOINT ? 'http' : 'mock')).toLowerCase();
  private readonly erpOrderEndpoint = process.env.ERP_ORDER_ENDPOINT ?? '';
  private readonly erpApiKey = process.env.ERP_API_KEY ?? '';
  private readonly erpHttpTimeoutMs = Math.max(1000, Number(process.env.ERP_HTTP_TIMEOUT_MS ?? 10000));

  private readonly mockFailureRate = Math.min(
    1,
    Math.max(0, Number(process.env.ERP_MOCK_FAILURE_RATE ?? 0)),
  );

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(ErpSyncJob.name) private readonly erpSyncJobModel: Model<ErpSyncJobDocument>,
  ) {}

  onModuleInit() {
    this.workerTimer = setInterval(() => {
      void this.processQueue();
    }, this.workerIntervalMs);

    void this.processQueue();
    this.logger.log(`[ERP] Durable sync worker started (connector=${this.erpConnector})`);
  }

  onModuleDestroy() {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  async pushOrderToErp(orderId: string, force = false): Promise<void> {
    const order = await this.orderModel
      .findById(orderId)
      .select('erpSyncStatus');

    if (!order) {
      this.logger.warn(`[ERP] Order not found for sync: ${orderId}`);
      return;
    }

    if (!force && order.erpSyncStatus === 'SYNCED') {
      this.logger.log(`[ERP] Order already synced: ${orderId}`);
      return;
    }

    if (!force) {
      const existingPending = await this.erpSyncJobModel.findOne({
        orderId,
        status: { $in: ['PENDING', 'PROCESSING'] },
      });

      if (existingPending) {
        this.logger.log(`[ERP] Existing sync job already queued for order ${orderId}`);
        return;
      }
    }

    await this.erpSyncJobModel.create({
      orderId,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: this.maxRetries,
      nextRunAt: new Date(),
      force,
      reason: force ? 'MANUAL_RETRY' : 'STATUS_CONFIRMED',
    });

    await this.orderModel.findByIdAndUpdate(orderId, {
      $set: {
        erpSyncStatus: 'PENDING',
        erpLastSyncError: null,
      },
    });

    void this.processQueue();
  }

  private async processQueue() {
    for (let index = 0; index < this.workerBatchSize; index += 1) {
      const job = await this.erpSyncJobModel.findOneAndUpdate(
        {
          status: 'PENDING',
          nextRunAt: { $lte: new Date() },
        },
        {
          $set: {
            status: 'PROCESSING',
            lockedAt: new Date(),
          },
        },
        {
          sort: { nextRunAt: 1, createdAt: 1 },
          new: true,
        },
      );

      if (!job) {
        return;
      }

      await this.handleJob(job);
    }
  }

  private async handleJob(job: ErpSyncJobDocument) {
    const order = await this.orderModel.findById(job.orderId);

    if (!order) {
      await this.erpSyncJobModel.findByIdAndUpdate(job.id, {
        $set: {
          status: 'FAILED',
          lockedAt: null,
          lastError: 'Order not found',
        },
      });
      this.logger.warn(`[ERP] Sync job failed: order not found (${job.orderId})`);
      return;
    }

    const attemptNumber = job.attempts + 1;

    await this.orderModel.findByIdAndUpdate(order.id, {
      $set: {
        erpSyncStatus: 'PENDING',
        erpLastSyncError: null,
      },
      $inc: { erpSyncAttempts: 1 },
    });

    try {
      const erpRef = await this.sendOrderToErp(order, order.erpReference ?? null);

      await this.orderModel.findByIdAndUpdate(order.id, {
        $set: {
          erpReference: erpRef,
          erpSyncStatus: 'SYNCED',
          erpLastSyncError: null,
          erpLastSyncedAt: new Date(),
        },
      });

      await this.erpSyncJobModel.findByIdAndUpdate(job.id, {
        $set: {
          status: 'SUCCEEDED',
          attempts: attemptNumber,
          lockedAt: null,
          lastError: null,
        },
      });

      this.logger.log(`[ERP] Sync successful for order ${order.id}. ERP Ref: ${erpRef}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ERP sync error';
      const canRetry = attemptNumber < (job.maxAttempts ?? this.maxRetries);

      await this.orderModel.findByIdAndUpdate(order.id, {
        $set: {
          erpSyncStatus: 'FAILED',
          erpLastSyncError: message,
        },
      });

      if (canRetry) {
        const nextDelayMs = this.getBackoffDelayMs(attemptNumber);
        const nextRunAt = new Date(Date.now() + nextDelayMs);

        await this.erpSyncJobModel.findByIdAndUpdate(job.id, {
          $set: {
            status: 'PENDING',
            attempts: attemptNumber,
            lockedAt: null,
            lastError: message,
            nextRunAt,
          },
        });

        this.logger.warn(
          `[ERP] Sync failed for order ${order.id}; retry ${attemptNumber}/${job.maxAttempts} in ${nextDelayMs}ms: ${message}`,
        );
      } else {
        await this.erpSyncJobModel.findByIdAndUpdate(job.id, {
          $set: {
            status: 'FAILED',
            attempts: attemptNumber,
            lockedAt: null,
            lastError: message,
          },
        });

        this.logger.error(
          `[ERP] Sync permanently failed for order ${order.id} after ${attemptNumber} attempts: ${message}`,
        );
      }
    }
  }

  private getBackoffDelayMs(attemptNumber: number): number {
    const base = this.retryDelayMs * 2 ** Math.max(0, attemptNumber - 1);
    return Math.min(this.maxRetryDelayMs, base);
  }

  private async sendOrderToErp(order: OrderDocument, existingReference: string | null): Promise<string> {
    if (this.erpConnector === 'http') {
      return this.httpPush(order, existingReference);
    }

    return this.mockPush(order.id, existingReference);
  }

  private async httpPush(order: OrderDocument, existingReference: string | null): Promise<string> {
    if (!this.erpOrderEndpoint) {
      throw new Error('ERP_ORDER_ENDPOINT is not configured for HTTP connector');
    }

    const payload = {
      localOrderId: order.id,
      localStatus: order.status,
      customer: {
        userId: String(order.userId),
        fullName: order.shippingAddress?.fullName ?? null,
        email: order.shippingAddress?.clientEmail ?? null,
        phone: order.shippingAddress?.clientPhone ?? null,
      },
      shippingAddress: order.shippingAddress,
      items: (order.items ?? []).map((item) => ({
        productId: String(item.productId),
        name: item.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice) / 100,
      })),
      totalAmount: Number(order.totalAmount) / 100,
      createdAt: (order as unknown as { createdAt?: Date }).createdAt ?? new Date(),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.erpHttpTimeoutMs);

    try {
      const response = await fetch(this.erpOrderEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.erpApiKey ? { Authorization: `Bearer ${this.erpApiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let parsed: Record<string, unknown> | null = null;

      if (responseText.trim().length > 0) {
        try {
          parsed = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      if (!response.ok) {
        throw new Error(
          `ERP HTTP ${response.status}: ${
            typeof parsed?.message === 'string' ? parsed.message : responseText || 'unknown error'
          }`,
        );
      }

      const erpReference =
        (typeof parsed?.erpReference === 'string' && parsed.erpReference) ||
        (typeof parsed?.reference === 'string' && parsed.reference) ||
        existingReference ||
        `ERP-ORD-${Math.floor(10000 + Math.random() * 90000)}`;

      return erpReference;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async mockPush(orderId: string, existingReference: string | null): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (Math.random() < this.mockFailureRate) {
      throw new Error('ERP service unavailable (mock failure)');
    }

    if (existingReference && existingReference.trim().length > 0) {
      return existingReference;
    }

    return `ERP-ORD-${Math.floor(10000 + Math.random() * 90000)}`;
  }
}
