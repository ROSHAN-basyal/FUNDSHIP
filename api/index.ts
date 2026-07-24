import type { Request, Response } from 'express';
import app from '../server/index.js';

const forwardedPathKey = '__fundship_path';

export default function handler(req: Request, res: Response) {
  const url = new URL(req.url || '/api', 'https://fundship.local');
  const forwardedPath = url.searchParams.get(forwardedPathKey) || '';
  url.searchParams.delete(forwardedPathKey);
  const query = url.searchParams.toString();
  req.url = `/api/${forwardedPath}${query ? `?${query}` : ''}`;
  return app(req, res);
}
