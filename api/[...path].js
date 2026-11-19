// Deploy adapter. The backend implementation is in backend/src/.
import { handle } from '../backend/bundle.js';

export default function handler(req, res) {
  // The pilot UI has no authenticated session yet. Keep case data local until
  // production authentication and tenant isolation are implemented.
  if (process.env.VERCEL) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'The investigation API is available locally only until pilot authentication is configured.' }));
    return;
  }
  return handle(req, res);
}
