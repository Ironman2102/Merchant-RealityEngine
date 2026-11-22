import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { handle } from './http';
import { assertSecrets } from './auth';
import { assertSealed } from './integrity';

try {
  assertSecrets();
  assertSealed();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const port = Number(process.env.PORT || 8787);
// Loopback by default. A container must set HOST=0.0.0.0 or its published port answers nothing.
const host = process.env.HOST || '127.0.0.1';
const dist = join(process.cwd(), 'dist-console');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function staticFile(urlPath: string): string | null {
  if (!existsSync(dist)) return null;
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '').replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = join(dist, rel);
  if (!candidate.startsWith(dist)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const index = join(dist, 'console.html');
  return existsSync(index) ? index : null;
}

createServer((req, res) => {
  let path: string;
  try {
    // A malformed URL must be a 400. Unhandled, either of these throws took the whole process down.
    path = new URL(req.url || '/', 'http://localhost').pathname;
    decodeURIComponent(path);
  } catch {
    res.statusCode = 400;
    res.end('Bad request.');
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api') && !path.startsWith('/v1')) {
    const file = staticFile(path === '/' ? '/console.html' : path);
    if (file) {
      const body = readFileSync(file);
      res.statusCode = 200;
      res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
      res.setHeader('cache-control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
  }
  handle(req, res).catch(err => {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Investigation API failed.' }));
  });
}).listen(port, host, () => {
  console.log(`Analyst console and API at http://${host}:${port}`);
});
