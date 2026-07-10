import { ConfigError } from './errors';

export type Spec =
  | { readonly kind: 'number'; readonly int?: boolean; readonly min?: number; readonly max?: number; readonly exclusiveMin?: number }
  | { readonly kind: 'string'; readonly values?: readonly string[]; readonly minLength?: number }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'array'; readonly item: Spec; readonly minLength?: number }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, Spec>>; readonly optional?: readonly string[] }
  | { readonly kind: 'tagged'; readonly tag: string; readonly variants: Readonly<Record<string, Spec>> };

function fail(path: string, message: string): never {
  throw new ConfigError(`${path}: ${message}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validate(spec: Spec, value: unknown, path = '$'): unknown {
  switch (spec.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, `expected finite number, got ${describe(value)}`);
      if (spec.int === true && !Number.isInteger(value)) fail(path, `expected integer, got ${value}`);
      if (spec.min !== undefined && value < spec.min) fail(path, `expected >= ${spec.min}, got ${value}`);
      if (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin) fail(path, `expected > ${spec.exclusiveMin}, got ${value}`);
      if (spec.max !== undefined && value > spec.max) fail(path, `expected <= ${spec.max}, got ${value}`);
      return value;
    }
    case 'string': {
      if (typeof value !== 'string') fail(path, `expected string, got ${describe(value)}`);
      if (spec.minLength !== undefined && value.length < spec.minLength) fail(path, `expected length >= ${spec.minLength}`);
      if (spec.values !== undefined && spec.values.indexOf(value) < 0) {
        fail(path, `expected one of [${spec.values.join(', ')}], got "${value}"`);
      }
      return value;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') fail(path, `expected boolean, got ${describe(value)}`);
      return value;
    }
    case 'array': {
      if (!Array.isArray(value)) fail(path, `expected array, got ${describe(value)}`);
      if (spec.minLength !== undefined && value.length < spec.minLength) fail(path, `expected length >= ${spec.minLength}`);
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) out.push(validate(spec.item, value[i], `${path}[${i}]`));
      return Object.freeze(out);
    }
    case 'object': {
      if (!isPlainObject(value)) fail(path, `expected object, got ${describe(value)}`);
      const optional = spec.optional ?? [];
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(spec.fields)) {
        const present = Object.prototype.hasOwnProperty.call(value, key);
        if (!present) {
          if (optional.indexOf(key) >= 0) continue;
          fail(path, `missing required field "${key}"`);
        }
        out[key] = validate(spec.fields[key], value[key], `${path}.${key}`);
      }
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) {
          fail(path, `unknown field "${key}"`);
        }
      }
      return Object.freeze(out);
    }
    case 'tagged': {
      if (!isPlainObject(value)) fail(path, `expected object, got ${describe(value)}`);
      const tagValue = value[spec.tag];
      if (typeof tagValue !== 'string') fail(`${path}.${spec.tag}`, 'expected string discriminator');
      if (!Object.prototype.hasOwnProperty.call(spec.variants, tagValue)) {
        fail(`${path}.${spec.tag}`, `unknown variant "${tagValue}", expected one of [${Object.keys(spec.variants).join(', ')}]`);
      }
      return validate(spec.variants[tagValue], value, path);
    }
    default:
      return fail(path, 'unreachable spec kind');
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
