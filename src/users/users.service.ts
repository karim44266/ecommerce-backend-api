import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database.constants';
import * as schema from '../database/schema';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** Strip sensitive auth fields before returning to the client. */
  private sanitize(row: typeof schema.users.$inferSelect) {
    const { passwordHash, mfaOtpHash, mfaOtpExpiresAt, ...safe } = row;
    return safe;
  }

  async findAll() {
    const rows = await this.db
      .select()
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt));
    return rows.map((row) => this.sanitize(row));
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`User ${id} not found`);
    return this.sanitize(row);
  }

  async updateRole(id: string, role: string) {
    const [row] = await this.db
      .update(schema.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    if (!row) throw new NotFoundException(`User ${id} not found`);
    return this.sanitize(row);
  }

  async updateStatus(id: string, status: string) {
    const [row] = await this.db
      .update(schema.users)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    if (!row) throw new NotFoundException(`User ${id} not found`);
    return this.sanitize(row);
  }
}
