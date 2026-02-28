import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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

  async findAll() {
    const rows = await this.db.select().from(schema.users);
    return rows.map((row) => this.sanitize(row));
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
