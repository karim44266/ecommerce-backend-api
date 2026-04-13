import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Collection, Db, MongoClient, ObjectId } from 'mongodb';
import * as path from 'path';
import {
  HARDWARE_CATEGORIES,
  HARDWARE_PRODUCT_BLUEPRINTS,
  ProductBlueprint,
} from './database/seeding/hardware-catalog';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

type SeedOrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'IN_PREPARATION'
  | 'DELIVERED'
  | 'SETTLED'
  | 'CANCELLED';

type ShipmentStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED';

type SeedScenario =
  | 'balanced'
  | 'revenue-growth'
  | 'repeat-buyers'
  | 'stock-pressure'
  | 'acquisition-spike';

interface SeedOptions {
  reset: boolean;
  dryRun: boolean;
  force: boolean;
  scenario: SeedScenario;
  seed: string;
  categoryCount: number;
  productCount: number;
  customerCount: number;
  staffCount: number;
  orderCount: number;
  daysBack: number;
}

interface ScenarioPreset {
  productCount: number;
  customerCount: number;
  orderCount: number;
  daysBack: number;
  summary: string;
}

interface SeedUser {
  _id: ObjectId;
  email: string;
  name: string;
  roles: string[];
  status: string;
  availabilityStatus: string;
  passwordHash: string;
  mfaEnabled: boolean;
  mfaOtpHash: string | null;
  mfaOtpExpiresAt: Date | null;
  refreshTokenHash: string | null;
  refreshTokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SeedCategory {
  _id: ObjectId;
  name: string;
  slug: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SeedProduct {
  _id: ObjectId;
  name: string;
  sku: string;
  description: string;
  price: number;
  costPrice: number;
  image: string;
  inventory: number;
  status: string;
  categoryId: ObjectId;
  inventoryInfo: {
    quantity: number;
    lowStockThreshold: number;
    lastAdjustedAt: Date | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface ProductSeedMeta {
  doc: SeedProduct;
  demandWeight: number;
  baseCost: number;
}

interface SeedOrderItem {
  productId: ObjectId;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
}

interface SeedOrderStatusEntry {
  status: string;
  note: string | null;
  changedBy: ObjectId | null;
  createdAt: Date;
}

interface SeedOrder {
  _id: ObjectId;
  userId: ObjectId;
  status: SeedOrderStatus;
  totalAmount: number;
  shippingAddress: {
    fullName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    clientPhone: string;
    clientEmail: string;
  };
  trackingNumber: string | null;
  carrier: string | null;
  erpReference: string | null;
  deliveryCode: string | null;
  erpSyncStatus: 'NOT_SYNCED' | 'PENDING' | 'SYNCED' | 'FAILED';
  erpSyncAttempts: number;
  erpLastSyncError: string | null;
  erpLastSyncedAt: Date | null;
  items: SeedOrderItem[];
  statusHistory: SeedOrderStatusEntry[];
  createdAt: Date;
  updatedAt: Date;
}

interface SeedShipment {
  _id: ObjectId;
  orderId: ObjectId;
  staffUserId: ObjectId;
  status: ShipmentStatus;
  trackingNumber: string | null;
  assignedAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SeedInventoryAdjustment {
  _id: ObjectId;
  productId: ObjectId;
  adjustment: number;
  reason: string | null;
  purchasePrice: number | null;
  previousCostPrice: number | null;
  newCostPrice: number | null;
  adjustedBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SeedCollections {
  users: Collection<SeedUser>;
  categories: Collection<SeedCategory>;
  products: Collection<SeedProduct>;
  orders: Collection<SeedOrder>;
  shipments: Collection<SeedShipment>;
  inventoryAdjustments: Collection<SeedInventoryAdjustment>;
  payments: Collection<Record<string, unknown>>;
  erpSyncJobs: Collection<Record<string, unknown>>;
}

interface SeedSummary {
  categories: number;
  products: number;
  users: number;
  customers: number;
  staff: number;
  orders: number;
  shipments: number;
  inventoryAdjustments: number;
  orderStatusBreakdown: Record<string, number>;
  lowStockProducts: number;
  outOfStockProducts: number;
  deliveredRevenue: number;
  deliveredProfit: number;
}

const ORDER_STATUS_PATHS: Record<
  Exclude<SeedOrderStatus, 'CANCELLED'>,
  SeedOrderStatus[]
> = {
  DRAFT: ['DRAFT'],
  CONFIRMED: ['DRAFT', 'CONFIRMED'],
  IN_PREPARATION: ['DRAFT', 'CONFIRMED', 'IN_PREPARATION'],
  DELIVERED: ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'DELIVERED'],
  SETTLED: ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'DELIVERED', 'SETTLED'],
};

const CARRIERS = ['UPS', 'FedEx', 'DHL', 'Aramex', 'Post'];

const STATES = [
  'California',
  'Texas',
  'Florida',
  'New York',
  'Illinois',
  'Arizona',
  'Colorado',
  'Ohio',
  'Georgia',
  'Nevada',
];

const CITIES = [
  'Los Angeles',
  'Houston',
  'Miami',
  'Chicago',
  'Phoenix',
  'Denver',
  'Dallas',
  'Austin',
  'Orlando',
  'Atlanta',
  'San Diego',
  'Columbus',
];

const STREET_NAMES = [
  'Maple Ave',
  'Industrial Rd',
  'Market St',
  'Oak Street',
  'Cedar Lane',
  'Warehouse Blvd',
  'Pioneer Way',
  'Liberty Road',
  'Union Street',
  'Main Street',
  'Sunset Drive',
  'Builders Court',
];

const FIRST_NAMES = [
  'James',
  'Olivia',
  'Noah',
  'Emma',
  'Liam',
  'Sophia',
  'Lucas',
  'Amelia',
  'Ethan',
  'Ava',
  'Mason',
  'Mia',
  'Logan',
  'Ella',
  'Benjamin',
  'Harper',
  'Daniel',
  'Nora',
  'Michael',
  'Layla',
];

const LAST_NAMES = [
  'Johnson',
  'Smith',
  'Martinez',
  'Anderson',
  'Brown',
  'Garcia',
  'Davis',
  'Wilson',
  'Taylor',
  'Clark',
  'Lopez',
  'Hall',
  'Allen',
  'Wright',
  'Young',
  'Scott',
  'Green',
  'Baker',
  'Adams',
  'Nelson',
];

const CANCELLATION_REASONS = [
  'Customer requested cancellation',
  'Address validation failed before dispatch',
  'Payment verification timeout',
  'Duplicate order merged with existing purchase',
];

const DEFAULTS = {
  categoryCount: 8,
  productCount: 38,
  customerCount: 64,
  staffCount: 6,
  orderCount: 140,
  daysBack: 75,
  seed: 'hardware-shop-kpi-v2',
};

const SCENARIO_PRESETS: Record<SeedScenario, ScenarioPreset> = {
  balanced: {
    productCount: 38,
    customerCount: 64,
    orderCount: 140,
    daysBack: 75,
    summary: 'Balanced baseline for broad KPI validation.',
  },
  'revenue-growth': {
    productCount: 44,
    customerCount: 82,
    orderCount: 195,
    daysBack: 90,
    summary: 'High throughput profile with stronger delivered revenue trend.',
  },
  'repeat-buyers': {
    productCount: 32,
    customerCount: 48,
    orderCount: 180,
    daysBack: 90,
    summary: 'Higher order frequency per customer for retention KPIs.',
  },
  'stock-pressure': {
    productCount: 24,
    customerCount: 40,
    orderCount: 185,
    daysBack: 45,
    summary: 'Demand concentration that increases low-stock and stockout pressure.',
  },
  'acquisition-spike': {
    productCount: 46,
    customerCount: 100,
    orderCount: 110,
    daysBack: 60,
    summary: 'Large customer influx with lower conversion intensity.',
  },
};

const SCENARIO_ALIASES: Record<string, SeedScenario> = {
  default: 'balanced',
  balanced: 'balanced',
  'revenue-growth': 'revenue-growth',
  revenue: 'revenue-growth',
  growth: 'revenue-growth',
  'repeat-buyers': 'repeat-buyers',
  repeat: 'repeat-buyers',
  retention: 'repeat-buyers',
  'stock-pressure': 'stock-pressure',
  stock: 'stock-pressure',
  'acquisition-spike': 'acquisition-spike',
  acquisition: 'acquisition-spike',
  funnel: 'acquisition-spike',
};

function parseScenario(value: string | undefined): SeedScenario {
  const normalized = (value ?? 'balanced').toLowerCase().trim();
  const scenario = SCENARIO_ALIASES[normalized];

  if (!scenario) {
    const supported = Object.keys(SCENARIO_PRESETS).join(', ');
    throw new Error(
      `Unknown seed scenario "${value}". Supported scenarios: ${supported}.`,
    );
  }

  return scenario;
}

function parseArgs(argv: string[]): SeedOptions {
  const readArg = (prefix: string): string | undefined => {
    const entry = argv.find((arg) => arg.startsWith(`${prefix}=`));
    return entry ? entry.slice(prefix.length + 1) : undefined;
  };

  const toBoolean = (value: string | undefined, fallback: boolean) => {
    if (!value) return fallback;
    const lowered = value.toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(lowered);
  };

  const toInt = (
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const reset = argv.includes('--no-reset')
    ? false
    : argv.includes('--reset')
      ? true
      : toBoolean(process.env.SEED_RESET, true);

  const dryRun = argv.includes('--dry-run')
    ? true
    : toBoolean(process.env.SEED_DRY_RUN, false);

  const force = argv.includes('--force')
    ? true
    : toBoolean(process.env.SEED_FORCE, false);

  const scenario = parseScenario(
    readArg('--scenario') ?? process.env.SEED_SCENARIO ?? 'balanced',
  );
  const preset = SCENARIO_PRESETS[scenario];

  const categoryCount = toInt(
    readArg('--categories') ?? process.env.SEED_CATEGORY_COUNT,
    DEFAULTS.categoryCount,
    5,
    10,
  );

  const productCount = toInt(
    readArg('--products') ?? process.env.SEED_PRODUCT_COUNT,
    preset.productCount,
    20,
    50,
  );

  const customerCount = toInt(
    readArg('--customers') ?? process.env.SEED_CUSTOMER_COUNT,
    preset.customerCount,
    30,
    100,
  );

  const staffCount = toInt(
    readArg('--staff') ?? process.env.SEED_STAFF_COUNT,
    DEFAULTS.staffCount,
    3,
    12,
  );

  const orderCount = toInt(
    readArg('--orders') ?? process.env.SEED_ORDER_COUNT,
    preset.orderCount,
    50,
    200,
  );

  const daysBack = toInt(
    readArg('--days') ?? process.env.SEED_DAYS_BACK,
    preset.daysBack,
    30,
    90,
  );

  const seed =
    readArg('--seed') ?? process.env.SEED_RANDOM_SEED ?? DEFAULTS.seed;

  return {
    reset,
    dryRun,
    force,
    scenario,
    seed,
    categoryCount,
    productCount,
    customerCount,
    staffCount,
    orderCount,
    daysBack,
  };
}

function resolveDatabaseName(uri: string): string {
  try {
    const parsed = new URL(uri);
    const pathname = parsed.pathname.replace(/^\//, '').trim();
    return pathname || 'ecommerce';
  } catch {
    const dbMatch = uri.match(/\/([^/?]+)(\?|$)/);
    return dbMatch ? dbMatch[1] : 'ecommerce';
  }
}

function assertSafeEnvironment(dbName: string, options: SeedOptions) {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const looksProd = /prod/i.test(dbName) || nodeEnv === 'production';

  if (looksProd && !options.force) {
    throw new Error(
      `Refusing to seed database "${dbName}" in ${nodeEnv} mode without --force or SEED_FORCE=true.`,
    );
  }
}

function xmur3(seed: string) {
  let h = 1_779_033_703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3_432_918_353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2_246_822_507);
    h = Math.imul(h ^ (h >>> 13), 3_266_489_909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createRng(seedText: string) {
  const seedGenerator = xmur3(seedText);
  return mulberry32(seedGenerator());
}

function randomFloat(rng: () => number, min: number, max: number) {
  return min + (max - min) * rng();
}

function randomInt(rng: () => number, min: number, max: number) {
  return Math.floor(randomFloat(rng, min, max + 1));
}

function chance(rng: () => number, probability: number) {
  return rng() < probability;
}

function weightedPick<T>(
  rng: () => number,
  items: T[],
  weightFn: (item: T) => number,
): T {
  const safe = items.filter((item) => weightFn(item) > 0);
  if (safe.length === 0) {
    throw new Error('weightedPick requires at least one positive-weight item');
  }

  const total = safe.reduce((sum, item) => sum + weightFn(item), 0);
  let threshold = rng() * total;

  for (const item of safe) {
    threshold -= weightFn(item);
    if (threshold <= 0) return item;
  }

  return safe[safe.length - 1];
}

function pickUniqueWeighted<T>(
  rng: () => number,
  items: T[],
  count: number,
  weightFn: (item: T) => number,
): T[] {
  if (count >= items.length) return [...items];

  const source = [...items];
  const picked: T[] = [];

  while (picked.length < count && source.length > 0) {
    const next = weightedPick(rng, source, weightFn);
    picked.push(next);
    const idx = source.indexOf(next);
    source.splice(idx, 1);
  }

  return picked;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function startOfDay(value: Date): Date {
  const out = new Date(value);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(value: Date, days: number): Date {
  const out = new Date(value);
  out.setDate(out.getDate() + days);
  return out;
}

function addHours(value: Date, hours: number): Date {
  const out = new Date(value);
  out.setTime(out.getTime() + hours * 60 * 60 * 1000);
  return out;
}

function normalizeEmail(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.@_+-]/g, '')
    .replace(/\.{2,}/g, '.');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function gaussianWeight(x: number, center: number, sigma: number): number {
  const exponent = -((x - center) ** 2) / (2 * sigma * sigma);
  return Math.exp(exponent);
}

function getCollections(db: Db): SeedCollections {
  return {
    users: db.collection<SeedUser>('users'),
    categories: db.collection<SeedCategory>('categories'),
    products: db.collection<SeedProduct>('products'),
    orders: db.collection<SeedOrder>('orders'),
    shipments: db.collection<SeedShipment>('shipments'),
    inventoryAdjustments:
      db.collection<SeedInventoryAdjustment>('inventory_adjustments'),
    payments: db.collection<Record<string, unknown>>('payments'),
    erpSyncJobs: db.collection<Record<string, unknown>>('erp_sync_jobs'),
  };
}

async function resetCollections(collections: SeedCollections) {
  await collections.inventoryAdjustments.deleteMany({});
  await collections.shipments.deleteMany({});
  await collections.payments.deleteMany({});
  await collections.erpSyncJobs.deleteMany({});
  await collections.orders.deleteMany({});
  await collections.products.deleteMany({});
  await collections.categories.deleteMany({});
  await collections.users.deleteMany({});
}

function buildUsers(
  options: SeedOptions,
  rng: () => number,
  adminPasswordHash: string,
  staffPasswordHash: string,
  clientPasswordHash: string,
) {
  const now = new Date();
  const adminEmail = normalizeEmail(
    process.env.ADMIN_EMAIL ?? 'admin@probuild.local',
  );

  const adminUser: SeedUser = {
    _id: new ObjectId(),
    email: adminEmail,
    name: 'System Admin',
    roles: ['ADMIN'],
    status: 'active',
    availabilityStatus: 'UNAVAILABLE',
    passwordHash: adminPasswordHash,
    mfaEnabled: false,
    mfaOtpHash: null,
    mfaOtpExpiresAt: null,
    refreshTokenHash: null,
    refreshTokenExpiresAt: null,
    createdAt: addDays(now, -randomInt(rng, 320, 540)),
    updatedAt: addDays(now, -randomInt(rng, 7, 30)),
  };

  const staff: SeedUser[] = [];
  for (let i = 0; i < options.staffCount; i += 1) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const email = normalizeEmail(
      `${first}.${last}.${i + 1}@probuild-staff.local`,
    );
    const createdAt = addDays(now, -randomInt(rng, 120, 480));

    staff.push({
      _id: new ObjectId(),
      email,
      name: `${first} ${last}`,
      roles: ['STAFF'],
      status: 'active',
      availabilityStatus: chance(rng, 0.72) ? 'AVAILABLE' : 'UNAVAILABLE',
      passwordHash: staffPasswordHash,
      mfaEnabled: false,
      mfaOtpHash: null,
      mfaOtpExpiresAt: null,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
      createdAt,
      updatedAt: addDays(createdAt, randomInt(rng, 5, 180)),
    });
  }

  const customers: SeedUser[] = [];
  for (let i = 0; i < options.customerCount; i += 1) {
    const first = weightedPick(rng, FIRST_NAMES, () => 1);
    const last = weightedPick(rng, LAST_NAMES, () => 1);
    const createdAt = addDays(now, -randomInt(rng, 45, 600));
    const accountStatus = chance(rng, 0.09) ? 'blocked' : 'active';
    const email = normalizeEmail(
      `${first}.${last}.${i + 1}@probuild-client.local`,
    );

    customers.push({
      _id: new ObjectId(),
      email,
      name: `${first} ${last}`,
      roles: ['CUSTOMER'],
      status: accountStatus,
      availabilityStatus: 'UNAVAILABLE',
      passwordHash: clientPasswordHash,
      mfaEnabled: false,
      mfaOtpHash: null,
      mfaOtpExpiresAt: null,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
      createdAt,
      updatedAt: addDays(createdAt, randomInt(rng, 3, 260)),
    });
  }

  return {
    users: [adminUser, ...staff, ...customers],
    adminUser,
    staffUsers: staff,
    customerUsers: customers,
  };
}

function buildCategories(options: SeedOptions, rng: () => number): SeedCategory[] {
  const now = new Date();
  const selected =
    options.categoryCount >= HARDWARE_CATEGORIES.length
      ? [...HARDWARE_CATEGORIES]
      : pickUniqueWeighted(
          rng,
          HARDWARE_CATEGORIES,
          options.categoryCount,
          () => 1,
        );

  return selected.map((category, index) => {
    const createdAt = addDays(now, -randomInt(rng, 220, 620));

    return {
      _id: new ObjectId(),
      name: category.name,
      slug: category.slug,
      description: category.description,
      createdAt,
      updatedAt: addDays(createdAt, randomInt(rng, 10, 180 + index * 2)),
    };
  });
}

function pickProductBlueprints(
  options: SeedOptions,
  categories: SeedCategory[],
  rng: () => number,
) {
  const categorySlugs = new Set(categories.map((category) => category.slug));
  const candidates = HARDWARE_PRODUCT_BLUEPRINTS.filter((blueprint) =>
    categorySlugs.has(blueprint.categorySlug),
  );

  const target = Math.min(options.productCount, candidates.length);

  if (target >= candidates.length) {
    return candidates;
  }

  const byCategory = new Map<string, ProductBlueprint[]>();
  for (const blueprint of candidates) {
    const arr = byCategory.get(blueprint.categorySlug) ?? [];
    arr.push(blueprint);
    byCategory.set(blueprint.categorySlug, arr);
  }

  const initial: ProductBlueprint[] = [];
  for (const slug of categorySlugs) {
    const optionsForCategory = byCategory.get(slug) ?? [];
    if (optionsForCategory.length === 0) continue;
    initial.push(weightedPick(rng, optionsForCategory, (item) => item.demandWeight));
  }

  const dedupedInitial = Array.from(new Set(initial));
  const remaining = candidates.filter((item) => !dedupedInitial.includes(item));

  if (dedupedInitial.length >= target) {
    return dedupedInitial.slice(0, target);
  }

  return [
    ...dedupedInitial,
    ...pickUniqueWeighted(
      rng,
      remaining,
      target - dedupedInitial.length,
      (item) => item.demandWeight,
    ),
  ];
}

function buildProducts(
  options: SeedOptions,
  categories: SeedCategory[],
  rng: () => number,
): ProductSeedMeta[] {
  const now = new Date();
  const categoryIdBySlug = new Map(categories.map((category) => [category.slug, category._id]));
  const blueprints = pickProductBlueprints(options, categories, rng);
  const skuCounters = new Map<string, number>();

  return blueprints
    .sort((a, b) => a.categorySlug.localeCompare(b.categorySlug) || a.name.localeCompare(b.name))
    .map((blueprint) => {
      const cost = roundMoney(
        randomFloat(rng, blueprint.costRange[0], blueprint.costRange[1]),
      );
      const margin = randomFloat(
        rng,
        blueprint.marginRange[0],
        blueprint.marginRange[1],
      );
      const price = roundMoney(cost / (1 - margin));
      const threshold = randomInt(
        rng,
        blueprint.lowStockThresholdRange[0],
        blueprint.lowStockThresholdRange[1],
      );

      const nextSku = (skuCounters.get(blueprint.skuPrefix) ?? 0) + 1;
      skuCounters.set(blueprint.skuPrefix, nextSku);

      const createdAt = addDays(now, -randomInt(rng, 160, 560));

      return {
        demandWeight: blueprint.demandWeight,
        baseCost: cost,
        doc: {
          _id: new ObjectId(),
          name: blueprint.name,
          sku: `${blueprint.skuPrefix}-${String(nextSku).padStart(4, '0')}`,
          description: `${blueprint.name} - contractor-grade hardware item.`,
          price,
          costPrice: cost,
          image: '',
          inventory: 0,
          status: 'active',
          categoryId:
            categoryIdBySlug.get(blueprint.categorySlug) ?? categories[0]._id,
          inventoryInfo: {
            quantity: 0,
            lowStockThreshold: threshold,
            lastAdjustedAt: null,
          },
          createdAt,
          updatedAt: addDays(createdAt, randomInt(rng, 4, 210)),
        },
      };
    });
}

function buildDailyDemandWeights(daysBack: number, now: Date) {
  const start = startOfDay(addDays(now, -(daysBack - 1)));
  const rows: Array<{ day: Date; weight: number }> = [];

  for (let i = 0; i < daysBack; i += 1) {
    const day = addDays(start, i);
    const dayOfWeek = day.getDay();

    const weekdayWeight = [1.22, 0.88, 0.94, 1.0, 1.05, 1.17, 1.2][dayOfWeek];
    const recencyWeight = 0.82 + 0.72 * (i / Math.max(daysBack - 1, 1));
    const campaignPeakA = 0.9 * gaussianWeight(i, daysBack * 0.36, daysBack * 0.1);
    const campaignPeakB = 1.15 * gaussianWeight(i, daysBack * 0.79, daysBack * 0.08);

    rows.push({
      day,
      weight: weekdayWeight * (recencyWeight + campaignPeakA + campaignPeakB),
    });
  }

  return rows;
}

function pickOrderStatus(ageDays: number, rng: () => number): SeedOrderStatus {
  if (ageDays > 45) {
    return weightedPick(
      rng,
      ['SETTLED', 'DELIVERED', 'CANCELLED', 'IN_PREPARATION', 'CONFIRMED'],
      (status) => ({
        SETTLED: 0.53,
        DELIVERED: 0.26,
        CANCELLED: 0.13,
        IN_PREPARATION: 0.05,
        CONFIRMED: 0.03,
      })[status],
    ) as SeedOrderStatus;
  }

  if (ageDays > 20) {
    return weightedPick(
      rng,
      ['DELIVERED', 'IN_PREPARATION', 'CONFIRMED', 'SETTLED', 'CANCELLED', 'DRAFT'],
      (status) => ({
        DELIVERED: 0.39,
        IN_PREPARATION: 0.2,
        CONFIRMED: 0.17,
        SETTLED: 0.13,
        CANCELLED: 0.07,
        DRAFT: 0.04,
      })[status],
    ) as SeedOrderStatus;
  }

  return weightedPick(
    rng,
    ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'DELIVERED', 'SETTLED', 'CANCELLED'],
    (status) => ({
      DRAFT: 0.22,
      CONFIRMED: 0.3,
      IN_PREPARATION: 0.25,
      DELIVERED: 0.14,
      SETTLED: 0.04,
      CANCELLED: 0.05,
    })[status],
  ) as SeedOrderStatus;
}

function buildOrderStatusHistory(
  finalStatus: SeedOrderStatus,
  createdAt: Date,
  now: Date,
  customerId: ObjectId,
  adminId: ObjectId,
  staffIds: ObjectId[],
  rng: () => number,
): SeedOrderStatusEntry[] {
  const randomStaff = () =>
    staffIds.length > 0
      ? weightedPick(rng, staffIds, () => 1)
      : adminId;

  const history: SeedOrderStatusEntry[] = [];
  let cursor = new Date(createdAt);

  const push = (status: SeedOrderStatus, note: string, changedBy: ObjectId | null) => {
    history.push({
      status,
      note,
      changedBy,
      createdAt: new Date(cursor),
    });
  };

  push('DRAFT', 'Order created by customer', customerId);

  const advance = (minHours: number, maxHours: number) => {
    cursor = addHours(cursor, randomFloat(rng, minHours, maxHours));
    if (cursor > now) {
      cursor = new Date(now.getTime() - randomInt(rng, 5, 50) * 60 * 1000);
    }
  };

  if (finalStatus === 'CANCELLED') {
    const cancelStage = weightedPick(
      rng,
      ['DRAFT', 'CONFIRMED', 'IN_PREPARATION'],
      (stage) => {
        if (stage === 'DRAFT') return 0.45;
        if (stage === 'CONFIRMED') return 0.34;
        return 0.21;
      },
    );

    if (cancelStage === 'CONFIRMED' || cancelStage === 'IN_PREPARATION') {
      advance(2, 16);
      push('CONFIRMED', 'Order confirmed by operations', adminId);
    }
    if (cancelStage === 'IN_PREPARATION') {
      advance(3, 18);
      push('IN_PREPARATION', 'Order moved to preparation queue', randomStaff());
    }

    advance(1, 10);
    push(
      'CANCELLED',
      weightedPick(rng, CANCELLATION_REASONS, () => 1),
      chance(rng, 0.7) ? adminId : customerId,
    );

    return history;
  }

  const path = ORDER_STATUS_PATHS[finalStatus];
  for (let i = 1; i < path.length; i += 1) {
    const step = path[i];
    if (step === 'CONFIRMED') {
      advance(1.5, 14);
      push(step, 'Order confirmed by operations', adminId);
      continue;
    }

    if (step === 'IN_PREPARATION') {
      advance(2, 20);
      push(step, 'Warehouse team started picking and packing', randomStaff());
      continue;
    }

    if (step === 'DELIVERED') {
      advance(8, 72);
      push(step, 'Shipment delivered and code verified', randomStaff());
      continue;
    }

    if (step === 'SETTLED') {
      advance(4, 36);
      push(step, 'Cash collected and settlement completed', adminId);
    }
  }

  return history;
}

function buildShippingAddress(
  customer: SeedUser,
  rng: () => number,
): SeedOrder['shippingAddress'] {
  const city = weightedPick(rng, CITIES, () => 1);
  const state = weightedPick(rng, STATES, () => 1);
  const street = weightedPick(rng, STREET_NAMES, () => 1);

  return {
    fullName: customer.name,
    addressLine1: `${randomInt(rng, 12, 950)} ${street}`,
    addressLine2: chance(rng, 0.3)
      ? `Suite ${randomInt(rng, 2, 30)}`
      : undefined,
    city,
    state,
    postalCode: `${randomInt(rng, 10000, 99999)}`,
    country: 'US',
    clientPhone: `+1-555-${randomInt(rng, 100, 999)}-${randomInt(rng, 1000, 9999)}`,
    clientEmail: customer.email,
  };
}

function buildErpFields(
  status: SeedOrderStatus,
  updatedAt: Date,
  rng: () => number,
) {
  if (status === 'DRAFT' || status === 'CANCELLED') {
    return {
      erpSyncStatus: 'NOT_SYNCED' as const,
      erpSyncAttempts: 0,
      erpLastSyncError: null,
      erpLastSyncedAt: null,
      erpReference: null,
    };
  }

  const syncStatus = weightedPick(
    rng,
    ['SYNCED', 'PENDING', 'FAILED'] as const,
    (value) => ({ SYNCED: 0.73, PENDING: 0.17, FAILED: 0.1 })[value],
  );

  return {
    erpSyncStatus: syncStatus,
    erpSyncAttempts:
      syncStatus === 'SYNCED'
        ? randomInt(rng, 1, 2)
        : syncStatus === 'FAILED'
          ? randomInt(rng, 2, 4)
          : 1,
    erpLastSyncError:
      syncStatus === 'FAILED' ? 'Temporary ERP gateway timeout' : null,
    erpLastSyncedAt:
      syncStatus === 'SYNCED'
        ? addHours(updatedAt, -randomFloat(rng, 0.2, 6))
        : null,
    erpReference:
      syncStatus === 'SYNCED'
        ? `ERP-${updatedAt.getFullYear()}-${randomInt(rng, 100000, 999999)}`
        : null,
  };
}

function buildOrderItems(
  products: ProductSeedMeta[],
  rng: () => number,
): SeedOrderItem[] {
  const lineCount = weightedPick(rng, [2, 3, 4, 5, 6], (value) => {
    if (value === 2) return 0.34;
    if (value === 3) return 0.33;
    if (value === 4) return 0.2;
    if (value === 5) return 0.09;
    return 0.04;
  });

  const pickedProducts = pickUniqueWeighted(
    rng,
    products,
    lineCount,
    (item) => item.demandWeight,
  );

  return pickedProducts.map((productMeta) => {
    const product = productMeta.doc;

    const quantity =
      product.price >= 120
        ? randomInt(rng, 1, 2)
        : product.price >= 50
          ? randomInt(rng, 1, 3)
          : product.price >= 20
            ? randomInt(rng, 1, 5)
            : randomInt(rng, 2, 9);

    return {
      productId: product._id,
      name: product.name,
      quantity,
      unitPrice: toCents(product.price),
      unitCost: toCents(product.costPrice),
    };
  });
}

function buildOrders(
  options: SeedOptions,
  products: ProductSeedMeta[],
  customers: SeedUser[],
  adminUser: SeedUser,
  staffUsers: SeedUser[],
  rng: () => number,
) {
  const now = new Date();
  const dailyDemand = buildDailyDemandWeights(options.daysBack, now);

  const customerWeights = customers.map((customer) => {
    const segmentRoll = rng();
    const segmentWeight =
      segmentRoll < 0.16
        ? randomFloat(rng, 3.1, 5.1)
        : segmentRoll < 0.62
          ? randomFloat(rng, 1.5, 2.8)
          : randomFloat(rng, 0.55, 1.4);

    return {
      customer,
      weight: segmentWeight,
    };
  });

  const staffIds = staffUsers.map((staff) => staff._id);
  const orders: SeedOrder[] = [];
  const reservedByProduct = new Map<string, number>();

  for (let i = 0; i < options.orderCount; i += 1) {
    const day = weightedPick(rng, dailyDemand, (entry) => entry.weight).day;

    const createdAt = new Date(day);
    createdAt.setHours(randomInt(rng, 8, 19), randomInt(rng, 0, 59), randomInt(rng, 0, 59), 0);

    const ageDays = Math.floor(
      (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    const customer = weightedPick(rng, customerWeights, (entry) => entry.weight).customer;
    const status = pickOrderStatus(ageDays, rng);
    const items = buildOrderItems(products, rng);
    const totalAmount = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );

    const statusHistory = buildOrderStatusHistory(
      status,
      createdAt,
      now,
      customer._id,
      adminUser._id,
      staffIds,
      rng,
    );

    const updatedAt = statusHistory[statusHistory.length - 1]?.createdAt ?? createdAt;
    const hasTracking = ['IN_PREPARATION', 'DELIVERED', 'SETTLED'].includes(status);

    const trackingNumber = hasTracking && chance(rng, 0.84)
      ? `TRK-${randomInt(rng, 100000, 999999)}`
      : null;

    const carrier = trackingNumber
      ? weightedPick(rng, CARRIERS, () => 1)
      : null;

    const erpFields = buildErpFields(status, updatedAt, rng);

    const order: SeedOrder = {
      _id: new ObjectId(),
      userId: customer._id,
      status,
      totalAmount,
      shippingAddress: buildShippingAddress(customer, rng),
      trackingNumber,
      carrier,
      erpReference: erpFields.erpReference,
      deliveryCode:
        status === 'CANCELLED' ? null : `${randomInt(rng, 1000, 9999)}`,
      erpSyncStatus: erpFields.erpSyncStatus,
      erpSyncAttempts: erpFields.erpSyncAttempts,
      erpLastSyncError: erpFields.erpLastSyncError,
      erpLastSyncedAt: erpFields.erpLastSyncedAt,
      items,
      statusHistory,
      createdAt,
      updatedAt,
    };

    if (status !== 'CANCELLED') {
      for (const item of items) {
        const key = item.productId.toHexString();
        reservedByProduct.set(key, (reservedByProduct.get(key) ?? 0) + item.quantity);
      }
    }

    orders.push(order);
  }

  return {
    orders,
    reservedByProduct,
  };
}

function buildShipments(
  orders: SeedOrder[],
  staffUsers: SeedUser[],
  rng: () => number,
): SeedShipment[] {
  const now = new Date();
  const availableStaff = staffUsers.filter(
    (staff) => staff.status === 'active' && staff.availabilityStatus === 'AVAILABLE',
  );
  const staffPool = availableStaff.length > 0 ? availableStaff : staffUsers;

  if (staffPool.length === 0) return [];

  const shipments: SeedShipment[] = [];

  for (const order of orders) {
    if (!['CONFIRMED', 'IN_PREPARATION', 'DELIVERED', 'SETTLED'].includes(order.status)) {
      continue;
    }

    const include =
      order.status === 'CONFIRMED'
        ? chance(rng, 0.34)
        : order.status === 'IN_PREPARATION'
          ? chance(rng, 0.82)
          : chance(rng, 0.9);

    if (!include) continue;

    const staff = weightedPick(rng, staffPool, () => 1);

    const inPreparationTimestamp =
      order.statusHistory.find((entry) => entry.status === 'IN_PREPARATION')?.createdAt ??
      order.statusHistory.find((entry) => entry.status === 'CONFIRMED')?.createdAt ??
      addHours(order.createdAt, 4);

    let shipmentStatus: ShipmentStatus;
    if (order.status === 'CONFIRMED') {
      shipmentStatus = 'ASSIGNED';
    } else if (order.status === 'IN_PREPARATION') {
      shipmentStatus = weightedPick(
        rng,
        ['ASSIGNED', 'IN_TRANSIT', 'PENDING'] as ShipmentStatus[],
        (status) => ({ ASSIGNED: 0.46, IN_TRANSIT: 0.39, PENDING: 0.15 })[status],
      );
    } else {
      shipmentStatus = 'DELIVERED';
    }

    const assignedAt = new Date(inPreparationTimestamp);
    const deliveredAt =
      shipmentStatus === 'DELIVERED'
        ? new Date(
            Math.min(
              now.getTime(),
              addHours(assignedAt, randomFloat(rng, 8, 72)).getTime(),
            ),
          )
        : null;

    const updatedAt = deliveredAt ?? addHours(assignedAt, randomFloat(rng, 1, 20));

    shipments.push({
      _id: new ObjectId(),
      orderId: order._id,
      staffUserId: staff._id,
      status: shipmentStatus,
      trackingNumber:
        order.trackingNumber ?? `TRK-${randomInt(rng, 100000, 999999)}`,
      assignedAt,
      deliveredAt,
      createdAt: assignedAt,
      updatedAt,
    });
  }

  return shipments;
}

function enforceMarginBounds(product: SeedProduct) {
  const margin = (product.price - product.costPrice) / product.price;

  if (margin < 0.1) {
    product.price = roundMoney(product.costPrice / (1 - 0.14));
    return;
  }

  if (margin > 0.4) {
    product.price = roundMoney(product.costPrice / (1 - 0.34));
  }
}

function buildInventoryAdjustments(
  products: ProductSeedMeta[],
  reservedByProduct: Map<string, number>,
  adminUser: SeedUser,
  staffUsers: SeedUser[],
  options: SeedOptions,
  rng: () => number,
) {
  const now = new Date();
  const startDate = startOfDay(addDays(now, -(options.daysBack + 14)));
  const adjustments: SeedInventoryAdjustment[] = [];

  const adjustmentActorPool = [
    adminUser._id,
    ...staffUsers.map((staff) => staff._id),
  ];

  for (const productMeta of products) {
    const product = productMeta.doc;
    const threshold = product.inventoryInfo.lowStockThreshold;
    const reserved = reservedByProduct.get(product._id.toHexString()) ?? 0;

    const stockState = weightedPick(rng, ['healthy', 'low', 'out'], (state) => {
      if (state === 'healthy') return 0.6;
      if (state === 'low') return 0.26;
      return 0.14;
    });

    const desiredFinal =
      stockState === 'out'
        ? 0
        : stockState === 'low'
          ? randomInt(rng, 1, Math.max(2, threshold))
          : randomInt(rng, threshold + 2, threshold * 4 + 8);

    const targetTotalInbound = reserved + desiredFinal;
    const events: Array<{
      adjustment: number;
      reason: string;
      when: Date;
      purchasePrice?: number;
      adjustedBy: ObjectId;
    }> = [];

    const firstInbound = Math.max(
      randomInt(
        rng,
        Math.max(threshold + 6, Math.floor(targetTotalInbound * 0.58)),
        Math.max(threshold + 16, Math.ceil(targetTotalInbound * 0.85) + 4),
      ),
      threshold + 6,
    );

    events.push({
      adjustment: firstInbound,
      reason: 'Initial stock receipt',
      when: addDays(startDate, randomInt(rng, 0, 8)),
      purchasePrice: roundMoney(productMeta.baseCost * randomFloat(rng, 0.95, 1.05)),
      adjustedBy: adminUser._id,
    });

    let stagedTotal = firstInbound;

    if (stagedTotal < targetTotalInbound * 0.95) {
      const secondInbound = Math.max(
        targetTotalInbound - stagedTotal + randomInt(rng, 2, 12),
        randomInt(rng, 6, 18),
      );

      stagedTotal += secondInbound;
      events.push({
        adjustment: secondInbound,
        reason: 'Supplier replenishment batch',
        when: addDays(startDate, randomInt(rng, 18, options.daysBack - 15)),
        purchasePrice: roundMoney(productMeta.baseCost * randomFloat(rng, 0.96, 1.08)),
        adjustedBy: weightedPick(rng, adjustmentActorPool, () => 1),
      });
    }

    if (chance(rng, 0.33) && targetTotalInbound > threshold * 2) {
      const thirdInbound = randomInt(rng, 4, 16);
      stagedTotal += thirdInbound;
      events.push({
        adjustment: thirdInbound,
        reason: 'Top-up purchase before high-demand week',
        when: addDays(startDate, randomInt(rng, options.daysBack - 20, options.daysBack - 5)),
        purchasePrice: roundMoney(productMeta.baseCost * randomFloat(rng, 0.97, 1.07)),
        adjustedBy: weightedPick(rng, adjustmentActorPool, () => 1),
      });
    }

    if (chance(rng, 0.3)) {
      const shrink = Math.min(randomInt(rng, 1, 4), Math.max(1, stagedTotal - 1));
      stagedTotal -= shrink;

      events.push({
        adjustment: -shrink,
        reason: 'Cycle count correction (damaged or missing units)',
        when: addDays(startDate, randomInt(rng, 10, options.daysBack - 3)),
        adjustedBy: weightedPick(rng, adjustmentActorPool, () => 1),
      });
    }

    const correction = targetTotalInbound - stagedTotal;
    if (correction !== 0) {
      events.push({
        adjustment: correction,
        reason:
          correction > 0
            ? 'Emergency replenishment to cover demand'
            : 'Stock recount adjustment',
        when: addDays(startDate, randomInt(rng, options.daysBack - 8, options.daysBack - 1)),
        purchasePrice:
          correction > 0
            ? roundMoney(productMeta.baseCost * randomFloat(rng, 0.98, 1.08))
            : undefined,
        adjustedBy: adminUser._id,
      });
    }

    events.sort((a, b) => a.when.getTime() - b.when.getTime());

    let runningQuantity = 0;
    let runningCostPrice = productMeta.baseCost;

    for (const event of events) {
      const previousCostPrice = roundMoney(runningCostPrice);
      const purchasePrice =
        event.adjustment > 0 && event.purchasePrice !== undefined
          ? event.purchasePrice
          : null;

      if (event.adjustment > 0 && purchasePrice !== null) {
        const nextQuantity = Math.max(1, runningQuantity + event.adjustment);
        runningCostPrice = roundMoney(
          (runningQuantity * runningCostPrice + event.adjustment * purchasePrice) /
            nextQuantity,
        );
      }

      runningQuantity += event.adjustment;
      if (runningQuantity < 0) runningQuantity = 0;

      adjustments.push({
        _id: new ObjectId(),
        productId: product._id,
        adjustment: event.adjustment,
        reason: event.reason,
        purchasePrice,
        previousCostPrice,
        newCostPrice: roundMoney(runningCostPrice),
        adjustedBy: event.adjustedBy,
        createdAt: event.when,
        updatedAt: event.when,
      });
    }

    const totalInbound = events.reduce((sum, event) => sum + event.adjustment, 0);
    const finalQuantity = Math.max(0, totalInbound - reserved);
    const lastAdjustmentAt =
      events.length > 0 ? events[events.length - 1].when : null;

    product.inventory = finalQuantity;
    product.inventoryInfo.quantity = finalQuantity;
    product.inventoryInfo.lastAdjustedAt = lastAdjustmentAt;
    product.costPrice = roundMoney(runningCostPrice);
    product.updatedAt =
      lastAdjustmentAt && lastAdjustmentAt > product.updatedAt
        ? lastAdjustmentAt
        : product.updatedAt;

    enforceMarginBounds(product);
  }

  return adjustments;
}

function buildSummary(
  categories: SeedCategory[],
  products: ProductSeedMeta[],
  users: SeedUser[],
  customerUsers: SeedUser[],
  staffUsers: SeedUser[],
  orders: SeedOrder[],
  shipments: SeedShipment[],
  adjustments: SeedInventoryAdjustment[],
): SeedSummary {
  const orderStatusBreakdown: Record<string, number> = {};
  let deliveredRevenueCents = 0;
  let deliveredCostCents = 0;

  for (const order of orders) {
    orderStatusBreakdown[order.status] =
      (orderStatusBreakdown[order.status] ?? 0) + 1;

    if (order.status === 'DELIVERED' || order.status === 'SETTLED') {
      deliveredRevenueCents += order.totalAmount;
      deliveredCostCents += order.items.reduce(
        (sum, item) => sum + item.unitCost * item.quantity,
        0,
      );
    }
  }

  const lowStockProducts = products.filter(
    (entry) =>
      entry.doc.inventoryInfo.quantity > 0 &&
      entry.doc.inventoryInfo.quantity <= entry.doc.inventoryInfo.lowStockThreshold,
  ).length;

  const outOfStockProducts = products.filter(
    (entry) => entry.doc.inventoryInfo.quantity <= 0,
  ).length;

  return {
    categories: categories.length,
    products: products.length,
    users: users.length,
    customers: customerUsers.length,
    staff: staffUsers.length,
    orders: orders.length,
    shipments: shipments.length,
    inventoryAdjustments: adjustments.length,
    orderStatusBreakdown,
    lowStockProducts,
    outOfStockProducts,
    deliveredRevenue: roundMoney(deliveredRevenueCents / 100),
    deliveredProfit: roundMoney((deliveredRevenueCents - deliveredCostCents) / 100),
  };
}

async function seed() {
  const options = parseArgs(process.argv.slice(2));

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set in environment.');
  }

  const dbName = resolveDatabaseName(uri);
  assertSafeEnvironment(dbName, options);

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collections = getCollections(db);
    const rng = createRng(options.seed);

    if (!options.reset) {
      const existingProducts = await collections.products.countDocuments({});
      if (existingProducts > 0) {
        throw new Error(
          'Database already has product data. Run with --reset (default) for coherent KPI seeding.',
        );
      }
    }

    if (options.reset && !options.dryRun) {
      await resetCollections(collections);
    }

    const [adminPasswordHash, staffPasswordHash, clientPasswordHash] =
      await Promise.all([
        bcrypt.hash(process.env.ADMIN_PASSWORD ?? 'Admin1234!', 10),
        bcrypt.hash('Staff1234!', 10),
        bcrypt.hash('Client1234!', 10),
      ]);

    const { users, adminUser, staffUsers, customerUsers } = buildUsers(
      options,
      rng,
      adminPasswordHash,
      staffPasswordHash,
      clientPasswordHash,
    );

    const categories = buildCategories(options, rng);
    const products = buildProducts(options, categories, rng);
    const { orders, reservedByProduct } = buildOrders(
      options,
      products,
      customerUsers,
      adminUser,
      staffUsers,
      rng,
    );
    const shipments = buildShipments(orders, staffUsers, rng);
    const adjustments = buildInventoryAdjustments(
      products,
      reservedByProduct,
      adminUser,
      staffUsers,
      options,
      rng,
    );

    if (!options.dryRun) {
      await collections.users.insertMany(users, { ordered: false });
      await collections.categories.insertMany(categories, { ordered: false });
      await collections.products.insertMany(
        products.map((entry) => entry.doc),
        { ordered: false },
      );
      await collections.orders.insertMany(orders, { ordered: false });

      if (shipments.length > 0) {
        await collections.shipments.insertMany(shipments, { ordered: false });
      }

      if (adjustments.length > 0) {
        await collections.inventoryAdjustments.insertMany(adjustments, {
          ordered: false,
        });
      }
    }

    const summary = buildSummary(
      categories,
      products,
      users,
      customerUsers,
      staffUsers,
      orders,
      shipments,
      adjustments,
    );

    console.log(
      'Scenario:',
      options.scenario,
      '-',
      SCENARIO_PRESETS[options.scenario].summary,
    );
    console.log('Seed options:', options);
    console.log('Target database:', dbName);
    console.log(
      options.dryRun
        ? 'Dry-run completed. No records were written.'
        : 'Seeding completed successfully.',
    );
    console.log('Summary:', summary);
    console.log(
      'Admin credentials:',
      normalizeEmail(process.env.ADMIN_EMAIL ?? 'admin@probuild.local'),
      '/ ',
      process.env.ADMIN_PASSWORD ?? 'Admin1234!',
    );
  } finally {
    await client.close();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
