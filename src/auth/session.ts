import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { config } from '../config';
import { AuthService, AuthUser } from './auth.service';

export const SESSION_COOKIE = 'hr_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readSessionCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlDays * 86_400_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' });
}

/**
 * CSRF defence in depth (on top of SameSite=Strict): state-changing requests must carry a
 * custom header, which browsers will not send cross-origin without a CORS preflight we never allow.
 */
export function assertCsrfHeader(req: Request): void {
  if (!SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'hookrelay') {
    throw new ForbiddenException('Missing X-Requested-With header');
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    assertCsrfHeader(req);
    const user = await this.auth.userForToken(readSessionCookie(req));
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
