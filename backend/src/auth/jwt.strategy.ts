// jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey:    config.get<string>('jwt.secret'),
    });
  }
  validate(payload: any) {
    // REM-03: isAdmin from JWT payload — no DB lookup needed in AdminGuard
    return { sub: payload.sub, mobile: payload.mobile, isProvider: payload.isProvider, isAdmin: payload.isAdmin ?? false };
  }
}
