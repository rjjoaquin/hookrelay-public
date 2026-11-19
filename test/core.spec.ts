import { backoffDelay, isRetryable, retryDelay } from '../src/common/backoff';
import { hmacHex, signOutbound, verifyInbound } from '../src/common/crypto';
import { isPrivateAddress, makeSafeLookup, validateDestinationUrl } from '../src/common/ssrf';
import { applyTransform, validateTransform } from '../src/common/transform';

describe('backoff', () => {
  it('grows exponentially within jitter bounds and caps', () => {
    expect(backoffDelay(1, 1000, 60000, () => 0)).toBe(500);
    expect(backoffDelay(1, 1000, 60000, () => 0.999)).toBeLessThanOrEqual(1000);
    expect(backoffDelay(4, 1000, 60000, () => 0)).toBe(4000);
    expect(backoffDelay(20, 1000, 60000, () => 1)).toBe(60000);
  });
  it('is deterministic per job and attempt', () => {
    expect(retryDelay('job', 3, 1000, 60000)).toBe(retryDelay('job', 3, 1000, 60000));
  });
  it('classifies retryable statuses', () => {
    expect([null, 500, 503, 408, 429].every(isRetryable)).toBe(true);
    expect([400, 401, 404, 410].some(isRetryable)).toBe(false);
  });
});

describe('signatures', () => {
  const body = Buffer.from('{"a":1}');
  it('verifies inbound sha256 signatures', () => {
    const sig = hmacHex('s3cret', body);
    expect(verifyInbound('s3cret', body, `sha256=${sig}`)).toBe(true);
    expect(verifyInbound('s3cret', body, sig)).toBe(true);
    expect(verifyInbound('wrong', body, sig)).toBe(false);
    expect(verifyInbound('s3cret', body, undefined)).toBe(false);
    expect(verifyInbound('s3cret', body, 'sha256=zz')).toBe(false);
  });
  it('signs outbound payloads with timestamp', () => {
    expect(signOutbound('k', 'body', 100)).toBe(`t=100,v1=${hmacHex('k', '100.body')}`);
  });
});

describe('ssrf', () => {
  it('flags private and special addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '100.64.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('93.184.215.14')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });
  it('validates destination URLs', () => {
    expect(validateDestinationUrl('https://example.com/hook', false)).toBeNull();
    expect(validateDestinationUrl('ftp://example.com', false)).not.toBeNull();
    expect(validateDestinationUrl('http://user:pw@example.com', false)).not.toBeNull();
    expect(validateDestinationUrl('http://localhost:3000', false)).not.toBeNull();
    expect(validateDestinationUrl('http://169.254.169.254/latest', false)).not.toBeNull();
    expect(validateDestinationUrl('http://[::ffff:127.0.0.1]/', false)).not.toBeNull();
    expect(validateDestinationUrl('http://localhost:3000', true)).toBeNull();
  });
  it('rejects hostnames that resolve to private addresses at connect time', (done) => {
    makeSafeLookup(false)('localhost', {}, (err: NodeJS.ErrnoException | null) => {
      expect(err?.code).toBe('EPRIVATEADDR');
      done();
    });
  });
});

describe('transform', () => {
  const input = { type: 'order.created', data: { id: 'ord_1', items: [{ sku: 'A' }] } };
  it('maps paths and keeps literals', () => {
    expect(applyTransform({ kind: '$.type', sku: '$.data.items.0.sku', via: 'relay', all: '$' }, input)).toEqual({
      kind: 'order.created', sku: 'A', via: 'relay', all: input,
    });
  });
  it('blocks prototype access and bad specs', () => {
    expect(applyTransform({ x: '$.__proto__' }, input)).toEqual({ x: undefined });
    expect(validateTransform([1])).not.toBeNull();
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(validateTransform(deep)).not.toBeNull();
  });
});

describe('transform limits', () => {
  it('allows whole-payload reference only once', () => {
    expect(validateTransform({ a: '$' })).toBeNull();
    expect(validateTransform({ a: '$', b: '$' })).not.toBeNull();
  });
});

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const { hashPassword, verifyPassword, DUMMY_HASH } = await import('../src/common/password');
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct-horse-battery', a)).toBe(true);
    expect(await verifyPassword('wrong-password', a)).toBe(false);
    expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });
});
