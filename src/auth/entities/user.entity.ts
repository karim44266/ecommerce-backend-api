export class User {
  id: string;
  email: string;
  passwordHash: string;
  mfaEnabled: boolean;
  mfaOtpHash: string | null;
  mfaOtpExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
