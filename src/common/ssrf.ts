import { BlockList, isIP, LookupFunction } from 'net';
import { lookup as dnsLookup } from 'dns';

// Separate lists: Node's BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked6.addSubnet(net, prefix, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked4.check(address, 'ipv4');
  if (family === 6) return blocked6.check(address, 'ipv6');
  return true; // not an IP: treat as unsafe
}

/** Validates a destination URL's shape. DNS is re-checked at connect time by safeLookup. */
export function validateDestinationUrl(raw: string, allowPrivate: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Invalid URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'URL must use http or https';
  if (url.username || url.password) return 'URL must not contain credentials';
  if (allowPrivate) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'Private destinations are not allowed';
  }
  if (isIP(host) && isPrivateAddress(host)) return 'Private destinations are not allowed';
  return null;
}

/** DNS lookup used by the HTTP client; rejects private addresses (blocks DNS rebinding). */
export function makeSafeLookup(allowPrivate: boolean): LookupFunction {
  return ((hostname: string, options: any, callback: any) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: any) => {
      if (err) return callback(err);
      const list = addresses as { address: string; family: number }[];
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        const e = new Error(`Destination resolves to a private address`) as NodeJS.ErrnoException;
        e.code = 'EPRIVATEADDR';
        return callback(e);
      }
      if (options?.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  }) as LookupFunction;
}
