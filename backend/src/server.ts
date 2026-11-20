import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { handle } from './http';

const port = Number(process.env.PORT || 8787);
const consolePage = join(process.cwd(), 'console', 'index.html');
createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/' || path === '/console') && existsSync(consolePage)) {
    const html = readFileSync(consolePage);
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }
  handle(req, res).catch(err => {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Investigation API failed.' }));
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Analyst console and API at http://127.0.0.1:${port}`);
});
