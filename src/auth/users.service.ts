import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });

    return user ?? null;
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    const [user] = await this.db
      .insert(schema.users)
      .values({ email, passwordHash })
      .returning();

    return user;
  }

  async seedDefaultRoles(): Promise<void> {
    await this.db
      .insert(schema.roles)
      .values([
        { name: 'ADMIN' },
        { name: 'STAFF' },
        { name: 'CUSTOMER' },
      ])
      .onConflictDoNothing();
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));

    return rows.map((row) => row.name);
  }

  async assignRoleToUser(userId: string, roleName: string): Promise<void> {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.name, roleName),
    });

    if (!role) {
      return;
    }

    await this.db
      .insert(schema.userRoles)
      .values({ userId, roleId: role.id })
      .onConflictDoNothing();
  }

  async ensureDefaultRole(userId: string): Promise<void> {
    await this.assignRoleToUser(userId, 'CUSTOMER');
  }

  async setMfaOtp(email: string, otpHash: string, otpExpiresAt: Date): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ mfaOtpHash: otpHash, mfaOtpExpiresAt: otpExpiresAt })
      .where(eq(schema.users.email, email));
  }

  async clearMfaOtp(email: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ mfaOtpHash: null, mfaOtpExpiresAt: null })
      .where(eq(schema.users.email, email));
  }

  async findById(userId: string): Promise<User | null> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    return user ?? null;
  }

  async toggleMfa(userId: string, enabled: boolean): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ mfaEnabled: enabled, mfaOtpHash: null, mfaOtpExpiresAt: null })
      .where(eq(schema.users.id, userId));
  }
}
