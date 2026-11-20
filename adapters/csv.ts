/** RFC 4180 CSV. No third-party parser. */

export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
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

export function toCsv(rows: (string | number | null)[][], delimiter = ','): string {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  return rows.map(r => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}
