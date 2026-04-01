/**
 * Standalone seed script — creates a default ADMIN user if none exists.
 * Run with: npx ts-node src/seed.ts
 */
import * as bcrypt from 'bcrypt';
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();

  // Extract DB name from the connection string accurately, or use 'ecommerce' as a fallback
  const dbMatch = uri.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : 'ecommerce';

  const db = client.db(dbName);
  const users = db.collection('users');

  const email = process.env.ADMIN_EMAIL || 'admin@admin.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin1234!';

  // Check if any admin exists
  const existingAdmin = await users.findOne({ roles: 'ADMIN' });

  if (existingAdmin) {
    console.log(`✅ Admin user already exists: ${existingAdmin.email}`);
    await client.close();
    return;
  }

  // Check if the target email exists
  const existingUser = await users.findOne({ email: email.toLowerCase() });

  if (existingUser) {
    await users.updateOne(
      { _id: existingUser._id },
      { $set: { roles: ['ADMIN'] } },
    );
    console.log(`✅ Promoted existing user to ADMIN: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    await users.insertOne({
      email: email.toLowerCase(),
      name: 'System Admin',
      roles: ['ADMIN'],
      status: 'active',
      passwordHash,
      mfaEnabled: false,
      mfaOtpHash: null,
      mfaOtpExpiresAt: null,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
      personalCatalog: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅ Created ADMIN user: ${email} / ${password}`);
  }

  await client.close();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
