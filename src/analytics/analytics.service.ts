import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  Shipment,
  ShipmentDocument,
} from '../shipments/schemas/shipment.schema';

const ACTIVE_SHIPMENT_STATUSES = ['ASSIGNED', 'IN_TRANSIT'];
const SOLD_ORDER_STATUSES = ['DELIVERED'];

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
                $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0],
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
          status: { $in: SOLD_ORDER_STATUSES },
        },
      },
      {
        $project: {
          createdAt: 1,
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
          grossSalesCents: { $sum: '$totalAmount' },
          totalCostCents: { $sum: '$orderCostCents' },
          revenueCents: {
            $sum: { $subtract: ['$totalAmount', '$orderCostCents'] },
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
}
