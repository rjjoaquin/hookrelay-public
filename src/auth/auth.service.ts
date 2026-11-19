import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { config } from '../config';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../common/password';
import { isUniqueViolation, PrismaService } from '../prisma.service';

export interface AuthUser {
  id: string;
  email: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    if (!config.allowRegistration) throw new ForbiddenException('Registration is disabled');
    try {
      const user = await this.prisma.db.user.create({
        data: { email: normalize(email), passwordHash: await hashPassword(password) },
        select: { id: true, email: true },
      });
      return { user, token: await this.createSession(user.id) };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('An account with this email already exists');
      throw e;
    }
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const found = await this.prisma.db.user.findUnique({
      where: { email: normalize(email) },
      select: { id: true, email: true, passwordHash: true },
    });
    const ok = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !ok) throw new UnauthorizedException('Invalid email or password');
    return { user: { id: found.id, email: found.email }, token: await this.createSession(found.id) };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.prisma.db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  async userForToken(token: string | undefined): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    const session = await this.prisma.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { expiresAt: true, user: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return session.user;
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.db.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + config.sessionTtlDays * 86_400_000) },
    });
    return token;
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
