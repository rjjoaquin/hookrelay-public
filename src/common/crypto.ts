import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Outbound signature: `t=<unix>,v1=<hex hmac of "<t>.<body>">` */
export function signOutbound(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

/** Inbound signature: header value is `sha256=<hex>` or `<hex>` of the raw body. */
export function verifyInbound(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const provided = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  return safeEqual(provided, hmacHex(secret, rawBody));
}
