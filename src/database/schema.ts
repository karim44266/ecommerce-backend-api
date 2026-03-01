import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Users ───────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name').notNull().default(''),
    role: text('role').notNull().default('customer'),
    status: text('status').notNull().default('active'),
    passwordHash: text('password_hash').notNull(),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaOtpHash: text('mfa_otp_hash'),
    mfaOtpExpiresAt: timestamp('mfa_otp_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: index('users_email_idx').on(table.email),
  }),
);

// ─── Roles (RBAC) ───────────────────────────────────────────────
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
  },
  (table) => ({
    nameIdx: index('roles_name_idx').on(table.name),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),
  }),
);

// ─── Categories ──────────────────────────────────────────────────
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugIdx: index('categories_slug_idx').on(table.slug),
  }),
);

// ─── Products ────────────────────────────────────────────────────
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    sku: text('sku').notNull().unique(),
    description: text('description').notNull().default(''),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    image: text('image').notNull().default(''),
    inventory: integer('inventory').notNull().default(0),
    status: text('status').notNull().default('active'),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nameIdx: index('products_name_idx').on(table.name),
    skuIdx: index('products_sku_idx').on(table.sku),
    categoryIdx: index('products_category_idx').on(table.categoryId),
  }),
);

// ─── Relations ───────────────────────────────────────────────────
export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [products.id],
    references: [inventoryItems.productId],
  }),
}));

// ─── Inventory Items ─────────────────────────────────────────────
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .unique()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(10),
    lastAdjustedAt: timestamp('last_adjusted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    productIdx: index('inventory_items_product_idx').on(table.productId),
  }),
);

// ─── Inventory Adjustments (Audit Log) ───────────────────────────
export const inventoryAdjustments = pgTable(
  'inventory_adjustments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    adjustment: integer('adjustment').notNull(),
    reason: text('reason'),
    adjustedBy: uuid('adjusted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    itemIdx: index('inventory_adj_item_idx').on(table.inventoryItemId),
    userIdx: index('inventory_adj_user_idx').on(table.adjustedBy),
  }),
);

// ─── Inventory Relations ─────────────────────────────────────────
export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  product: one(products, {
    fields: [inventoryItems.productId],
    references: [products.id],
  }),
  adjustments: many(inventoryAdjustments),
}));

export const inventoryAdjustmentsRelations = relations(inventoryAdjustments, ({ one }) => ({
  inventoryItem: one(inventoryItems, {
    fields: [inventoryAdjustments.inventoryItemId],
    references: [inventoryItems.id],
  }),
  user: one(users, {
    fields: [inventoryAdjustments.adjustedBy],
    references: [users.id],
  }),
}));

// ─── Orders ──────────────────────────────────────────────────────
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING_PAYMENT'),
    totalAmount: integer('total_amount').notNull(), // stored in cents
    shippingAddress: jsonb('shipping_address'),
    trackingNumber: text('tracking_number'),
    carrier: text('carrier'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index('orders_user_idx').on(table.userId),
    statusIdx: index('orders_status_idx').on(table.status),
  }),
);

// ─── Order Items ─────────────────────────────────────────────────
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    name: text('product_name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(), // stored in cents
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIdx: index('order_items_order_idx').on(table.orderId),
  }),
);

// ─── Order Status History (audit trail) ──────────────────────────
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    note: text('note'),
    changedBy: uuid('changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIdx: index('order_status_history_order_idx').on(table.orderId),
  }),
);

// ─── Order Relations ─────────────────────────────────────────────
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, {
    fields: [orderStatusHistory.orderId],
    references: [orders.id],
  }),
  changedByUser: one(users, {
    fields: [orderStatusHistory.changedBy],
    references: [users.id],
  }),
}));
