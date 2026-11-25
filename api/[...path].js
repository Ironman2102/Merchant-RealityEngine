// Vercel Serverless API adapter. The backend implementation is in backend/src/.
import { ensureServerlessBoot, handle } from '../backend/bundle.js';

export default async function handler(req, res) {
  if (process.env.VERCEL) {
    ensureServerlessBoot();
  }
  return handle(req, res);
}
