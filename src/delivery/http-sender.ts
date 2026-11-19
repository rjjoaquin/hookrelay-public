import http from 'http';
import https from 'https';
import { isIP } from 'net';
import { config } from '../config';
import { isPrivateAddress, makeSafeLookup } from '../common/ssrf';

export interface SendResult {
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  /** True when retrying cannot help (e.g. destination blocked by SSRF policy). */
  permanent?: boolean;
}

const MAX_RESPONSE_BYTES = 2048;
const safeLookup = makeSafeLookup(config.allowPrivateDestinations);

/** POSTs a webhook. Never follows redirects, caps response size, enforces a hard timeout. */
export function sendWebhook(url: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Omit<SendResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, durationMs: Date.now() - started });
    };

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return done({ statusCode: null, responseBody: null, error: 'Invalid URL', permanent: true });
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    if (!config.allowPrivateDestinations && isIP(host) && isPrivateAddress(host)) {
      return done({ statusCode: null, responseBody: null, error: 'Destination is a private address', permanent: true });
    }

    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
        lookup: safeLookup,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (size < MAX_RESPONSE_BYTES) chunks.push(c.subarray(0, MAX_RESPONSE_BYTES - size));
          size += c.length;
          if (size >= MAX_RESPONSE_BYTES) res.destroy();
        });
        const finish = () =>
          done({ statusCode: res.statusCode ?? null, responseBody: Buffer.concat(chunks).toString('utf8'), error: null });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ statusCode: null, responseBody: null, error: `Timed out after ${config.deliveryTimeoutMs}ms` });
    }, config.deliveryTimeoutMs);
    req.on('error', (e: NodeJS.ErrnoException) =>
      done({ statusCode: null, responseBody: null, error: e.code ? `${e.code}: ${e.message}` : e.message, permanent: e.code === 'EPRIVATEADDR' }),
    );
    req.end(body);
  });
}
