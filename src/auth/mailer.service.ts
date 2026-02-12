import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async sendMfaOtp(email: string, otp: string): Promise<void> {
    // Mock mailer: replace with real email provider.
    this.logger.log(`Sending MFA OTP to ${email}: ${otp}`);
  }
}
