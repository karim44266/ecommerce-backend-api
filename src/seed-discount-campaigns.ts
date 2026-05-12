import { config } from 'dotenv';
import path from 'path';
import { Collection, MongoClient, ObjectId } from 'mongodb';

config({ path: path.join(process.cwd(), '.env') });

const SEED_PREFIX = 'seed-discount-campaign';

type DiscountCampaignScope = 'ALL_USERS' | 'CATEGORY' | 'PRODUCT_SET';
type DiscountType = 'PERCENT' | 'FIXED';
type DiscountCampaignStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED';

interface SeedCategory {
  _id: ObjectId;
  name: string;
}

interface SeedProduct {
  _id: ObjectId;
  name: string;
  categoryId: ObjectId;
}

interface CampaignDefinition {
  name: string;
  scope: DiscountCampaignScope;
  productIds?: ObjectId[];
  categoryIds?: ObjectId[];
  discountType: DiscountType;
  discountValue: number;
  minOrderAmount?: number | null;
  maxRedemptions?: number | null;
  startsAt: Date;
  endsAt: Date;
  status: DiscountCampaignStatus;
  stackable: boolean;
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

async function loadCategories(
  db: ReturnType<MongoClient['db']>,
): Promise<SeedCategory[]> {
  const rows = await db
    .collection<Record<string, unknown>>('categories')
    .find({}, { projection: { _id: 1, name: 1 } })
    .limit(200)
    .toArray();

  return rows
    .map((row) => {
      const id = toObjectId(row._id);
      if (!id) {
        return null;
      }

      return {
        _id: id,
        name: String(row.name ?? 'Unnamed category'),
      };
    })
    .filter((row): row is SeedCategory => row !== null);
}

async function loadProducts(
  db: ReturnType<MongoClient['db']>,
): Promise<SeedProduct[]> {
  const rows = await db
    .collection<Record<string, unknown>>('products')
    .find(
      {
        status: { $in: ['active', 'ACTIVE'] },
        categoryId: { $ne: null },
        $or: [
          { 'inventoryInfo.quantity': { $gt: 0 } },
          { inventory: { $gt: 0 } },
        ],
      },
      {
        projection: { _id: 1, name: 1, categoryId: 1 },
      },
    )
    .limit(300)
    .toArray();

  return rows
    .map((row) => {
      const id = toObjectId(row._id);
      const categoryId = toObjectId(row.categoryId);
      if (!id || !categoryId) {
        return null;
      }

      return {
        _id: id,
        name: String(row.name ?? 'Unnamed product'),
        categoryId,
      };
    })
    .filter((row): row is SeedProduct => row !== null);
}

function pickMostRepresentedCategory(
  categories: SeedCategory[],
  products: SeedProduct[],
): SeedCategory {
  const countsByCategory = new Map<string, number>();
  for (const product of products) {
    const key = product.categoryId.toHexString();
    countsByCategory.set(key, (countsByCategory.get(key) ?? 0) + 1);
  }

  const sorted = [...countsByCategory.entries()].sort((left, right) => {
    return right[1] - left[1];
  });

  const topCategoryId = sorted[0]?.[0];
  if (!topCategoryId) {
    throw new Error('Could not select a target category from products.');
  }

  const category = categories.find((entry) => entry._id.toHexString() === topCategoryId);
  if (!category) {
    throw new Error('Target category was not found in categories collection.');
  }

  return category;
}

function buildCampaignDefinitions(
  targetCategory: SeedCategory,
  targetProducts: SeedProduct[],
): CampaignDefinition[] {
  const now = new Date();
  const activeStartsAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const activeEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const draftStartsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const draftEndsAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  return [
    {
      name: `${SEED_PREFIX} - Global 12% (non-stackable)`,
      scope: 'ALL_USERS',
      productIds: [],
      categoryIds: [],
      discountType: 'PERCENT',
      discountValue: 12,
      minOrderAmount: 300,
      maxRedemptions: null,
      startsAt: activeStartsAt,
      endsAt: activeEndsAt,
      status: 'ACTIVE',
      stackable: false,
    },
    {
      name: `${SEED_PREFIX} - ${targetCategory.name} fixed 35 (stackable)`,
      scope: 'CATEGORY',
      productIds: [],
      categoryIds: [targetCategory._id],
      discountType: 'FIXED',
      discountValue: 35,
      minOrderAmount: 120,
      maxRedemptions: null,
      startsAt: activeStartsAt,
      endsAt: activeEndsAt,
      status: 'ACTIVE',
      stackable: true,
    },
    {
      name: `${SEED_PREFIX} - Product set 8% (stackable)`,
      scope: 'PRODUCT_SET',
      productIds: targetProducts.map((product) => product._id),
      categoryIds: [],
      discountType: 'PERCENT',
      discountValue: 8,
      minOrderAmount: null,
      maxRedemptions: null,
      startsAt: activeStartsAt,
      endsAt: activeEndsAt,
      status: 'ACTIVE',
      stackable: true,
    },
    {
      name: `${SEED_PREFIX} - Draft 20% preview`,
      scope: 'ALL_USERS',
      productIds: [],
      categoryIds: [],
      discountType: 'PERCENT',
      discountValue: 20,
      minOrderAmount: 500,
      maxRedemptions: 100,
      startsAt: draftStartsAt,
      endsAt: draftEndsAt,
      status: 'DRAFT',
      stackable: false,
    },
  ];
}

async function upsertCampaign(
  collection: Collection<Record<string, unknown>>,
  definition: CampaignDefinition,
): Promise<{ id: ObjectId; action: 'inserted' | 'updated' }> {
  const now = new Date();

  const payload = {
    name: definition.name,
    scope: definition.scope,
    productIds: definition.productIds ?? [],
    categoryIds: definition.categoryIds ?? [],
    discountType: definition.discountType,
    discountValue: definition.discountValue,
    minOrderAmount: definition.minOrderAmount ?? null,
    maxRedemptions: definition.maxRedemptions ?? null,
    startsAt: definition.startsAt,
    endsAt: definition.endsAt,
    status: definition.status,
    stackable: definition.stackable,
    updatedAt: now,
  };

  const existing = await collection.findOne(
    { name: definition.name },
    { projection: { _id: 1 } },
  );

  const existingId = toObjectId(existing?._id);
  if (existingId) {
    await collection.updateOne({ _id: existingId }, { $set: payload });
    return { id: existingId, action: 'updated' };
  }

  const inserted = await collection.insertOne({
    ...payload,
    createdAt: now,
  });

  return { id: inserted.insertedId, action: 'inserted' };
}

async function seedDiscountCampaigns() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not configured in .env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db();
    const [categories, products] = await Promise.all([
      loadCategories(db),
      loadProducts(db),
    ]);

