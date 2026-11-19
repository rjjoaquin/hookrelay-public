/**
 * Declarative payload transform. A spec is a JSON object whose leaf values are either
 * literals or JSON paths starting with "$" (e.g. "$.data.id", "$.items.0.sku", "$").
 *
 *   { "type": "$.event", "orderId": "$.data.id", "via": "hookrelay" }
 *
 * No code execution, bounded depth.
 */
const MAX_DEPTH = 10;

function readPath(input: unknown, path: string): unknown {
  if (path === '$') return input;
  let cur: any = input;
  for (const key of path.slice(2).split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function apply(spec: unknown, input: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new Error('Transform too deeply nested');
  if (typeof spec === 'string' && (spec === '$' || spec.startsWith('$.'))) return readPath(input, spec);
  if (Array.isArray(spec)) return spec.map((s) => apply(s, input, depth + 1));
  if (spec !== null && typeof spec === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(spec)) out[k] = apply(v, input, depth + 1);
    return out;
  }
  return spec;
}

export function applyTransform(spec: Record<string, unknown>, input: unknown): unknown {
  return apply(spec, input, 0);
}

export function validateTransform(spec: unknown): string | null {
  if (spec === null) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) return 'Transform must be a JSON object';
  const json = JSON.stringify(spec);
  if (json.length > 10_000) return 'Transform is too large';
  // Each "$" copies the whole payload; cap it so a spec cannot multiply a 1 MB body into gigabytes.
  if ((json.match(/"\$"/g) ?? []).length > 1) return 'Use "$" (whole payload) at most once';
  try {
    apply(spec, {}, 0);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}
