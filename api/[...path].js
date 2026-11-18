// Deploy adapter. The readable API is in api-src/. This file imports the bundle that `npm run build` writes to api-src/bundle.js.
import { handle } from '../api-src/bundle.js';

export default function handler(req, res) {
  return handle(req, res);
}
