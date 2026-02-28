import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  sendMfaOtp(email: string, otp: string): void {
    // Mock mailer: replace with real email provider.
    this.logger.log(`Sending MFA OTP to ${email}: ${otp}`);
  }
}
