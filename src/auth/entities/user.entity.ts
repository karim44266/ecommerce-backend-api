export class User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  passwordHash: string;
  mfaEnabled: boolean;
  mfaOtpHash: string | null;
  mfaOtpExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
