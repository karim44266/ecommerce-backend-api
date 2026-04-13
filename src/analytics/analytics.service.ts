import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  Shipment,
  ShipmentDocument,
} from '../shipments/schemas/shipment.schema';

const ACTIVE_SHIPMENT_STATUSES = ['ASSIGNED', 'IN_TRANSIT'];
const SOLD_ORDER_STATUSES = ['DELIVERED', 'SETTLED'];
const OPEN_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PREPARATION'];
const REVENUE_TREND_STATUSES = [...OPEN_ORDER_STATUSES, ...SOLD_ORDER_STATUSES];

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
  ) {}

  async getDashboardSummary() {
    const [orderAgg, financialAgg, activeDeliveries] = await Promise.all([
      this.orderModel.aggregate<{
        totalOrders: number;
        pendingOrders: number;
      }>([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            pendingOrders: {
              $sum: {
                $cond: [{ $in: ['$status', OPEN_ORDER_STATUSES] }, 1, 0],
              },
            },
          },
        },
      ]),
      this.orderModel.aggregate<{
        soldOrders: number;
        grossSalesCents: number;
        totalCostCents: number;
      }>([
        { $match: { status: { $in: SOLD_ORDER_STATUSES } } },
        {
          $project: {
            totalAmount: 1,
            orderCostCents: {
              $reduce: {
                input: '$items',
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $multiply: [
                        { $ifNull: ['$$this.quantity', 0] },
                        { $ifNull: ['$$this.unitCost', 0] },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            soldOrders: { $sum: 1 },
            grossSalesCents: { $sum: '$totalAmount' },
            totalCostCents: { $sum: '$orderCostCents' },
          },
        },
      ]),
      this.shipmentModel.countDocuments({
        status: { $in: ACTIVE_SHIPMENT_STATUSES },
      }),
    ]);

    const base = orderAgg[0] ?? {
      totalOrders: 0,
      pendingOrders: 0,
    };
    const finance = financialAgg[0] ?? {
      soldOrders: 0,
      grossSalesCents: 0,
      totalCostCents: 0,
    };

    const grossSales = Number((finance.grossSalesCents / 100).toFixed(2));
    const totalCost = Number((finance.totalCostCents / 100).toFixed(2));
    const totalRevenue = Number((grossSales - totalCost).toFixed(2));
    const avgOrderValue =
      finance.soldOrders > 0
        ? Number((grossSales / finance.soldOrders).toFixed(2))
        : 0;
    const fulfilmentRate =
      base.totalOrders > 0
        ? Number(
            (
              ((base.totalOrders - base.pendingOrders) / base.totalOrders) *
              100
            ).toFixed(0),
          )
        : 0;

    return {
      totalOrders: base.totalOrders,
      totalRevenue,
      grossSales,
      totalCost,
      pendingOrders: base.pendingOrders,
      activeDeliveries,
      avgOrderValue,
      fulfilmentRate,
    };
  }

  async getDashboardTrends(days: number) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const rows = await this.orderModel.aggregate<{
      date: string;
      orders: number;
      grossSalesCents: number;
      totalCostCents: number;
      revenueCents: number;
    }>([
      {
        $match: {
          createdAt: { $gte: start },
        },
      },
      {
        $project: {
          createdAt: 1,
          status: 1,
          totalAmount: 1,
          orderCostCents: {
            $reduce: {
              input: '$items',
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  {
                    $multiply: [
                      { $ifNull: ['$$this.quantity', 0] },
                      { $ifNull: ['$$this.unitCost', 0] },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
            },
          },
          orders: { $sum: 1 },
          grossSalesCents: {
            $sum: {
              $cond: [
                { $in: ['$status', REVENUE_TREND_STATUSES] },
                '$totalAmount',
                0,
              ],
            },
          },
          totalCostCents: {
            $sum: {
              $cond: [
                { $in: ['$status', REVENUE_TREND_STATUSES] },
                '$orderCostCents',
                0,
              ],
            },
          },
          revenueCents: {
            $sum: {
              $cond: [
                { $in: ['$status', REVENUE_TREND_STATUSES] },
                { $subtract: ['$totalAmount', '$orderCostCents'] },
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          orders: 1,
          grossSalesCents: 1,
          totalCostCents: 1,
          revenueCents: 1,
        },
      },
    ]);

    const byDate = new Map(rows.map((row) => [row.date, row]));
    const labels: string[] = [];
    const ordersPerDay: number[] = [];
    const grossSalesPerDay: number[] = [];
    const totalCostPerDay: number[] = [];
    const revenuePerDay: number[] = [];
    const marginPercentPerDay: number[] = [];

    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      const match = byDate.get(date);

      labels.push(
        d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
      );
      const gross = Number(((match?.grossSalesCents ?? 0) / 100).toFixed(2));
      const cost = Number(((match?.totalCostCents ?? 0) / 100).toFixed(2));
      const net = Number(((match?.revenueCents ?? 0) / 100).toFixed(2));

      ordersPerDay.push(match?.orders ?? 0);
      grossSalesPerDay.push(gross);
      totalCostPerDay.push(cost);
      revenuePerDay.push(net);
      marginPercentPerDay.push(
        gross > 0 ? Number(((net / gross) * 100).toFixed(1)) : 0,
      );
    }

    return {
      labels,
      ordersPerDay,
      grossSalesPerDay,
      totalCostPerDay,
      revenuePerDay,
      marginPercentPerDay,
    };
  }

  async getStatusDistribution() {
    const rows = await this.orderModel.aggregate<{
      status: string;
      count: number;
    }>([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          status: { $ifNull: ['$_id', 'UNKNOWN'] },
          count: 1,
        },
      },
    ]);

    return {
      statuses: rows,
    };
  }

  async getProductInsights(productId: string, days = 30) {
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
    if (!Types.ObjectId.isValid(productId)) {
      return {
        days: safeDays,
        totalOrders: 0,
        soldUnits: 0,
        grossSales: 0,
        totalCost: 0,
        netRevenue: 0,
        trend: {
          labels: [],
          ordersPerDay: [],
          revenuePerDay: [],
          marginPercentPerDay: [],
        },
      };
    }

    const productObjectId = new Types.ObjectId(productId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (safeDays - 1));

    const [productInsights] = await this.orderModel.aggregate<{
      totalOrders: number;
      soldUnits: number;
      grossSalesCents: number;
      totalCostCents: number;
    }>([
      {
        $match: {
          createdAt: { $gte: start },
          status: { $in: SOLD_ORDER_STATUSES },
        },
      },
      { $unwind: '$items' },
      {
        $match: {
          'items.productId': productObjectId,
        },
      },
      {
        $project: {
          orderId: '$_id',
          quantity: { $ifNull: ['$items.quantity', 0] },
          lineGrossCents: {
            $multiply: [
              { $ifNull: ['$items.quantity', 0] },
              { $ifNull: ['$items.unitPrice', 0] },
            ],
          },
          lineCostCents: {
            $multiply: [
              { $ifNull: ['$items.quantity', 0] },
              { $ifNull: ['$items.unitCost', 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          orderIds: { $addToSet: '$orderId' },
          soldUnits: { $sum: '$quantity' },
          grossSalesCents: { $sum: '$lineGrossCents' },
          totalCostCents: { $sum: '$lineCostCents' },
        },
      },
      {
        $project: {
          _id: 0,
          totalOrders: { $size: '$orderIds' },
          soldUnits: 1,
          grossSalesCents: 1,
          totalCostCents: 1,
        },
      },
    ]);

    const trendRows = await this.orderModel.aggregate<{
      date: string;
      orders: number;
      grossSalesCents: number;
      totalCostCents: number;
      revenueCents: number;
    }>([
      {
        $match: {
          createdAt: { $gte: start },
          status: { $in: SOLD_ORDER_STATUSES },
        },
      },
      { $unwind: '$items' },
      {
        $match: {
          'items.productId': productObjectId,
        },
      },
      {
        $project: {
          createdAt: 1,
          orderId: '$_id',
          lineGrossCents: {
            $multiply: [
              { $ifNull: ['$items.quantity', 0] },
              { $ifNull: ['$items.unitPrice', 0] },
            ],
          },
          lineCostCents: {
            $multiply: [
              { $ifNull: ['$items.quantity', 0] },
              { $ifNull: ['$items.unitCost', 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
              },
            },
            orderId: '$orderId',
          },
          grossSalesCents: { $sum: '$lineGrossCents' },
          totalCostCents: { $sum: '$lineCostCents' },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          orders: { $sum: 1 },
          grossSalesCents: { $sum: '$grossSalesCents' },
          totalCostCents: { $sum: '$totalCostCents' },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          orders: 1,
          grossSalesCents: 1,
          totalCostCents: 1,
          revenueCents: { $subtract: ['$grossSalesCents', '$totalCostCents'] },
        },
      },
      { $sort: { date: 1 } },
    ]);

    const stats = productInsights ?? {
      totalOrders: 0,
      soldUnits: 0,
      grossSalesCents: 0,
      totalCostCents: 0,
    };

    const byDate = new Map(trendRows.map((row) => [row.date, row]));
    const labels: string[] = [];
    const ordersPerDay: number[] = [];
    const revenuePerDay: number[] = [];
    const marginPercentPerDay: number[] = [];

    for (let i = 0; i < safeDays; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      const row = byDate.get(date);

      const gross = Number(((row?.grossSalesCents ?? 0) / 100).toFixed(2));
      const net = Number(((row?.revenueCents ?? 0) / 100).toFixed(2));

      labels.push(
        d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
      );
      ordersPerDay.push(row?.orders ?? 0);
      revenuePerDay.push(net);
      marginPercentPerDay.push(gross > 0 ? Number(((net / gross) * 100).toFixed(1)) : 0);
    }

    const netRevenue = Number(
      ((stats.grossSalesCents - stats.totalCostCents) / 100).toFixed(2),
    );

    return {
      days: safeDays,
      totalOrders: stats.totalOrders,
      soldUnits: stats.soldUnits,
      grossSales: Number((stats.grossSalesCents / 100).toFixed(2)),
      totalCost: Number((stats.totalCostCents / 100).toFixed(2)),
      netRevenue,
      trend: {
        labels,
        ordersPerDay,
        revenuePerDay,
        marginPercentPerDay,
      },
    };
  }
}
