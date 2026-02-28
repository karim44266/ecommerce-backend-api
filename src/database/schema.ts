import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryKey } from 'drizzle-orm/pg-core';

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
