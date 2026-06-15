import { config } from 'dotenv';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';

config({ path: path.join(process.cwd(), '.env') });

const SESSION_PREFIX = 'promo-seed';
const COMPLETED_ORDER_STATUSES = ['DELIVERED', 'SETTLED'];

type SeedMode = 'default' | 'stress';

interface PromotionSeedOptions {
  mode: SeedMode;
  targetProducts: number;
  targetCompletedOrders: number;
  trackedProducts: number;
  convertedConversions: number;
  openConversions: number;
}

const PROMOTION_SEED_PRESETS: Record<SeedMode, Omit<PromotionSeedOptions, 'mode'>> = {
  default: {
    targetProducts: 18,
    targetCompletedOrders: 12,
    trackedProducts: 6,
    convertedConversions: 12,
    openConversions: 24,
  },
  stress: {
    targetProducts: 36,
    targetCompletedOrders: 30,
    trackedProducts: 18,
    convertedConversions: 30,
    openConversions: 120,
  },
};

interface CustomerUser {
  _id: ObjectId;
  email: string;
  name: string;
}

interface SeedCategory {
  _id: ObjectId;
  name: string;
  slug: string;
}

interface SeedProduct {
  _id: ObjectId;
  name: string;
  price: number;
  costPrice: number;
  categoryId: ObjectId;
  quantity: number;
}

interface OrderItemDoc {
  productId: ObjectId;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
}

interface CompletedOrder {
  _id: ObjectId;
  userId: ObjectId;
  items: OrderItemDoc[];
  createdAt: Date;
  updatedAt: Date;
}

function toObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) {
    return value;
  }

  if (typeof value === 'string' && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }

  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return fallback;
}

function toSafeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function getTopCategoryIds(products: SeedProduct[]): ObjectId[] {
  const byCategory = new Map<string, { categoryId: ObjectId; count: number }>();

  for (const product of products) {
    const key = product.categoryId.toHexString();
    const existing = byCategory.get(key);
    if (!existing) {
      byCategory.set(key, { categoryId: product.categoryId, count: 1 });
      continue;
    }

    existing.count += 1;
  }

  return Array.from(byCategory.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
    .map((entry) => entry.categoryId);
}

function rotateArray<T>(items: T[], offset: number): T[] {
  if (items.length === 0) {
    return [];
  }

  const safeOffset = ((offset % items.length) + items.length) % items.length;
  return items.slice(safeOffset).concat(items.slice(0, safeOffset));
}

function buildAffinityScores(count: number): number[] {
  if (count <= 0) {
    return [];
  }

  const base = [0.55, 0.3, 0.15].slice(0, count);
  return base.map((score, index, scores) => {
    if (index === scores.length - 1) {
      const used = scores.slice(0, index).reduce((sum, value) => sum + value, 0);
      return Number((1 - used).toFixed(6));
    }
    return score;
  });
}

function pickProductsForUser(
  products: SeedProduct[],
  categoryIds: ObjectId[],
  targetCount: number,
  offset: number,
): SeedProduct[] {
  const categorySet = new Set(categoryIds.map((id) => id.toHexString()));
  const preferred = products.filter((product) => categorySet.has(product.categoryId.toHexString()));
  const source = preferred.length >= targetCount ? preferred : products;

  if (source.length === 0) {
    return [];
  }

  const rotated = rotateArray(source, offset);
  return rotated.slice(0, Math.min(targetCount, rotated.length));
}

function sessionId(suffix: string): string {
  return `${SESSION_PREFIX}-${suffix}`;
}

function parseSeedMode(argv: string[]): SeedMode {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const raw = (modeArg?.split('=')[1] ?? process.env.SEED_PROMOTIONS_MODE ?? 'default')
    .toString()
    .trim()
    .toLowerCase();

  if (raw === 'stress') {
    return 'stress';
  }

  return 'default';
}

function resolveSeedOptions(argv: string[]): PromotionSeedOptions {
  const mode = parseSeedMode(argv);
  return {
    mode,
    ...PROMOTION_SEED_PRESETS[mode],
  };
}

async function ensureCustomers(db: ReturnType<MongoClient['db']>): Promise<CustomerUser[]> {
  const users = db.collection<Record<string, unknown>>('users');

  const existing = await users
    .find(
      {
        status: { $ne: 'blocked' },
        $or: [
          { roles: { $in: ['CUSTOMER', 'customer'] } },
          { role: { $in: ['CUSTOMER', 'customer'] } },
        ],
      },
      {
        projection: { _id: 1, email: 1, name: 1 },
      },
    )
    .limit(20)
    .toArray();

  if (existing.length > 0) {
    return existing
      .map((row) => {
        const id = toObjectId(row._id);
        if (!id) {
          return null;
        }

        return {
          _id: id,
          email: String(row.email ?? 'unknown@local.test'),
          name: String(row.name ?? 'Customer'),
        };
      })
      .filter((row): row is CustomerUser => row !== null);
  }

  const now = new Date();
  const suffix = now.getTime();
  const inserted: Array<Record<string, unknown>> = [];

  for (let index = 0; index < 5; index += 1) {
    const id = new ObjectId();
    inserted.push({
      _id: id,
      email: `promo.seed.customer.${suffix}.${index + 1}@local.test`,
      name: `Promo Seed Customer ${index + 1}`,
      roles: ['CUSTOMER'],
      status: 'active',
      availabilityStatus: 'UNAVAILABLE',
      passwordHash: 'seed-password-hash',
      mfaEnabled: false,
      mfaOtpHash: null,
      mfaOtpExpiresAt: null,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await users.insertMany(inserted, { ordered: false });

  return inserted.map((row) => ({
    _id: row._id as ObjectId,
    email: String(row.email),
    name: String(row.name),
  }));
}

async function ensureCategories(
  db: ReturnType<MongoClient['db']>,
): Promise<SeedCategory[]> {
  const categories = db.collection<Record<string, unknown>>('categories');

  const existing = await categories
    .find({}, { projection: { _id: 1, name: 1, slug: 1 } })
    .limit(20)
    .toArray();

  const mappedExisting = existing
    .map((row) => {
      const id = toObjectId(row._id);
      if (!id) {
        return null;
      }

      return {
        _id: id,
        name: String(row.name ?? 'Category'),
        slug: String(row.slug ?? 'category'),
      };
    })
    .filter((row): row is SeedCategory => row !== null);

  if (mappedExisting.length >= 3) {
    return mappedExisting;
  }

  const needed = 3 - mappedExisting.length;
  const now = new Date();
  const suffix = now.getTime();

  const created: Array<Record<string, unknown>> = [];
  for (let index = 0; index < needed; index += 1) {
    const seq = index + 1;
    const name = `Promo Seed Category ${seq}`;
    created.push({
      _id: new ObjectId(),
      name,
      slug: toSafeSlug(`${name}-${suffix}-${seq}`),
      description: 'Seeded category for promotions testing.',
      createdAt: now,
      updatedAt: now,
    });
  }

  await categories.insertMany(created, { ordered: false });

  return mappedExisting.concat(
    created.map((row) => ({
      _id: row._id as ObjectId,
      name: String(row.name),
      slug: String(row.slug),
    })),
  );
}

async function ensureProducts(
  db: ReturnType<MongoClient['db']>,
  categories: SeedCategory[],
  targetProducts: number,
): Promise<SeedProduct[]> {
  const products = db.collection<Record<string, unknown>>('products');

  const readProducts = async () => {
    const rows = await products
      .find(
        {
          categoryId: { $ne: null },
          status: { $in: ['active', 'ACTIVE'] },
          $or: [
            { 'inventoryInfo.quantity': { $gt: 0 } },
            { inventory: { $gt: 0 } },
          ],
        },
        {
          projection: {
            _id: 1,
            name: 1,
            price: 1,
            costPrice: 1,
            categoryId: 1,
            inventory: 1,
            inventoryInfo: 1,
          },
        },
      )
      .limit(80)
      .toArray();

    return rows
      .map((row) => {
        const id = toObjectId(row._id);
        const categoryId = toObjectId(row.categoryId);
        if (!id || !categoryId) {
          return null;
        }

        const inventoryInfo =
          row.inventoryInfo && typeof row.inventoryInfo === 'object'
            ? (row.inventoryInfo as Record<string, unknown>)
            : {};

        const quantity = toNumber(
          inventoryInfo.quantity,
          toNumber(row.inventory, 0),
        );

        return {
          _id: id,
          name: String(row.name ?? 'Unnamed product'),
          price: toNumber(row.price, 1000),
          costPrice: toNumber(row.costPrice, toNumber(row.price, 1000) * 0.65),
          categoryId,
          quantity,
        };
      })
      .filter((row): row is SeedProduct => row !== null);
  };

  let available = await readProducts();
  if (available.length >= targetProducts) {
    return available;
  }

  const needed = targetProducts - available.length;
  const now = new Date();
  const suffix = now.getTime();

  const created: Array<Record<string, unknown>> = [];
  for (let index = 0; index < needed; index += 1) {
    const seq = index + 1;
    const category = categories[index % categories.length];
    const price = 1100 + ((index % 12) + 1) * 180;
    const quantity = 14 + (index % 9);

    created.push({
      _id: new ObjectId(),
      name: `Promo Seed Product ${seq}`,
      sku: `PROMO-SEED-${suffix}-${seq}`,
      description: 'Seeded product for promotion suggestion testing.',
      price,
      costPrice: Math.max(100, Math.round(price * 0.62)),
      image: '',
      inventory: quantity,
      status: 'active',
      categoryId: category._id,
      inventoryInfo: {
        quantity,
        lowStockThreshold: 5,
        lastAdjustedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  await products.insertMany(created, { ordered: false });
  available = await readProducts();
  return available;
}

async function ensureCompletedOrders(
  db: ReturnType<MongoClient['db']>,
  customers: CustomerUser[],
  products: SeedProduct[],
  primaryUserId: ObjectId,
  targetCompletedOrders: number,
): Promise<CompletedOrder[]> {
  const orders = db.collection<Record<string, unknown>>('orders');

  const readOrders = async () => {
    const rows = await orders
      .find(
        {
          status: { $in: COMPLETED_ORDER_STATUSES },
          items: { $exists: true, $ne: [] },
          userId: { $ne: null },
        },
        {
          projection: { _id: 1, userId: 1, items: 1, createdAt: 1, updatedAt: 1 },
        },
      )
      .sort({ updatedAt: -1 })
      .limit(Math.max(30, targetCompletedOrders * 2))
      .toArray();

    return rows
      .map((row) => {
        const orderId = toObjectId(row._id);
        const userId = toObjectId(row.userId);

        if (!orderId || !userId || !Array.isArray(row.items) || row.items.length === 0) {
          return null;
        }

        const items = row.items
          .map((item): OrderItemDoc | null => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const entry = item as Record<string, unknown>;
            const productId = toObjectId(entry.productId);
            if (!productId) {
              return null;
            }

            return {
              productId,
              name: String(entry.name ?? 'Unknown item'),
              quantity: Math.max(1, Math.floor(toNumber(entry.quantity, 1))),
              unitPrice: Math.max(1, toNumber(entry.unitPrice, 1000)),
              unitCost: Math.max(0, toNumber(entry.unitCost, 0)),
            };
          })
          .filter((item): item is OrderItemDoc => item !== null);

        if (items.length === 0) {
          return null;
        }

        const fallbackDate = new Date();

        return {
          _id: orderId,
          userId,
          items,
          createdAt: toDate(row.createdAt, fallbackDate),
          updatedAt: toDate(row.updatedAt, fallbackDate),
        };
      })
      .filter((order): order is CompletedOrder => order !== null);
  };

  let completed = await readOrders();

  if (completed.length >= targetCompletedOrders) {
    return completed;
  }

  const needed = targetCompletedOrders - completed.length;
  const now = new Date();
  const createdOrders: Array<Record<string, unknown>> = [];

  for (let index = 0; index < needed; index += 1) {
    const orderId = new ObjectId();
    const user =
      index < 4
        ? customers[0]
        : customers[(index + 1) % customers.length];

    const productA = products[index % products.length];
    const productB = products[(index + 5) % products.length];

    const quantityA = 1 + (index % 3);
    const quantityB = index % 2 === 0 ? 1 : 0;

    const items: OrderItemDoc[] = [
      {
        productId: productA._id,
        name: productA.name,
        quantity: quantityA,
        unitPrice: Math.max(1, Math.round(productA.price)),
        unitCost: Math.max(0, Math.round(productA.costPrice)),
      },
    ];

    if (quantityB > 0) {
      items.push({
        productId: productB._id,
        name: productB.name,
        quantity: quantityB,
        unitPrice: Math.max(1, Math.round(productB.price)),
        unitCost: Math.max(0, Math.round(productB.costPrice)),
      });
    }

    const totalAmount = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );

    const createdAt = new Date(now.getTime() - (index + 2) * 6 * 60 * 60 * 1000);
    const updatedAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);

    createdOrders.push({
      _id: orderId,
      userId: index < 3 ? primaryUserId : user._id,
      status: index % 2 === 0 ? 'DELIVERED' : 'SETTLED',
      totalAmount,
      shippingAddress: null,
      trackingNumber: null,
      carrier: null,
      erpReference: null,
      deliveryCode: null,
      erpSyncStatus: 'SYNCED',
      erpSyncAttempts: 0,
      erpLastSyncError: null,
      erpLastSyncedAt: updatedAt,
      items,
      statusHistory: [
        {
          status: 'DRAFT',
          note: 'Seeded draft order.',
          changedBy: null,
          createdAt,
        },
        {
          status: 'DELIVERED',
          note: 'Seeded completed order for promotion testing.',
          changedBy: null,
          createdAt: updatedAt,
        },
      ],
      createdAt,
      updatedAt,
    });
  }

  if (createdOrders.length > 0) {
    await orders.insertMany(createdOrders, { ordered: false });
  }

  completed = await readOrders();
  return completed;
}

async function seedPromotionsData() {
  const options = resolveSeedOptions(process.argv.slice(2));

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not configured in .env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db();

    const customers = await ensureCustomers(db);
    if (customers.length === 0) {
      throw new Error('No customer users are available for promotions seeding.');
    }

    const categories = await ensureCategories(db);
  const products = await ensureProducts(db, categories, options.targetProducts);

    if (products.length < 6) {
      throw new Error(
        'Not enough products with stock and category to seed promotion suggestions.',
      );
    }

    const profileUsers = customers.slice(
      0,
      Math.min(customers.length, options.mode === 'stress' ? 8 : 4),
    );
    const primaryUser = profileUsers[0] ?? customers[0];
    const topCategoryIds = getTopCategoryIds(products);

    if (topCategoryIds.length === 0) {
      throw new Error('Could not derive category affinities from available products.');
    }

    const primaryTopCategoryIds = rotateArray(topCategoryIds, 0).slice(
      0,
      Math.min(3, topCategoryIds.length),
    );
    const trackingCount = Math.max(options.trackedProducts, 8);
    const primaryProductsForTracking = pickProductsForUser(
      products,
      primaryTopCategoryIds,
      trackingCount,
      0,
    );
    const sortedTopPrices = primaryProductsForTracking
      .map((product) => product.price)
      .sort((a, b) => a - b);
    const preferredMin = sortedTopPrices[0] ?? 500;
    const preferredMax = sortedTopPrices[sortedTopPrices.length - 1] ?? preferredMin;

    const userProfiles = db.collection<Record<string, unknown>>('user_profiles');
    const userEvents = db.collection<Record<string, unknown>>('user_events');
    const conversions = db.collection<Record<string, unknown>>('promotion_conversions');
    const promotionConfigs = db.collection<Record<string, unknown>>('promotion_configs');

    const now = new Date();

    const sessionRegex = new RegExp(`^${SESSION_PREFIX}-`);
    await userEvents.deleteMany({ sessionId: { $regex: sessionRegex } });
    await conversions.deleteMany({ sessionId: { $regex: sessionRegex } });

    const seededEvents: Array<Record<string, unknown>> = [];
    const profileUpserts = profileUsers.map((user, index) => {
      const rotatedCategories = rotateArray(topCategoryIds, index);
      const userTopCategoryIds = rotatedCategories.slice(0, Math.min(3, rotatedCategories.length));
      const affinityScores = buildAffinityScores(userTopCategoryIds.length);
      const userProductsForTracking = pickProductsForUser(
        products,
        userTopCategoryIds,
        trackingCount,
        index * 3,
      );
      const userPrices = userProductsForTracking.map((product) => product.price).sort((a, b) => a - b);
      const userPreferredMin = userPrices[0] ?? preferredMin;
      const userPreferredMax = userPrices[userPrices.length - 1] ?? userPreferredMin;
      const lastActiveAt = new Date(now.getTime() - (index + 1) * 25 * 60 * 1000);

      userTopCategoryIds.forEach((categoryId, catIndex) => {
        const eventBase = now.getTime() - (catIndex + 1 + index) * 2 * 60 * 60 * 1000;

        seededEvents.push(
          {
            _id: new ObjectId(),
            userId: user._id,
            sessionId: sessionId(`user-${user._id.toHexString()}-cat-${catIndex + 1}`),
            eventType: 'VIEW_CATEGORY',
            entityId: categoryId,
            entityType: 'CATEGORY',
            metadata: { seeded: true },
            createdAt: new Date(eventBase),
          },
          {
            _id: new ObjectId(),
            userId: user._id,
            sessionId: sessionId(`user-${user._id.toHexString()}-cat-${catIndex + 1}`),
            eventType: 'ADD_TO_CART',
            entityId: categoryId,
            entityType: 'CATEGORY',
            metadata: { seeded: true },
            createdAt: new Date(eventBase + 20 * 60 * 1000),
          },
        );
      });

      userProductsForTracking.forEach((product, productIndex) => {
        const eventBase = now.getTime() - (productIndex + 1 + index) * 40 * 60 * 1000;
        const source = productIndex % 2 === 0 ? 'personalized' : 'popular';

        seededEvents.push(
          {
            _id: new ObjectId(),
            userId: user._id,
            sessionId: sessionId(`track-${user._id.toHexString()}-${productIndex + 1}`),
            eventType: 'VIEW_PRODUCT',
            entityId: product._id,
            entityType: 'PRODUCT',
            metadata: {
              promotionImpression: true,
              position: productIndex,
              source,
              seeded: true,
            },
            createdAt: new Date(eventBase),
          },
          {
            _id: new ObjectId(),
            userId: user._id,
            sessionId: sessionId(`track-${user._id.toHexString()}-${productIndex + 1}`),
            eventType: 'VIEW_PRODUCT',
            entityId: product._id,
            entityType: 'PRODUCT',
            metadata: {
              promotionClick: true,
              position: productIndex,
              source,
              seeded: true,
            },
            createdAt: new Date(eventBase + 10 * 60 * 1000),
          },
        );
      });

      return {
        updateOne: {
          filter: { userId: user._id },
          update: {
            $set: {
              userId: user._id,
              categoryAffinities: userTopCategoryIds.map((categoryId, catIndex) => ({
                categoryId,
                score: affinityScores[catIndex] ?? 0,
                eventCount: 12 - catIndex * 2,
              })),
              topCategoryIds: userTopCategoryIds.slice(0, 3),
              purchaseFrequency: 2 + (index % 4),
              avgOrderValue: Number((userPreferredMax * (1.1 + (index % 3) * 0.15)).toFixed(2)),
              preferredPriceRange: {
                min: userPreferredMin,
                max: Math.max(userPreferredMin, userPreferredMax),
              },
              totalOrders: 4 + index * 2,
              lastActiveAt,
              isNewUser: false,
              recomputedAt: now,
            },
          },
          upsert: true,
        },
      };
    });

    if (profileUpserts.length > 0) {
      await userProfiles.bulkWrite(profileUpserts, { ordered: false });
    }

    if (seededEvents.length > 0) {
      await userEvents.insertMany(seededEvents, { ordered: false });
    }

    const completedOrders = await ensureCompletedOrders(
      db,
      customers,
      products,
      primaryUser._id,
      options.targetCompletedOrders,
    );

    if (completedOrders.length === 0) {
      throw new Error('Could not find or create completed orders for conversion seeding.');
    }

    const seededConversions: Array<Record<string, unknown>> = [];
    const convertedTarget = Math.min(
      options.convertedConversions,
      completedOrders.length,
    );

    completedOrders.slice(0, convertedTarget).forEach((order, index) => {
      const firstItem = order.items[0];
      if (!firstItem) {
        return;
      }

      const impressedAt = new Date(now.getTime() - (index + 1) * 55 * 60 * 1000);
      const clickedAt = new Date(impressedAt.getTime() + 10 * 60 * 1000);
      const orderedAt = new Date(impressedAt.getTime() + 35 * 60 * 1000);
      const sources = ['personalized', 'popular', 'fallback'];

      seededConversions.push({
        _id: new ObjectId(),
        userId: order.userId,
        productId: firstItem.productId,
        sessionId: sessionId(`conv-${index + 1}`),
        impressedAt,
        clickedAt,
        orderId: order._id,
        orderedAt,
        source: sources[index % sources.length],
        position: index % 6,
        isAdminForced: false,
        converted: true,
        createdAt: impressedAt,
        updatedAt: orderedAt,
      });
    });

    for (let index = 0; index < options.openConversions; index += 1) {
      const customer = customers[index % customers.length];
      const product = products[index % products.length];
      const impressedAt = new Date(now.getTime() - (index + 1) * 35 * 60 * 1000);
      const clicked = index % 3 !== 0;
      const sources = ['personalized', 'popular', 'fallback'];

      seededConversions.push({
        _id: new ObjectId(),
        userId: customer._id,
        productId: product._id,
        sessionId: sessionId(`open-${index + 1}`),
        impressedAt,
        clickedAt: clicked ? new Date(impressedAt.getTime() + 12 * 60 * 1000) : null,
        orderId: null,
        orderedAt: null,
        source: sources[index % sources.length],
        position: index % 6,
        isAdminForced: false,
        converted: false,
        createdAt: impressedAt,
        updatedAt: impressedAt,
      });
    }

    const adminForcedProduct = primaryProductsForTracking[0] ?? products[0];
    if (adminForcedProduct) {
      const adminImpressedAt = new Date(now.getTime() - 25 * 60 * 1000);

      seededConversions.push({
        _id: new ObjectId(),
        userId: primaryUser._id,
        productId: adminForcedProduct._id,
        sessionId: sessionId('admin-forced-1'),
        impressedAt: adminImpressedAt,
        clickedAt: new Date(adminImpressedAt.getTime() + 5 * 60 * 1000),
        orderId: null,
        orderedAt: null,
        source: 'popular',
        position: 0,
        isAdminForced: true,
        converted: false,
        createdAt: adminImpressedAt,
        updatedAt: adminImpressedAt,
      });
    }

    if (seededConversions.length > 0) {
      await conversions.insertMany(seededConversions, { ordered: false });
    }

    await promotionConfigs.updateOne(
      { configKey: 'default' },
      {
        $set: {
          configKey: 'default',
          suppressedProductIds: [],
          forcedProductIds: adminForcedProduct ? [adminForcedProduct._id] : [],
          maxRecommendations: 10,
          diversityLimit: 2,
          enabled: true,
          abTestSplitPercent: 0,
          updatedBy: null,
        },
      },
      { upsert: true },
    );

    console.log('Promotion suggestion seed completed successfully.');
    console.log('Seed mode:', options.mode);
    console.log('Primary preview user:', primaryUser.email, `(${primaryUser._id.toHexString()})`);
    console.log('Seed summary:', {
      options,
      customers: customers.length,
      categories: categories.length,
      products: products.length,
      topCategoryIds: primaryTopCategoryIds.map((id) => id.toHexString()),
      trackedProducts: primaryProductsForTracking.length,
      userEventsInserted: seededEvents.length,
      promotionConversionsInserted: seededConversions.length,
      completedOrdersAvailable: completedOrders.length,
      forcedProductId: adminForcedProduct?._id.toHexString() ?? null,
    });
  } finally {
    await client.close();
  }
}

seedPromotionsData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Promotion suggestion seed failed:', error);
    process.exit(1);
  });
