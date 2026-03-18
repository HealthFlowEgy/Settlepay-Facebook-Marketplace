import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * AdminGuard — REM-03: Reads isAdmin from the JWT payload (set by JwtStrategy.validate).
 * No DB round-trip — eliminates the per-request user lookup that was in AdminController.requireAdmin().
 *
 * Usage: @UseGuards(JwtAuthGuard, AdminGuard)
 * JwtAuthGuard must run first to populate req.user.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
