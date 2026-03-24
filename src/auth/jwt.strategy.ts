import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret'),
    });
  }

  async validate(payload: { sub: string; email: string; roles?: string[] }) {
    // Check if user is blocked — reject existing access tokens for blocked users
    const user = await this.userModel.findById(payload.sub).select('status').lean();
    if (!user || user.status === 'blocked') {
      throw new UnauthorizedException('Account is blocked or does not exist');
    }

    return { userId: payload.sub, email: payload.email, roles: payload.roles ?? [] };
  }
}
