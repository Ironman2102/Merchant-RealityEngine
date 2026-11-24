/** RFC 4180 CSV. No third-party parser. */

export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // A quote opens a field only at its start, and only if a closing quote ends that field. A stray one is just text,
    // so it cannot swallow the rows after it.
    if (c === '"') {
      const close = cur.trim() ? -1 : closingQuote(s, i + 1, delimiter);
      if (close < 0) cur += c;
      else { cur += s.slice(i + 1, close).replaceAll('""', '"'); i = close; }
    }
    else if (c === delimiter) { row.push(cur); cur = ''; }
    else if (c === '\r') {
      if (s[i + 1] === '\n') continue;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  if (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return rows;
}

/** The quote that ends a quoted field, or -1 when the opening one was a stray character. */
function closingQuote(s: string, from: number, delimiter: string): number {
  for (let j = s.indexOf('"', from); j >= 0; j = s.indexOf('"', j + 1)) {
    if (s[j + 1] === '"') { j++; continue; }
    return j + 1 === s.length || s[j + 1] === delimiter || s[j + 1] === '\r' || s[j + 1] === '\n' ? j : -1;
  }
  return -1;
}

const NUMBER = /^[-+]?(\d+(\.\d+)?|\.\d+)(e[-+]?\d+)?$/i;
/**
 * A spreadsheet runs a cell that starts like a formula, and some locales split on semicolons. Such text gets a leading
 * apostrophe, which spreadsheets treat as "this is text". Numbers are left alone.
 */
export function inertText(v: string): string {
  if (NUMBER.test(v)) return v;
  const s = v.replace(/([;\t\r\n])(\s*)([=+\-@＝＋－＠])/g, "$1$2'$3");
  return /^\s*[=+\-@＝＋－＠]|^[\t\r\n]/.test(s) ? `'${s}` : s;
}

export function toCsv(rows: (string | number | null)[][], delimiter = ','): string {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : inertText(String(v));
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  return rows.map(r => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}
