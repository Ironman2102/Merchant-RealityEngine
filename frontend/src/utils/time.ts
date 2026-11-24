const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?([.,]\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * An ISO date or date-time as epoch ms, the same on every host. With no offset it is Indian time: Date.parse would read
 * it in the computer's own timezone, and the same file would score differently on a server in UTC.
 */
export function instant(raw: unknown): number {
  if (typeof raw !== 'string') return NaN;
  const m = ISO.exec(raw.trim());
  if (!m) return NaN;
  const [, day, hm = '00:00', sec = ':00', frac = '', zone = '+05:30'] = m;
  return Date.parse(`${day}T${hm}${sec}${frac.replace(',', '.')}${zone.toUpperCase()}`);
}
