// Vercel Serverless API entrypoint. The backend implementation is in backend/src/.
import { ensureServerlessBoot, handle } from '../backend/bundle.js';

export default async function handler(req, res) {
  if (process.env.VERCEL) {
    ensureServerlessBoot();
  }
  const url = new URL(req.url || '/api', 'http://localhost');
  if (url.pathname === '/api/index' || url.pathname === '/api') {
    const p = url.searchParams.get('__mre_path');
    if (p !== null) {
      url.searchParams.delete('__mre_path');
      const qs = url.searchParams.toString();
      req.url = `/api/${p.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
    }
  }
  return handle(req, res);
}
