import type { NextApiRequest, NextApiResponse } from 'next';

// Public health endpoint — no authentication required.
// Safe for Cloudflare Tunnel / load-balancer probes.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ status: 'ok' });
}
