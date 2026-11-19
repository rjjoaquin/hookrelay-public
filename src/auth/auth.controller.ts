import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService, AuthUser } from './auth.service';
import { assertCsrfHeader, clearSessionCookie, CurrentUser, readSessionCookie, SessionGuard, setSessionCookie } from './session';

class CredentialsDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(10, 128, { message: 'Password must be 10-128 characters' }) password: string;
}

class LoginDto {
  @IsString() @MaxLength(254) email: string;
  @IsString() @MaxLength(128) password: string;
}

// Brute-force protection: 10 attempts per minute per IP on credential endpoints.
const AUTH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(AUTH_LIMIT)
  async register(@Body() dto: CredentialsDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const { user, token } = await this.auth.register(dto.email, dto.password);
    setSessionCookie(res, token);
    return user;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const { user, token } = await this.auth.login(dto.email, dto.password);
    setSessionCookie(res, token);
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    await this.auth.logout(readSessionCookie(req));
    clearSessionCookie(res);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
