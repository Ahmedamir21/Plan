/** Local Node adapter for the existing Vercel handlers; Vite proxies relative /api URLs here. */
import { createServer } from 'node:http';
import catalog from '../api/catalog';
import admin from '../api/admin';
import changes from '../api/changes';
import notifications from '../api/notifications';
import assistant from '../api/assistant';
import feedback from '../api/feedback';
import reports from '../api/reports';
import retiredSync from '../api/sync-ingest';
if (process.env.NODE_ENV === 'production' || process.env.VERCEL)
  throw new Error('LOCAL_SERVER_FORBIDDEN_IN_PRODUCTION');
const routes: Record<string, (req: any, res: any) => unknown> = {
  '/api/catalog': catalog,
  '/api/admin': admin,
  '/api/changes': changes,
  '/api/notifications': notifications,
  '/api/assistant': assistant,
  '/api/feedback': feedback,
  '/api/reports': reports,
  '/api/sync-ingest': retiredSync,
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://local.invalid'),
    handler = routes[url.pathname];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!handler) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }
  const wrapped = Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return wrapped;
    },
    json(data: unknown) {
      res.end(JSON.stringify(data));
      return wrapped;
    },
  });
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 300000) {
        wrapped.status(413).json({ error: 'REQUEST_TOO_LARGE' });
        return;
      }
      chunks.push(part);
    }
    let body;
    try {
      body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
        : undefined;
    } catch {
      wrapped.status(400).json({ error: 'INVALID_JSON' });
      return;
    }
    await handler(
      Object.assign(req, { query: Object.fromEntries(url.searchParams), body }),
      wrapped
    );
  } catch {
    if (!res.headersSent)
      wrapped.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
    else res.end();
  }
});
server.listen(3001, '0.0.0.0', () =>
  console.log(
    'Local planner API listening on port 3001. No external jobs or emails are started.'
  )
);
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
