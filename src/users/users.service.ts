import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** Strip sensitive fields before returning to client. */
  private sanitize(
    user: typeof schema.users.$inferSelect,
  ): Omit<
    typeof schema.users.$inferSelect,
    'passwordHash' | 'mfaOtpHash' | 'mfaOtpExpiresAt'
  > {
    const { passwordHash: _pw, mfaOtpHash: _otp, mfaOtpExpiresAt: _exp, ...safe } = user;
    return safe;
  }

  async findAll(query?: { page?: number; limit?: number; search?: string }) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (query?.search) {
      conditions.push(
        or(
          ilike(schema.users.email, `%${query.search}%`),
          ilike(schema.users.name, `%${query.search}%`),
        ),
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(whereClause);
    const total = countResult?.count ?? 0;

    const rows = await this.db
      .select()
      .from(schema.users)
      .where(whereClause)
      .orderBy(schema.users.createdAt)
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((row) => this.sanitize(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(user);
  }

  async updateRole(id: string, role: string) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundException('User not found');
    }

    // Sync the user_roles junction table so the JWT includes the correct role
    const roleName = role.toUpperCase();
    const roleRow = await this.db.query.roles.findFirst({
      where: eq(schema.roles.name, roleName),
    });
    if (roleRow) {
      // Remove all existing roles for this user
      await this.db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, id));
      // Assign the new role + CUSTOMER as a base role
      const rolesToAssign = [roleRow.id];
      if (roleName !== 'CUSTOMER') {
        const customerRole = await this.db.query.roles.findFirst({
          where: eq(schema.roles.name, 'CUSTOMER'),
        });
        if (customerRole) {
          rolesToAssign.push(customerRole.id);
        }
      }
      await this.db
        .insert(schema.userRoles)
        .values(rolesToAssign.map((roleId) => ({ userId: id, roleId })))
        .onConflictDoNothing();
    }

    return this.sanitize(updated);
  }

  async updateStatus(id: string, status: string) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(updated);
  }
}