    if (categories.length === 0) {
      throw new Error('No categories found. Run npm run seed first.');
    }

    if (products.length < 3) {
      throw new Error(
        'Not enough active products with stock were found. Run npm run seed first.',
      );
    }

    const targetCategory = pickMostRepresentedCategory(categories, products);
    const productSet = products
      .filter(
        (product) =>
          product.categoryId.toHexString() === targetCategory._id.toHexString(),
      )
      .slice(0, 3);

    const fallbackProductSet = products.slice(0, 3);
    const targetProducts = productSet.length >= 3 ? productSet : fallbackProductSet;

    const definitions = buildCampaignDefinitions(targetCategory, targetProducts);
    const campaignsCollection = db.collection<Record<string, unknown>>(
      'discount_campaigns',
    );

    const results: Array<{
      name: string;
      id: string;
      action: 'inserted' | 'updated';
    }> = [];

    for (const definition of definitions) {
      const result = await upsertCampaign(campaignsCollection, definition);
      results.push({
        name: definition.name,
        id: result.id.toHexString(),
        action: result.action,
      });
    }

    console.log('Discount campaign seeding completed.');
    console.log(
      JSON.stringify(
        {
          campaignCount: results.length,
          categoryUsed: {
            id: targetCategory._id.toHexString(),
            name: targetCategory.name,
          },
          productSetUsed: targetProducts.map((product) => ({
            id: product._id.toHexString(),
            name: product.name,
          })),
          campaigns: results,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

seedDiscountCampaigns()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Discount campaign seed failed:', error);
    process.exit(1);
  });
