import { isIP } from 'node:net';
import { z } from 'zod';

export const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

export const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

export const trustedProxyCidrs = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .refine(
    (entries) =>
      entries.every((entry) => {
        const [address, prefix, ...remainder] = entry.split('/');
        const family = address ? isIP(address) : 0;
        if (!family || remainder.length) return false;
        if (prefix === undefined) return true;
        if (!/^\d+$/.test(prefix)) return false;
        const bits = Number(prefix);
        return bits > 0 && bits <= (family === 4 ? 32 : 128);
      }),
    'must contain only explicit IP addresses or CIDR ranges',
  );
