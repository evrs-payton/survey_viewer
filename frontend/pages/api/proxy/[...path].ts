import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';

// Internal backend URL — server-side only, never sent to the browser.
const BACKEND = process.env.INTERNAL_API_URL ?? 'http://backend:8000';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { path, ...queryParams } = req.query;
  const segments = Array.isArray(path) ? path.join('/') : (path ?? '');

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(queryParams)) {
    if (Array.isArray(v)) v.forEach(s => qs.append(k, s));
    else if (v !== undefined) qs.set(k, v);
  }

  const url = `${BACKEND}/${segments}${qs.toString() ? `?${qs}` : ''}`;

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      ...(req.method !== 'GET' && req.method !== 'HEAD' && req.body
        ? { body: JSON.stringify(req.body) }
        : {}),
    });

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    res.setHeader('Content-Type', contentType);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);
  } catch {
    res.status(502).json({ error: 'Backend unreachable' });
  }
}
