/** Local/test adapter for the SAME Vercel handlers, never a production HTTP server. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import catalog from '../api/catalog';
import deployment from '../api/deployment';
import admin from '../api/admin';
import changes from '../api/changes';
import notifications from '../api/notifications';
import assistant from '../api/assistant';
import feedback from '../api/feedback';
import reports from '../api/reports';
import retiredSync from '../api/sync-ingest';
const routes: Record<string, (req: any, res: any) => unknown> = {
  '/api/deployment': deployment,
  '/api/catalog': catalog,
  '/api/admin': admin,
  '/api/changes': changes,
  '/api/notifications': notifications,
  '/api/assistant': assistant,
  '/api/feedback': feedback,
  '/api/reports': reports,
  '/api/sync-ingest': retiredSync,
};
export function apiServer(
  options: {
    staticDirectory?: string;
    observe?: (method: string, path: string) => void;
  } = {}
) {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production')
    throw new Error('LOCAL_SERVER_FORBIDDEN_IN_PRODUCTION');
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://local.invalid');
    options.observe?.(req.method || 'GET', url.pathname);
    res.setHeader('Cache-Control', 'no-store');
    const handler = routes[url.pathname];
    if (
      !handler &&
      options.staticDirectory &&
      req.method === 'GET' &&
      !url.pathname.startsWith('/api/')
    ) {
      const directory = resolve(options.staticDirectory);
      const path = resolve(
        directory,
        `.${url.pathname === '/' ? '/index.html' : url.pathname}`
      );
      if (path.startsWith(directory + sep)) {
        try {
          const data = await readFile(path);
          const types: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.webmanifest': 'application/manifest+json',
          };
          res.setHeader(
            'Content-Type',
            types[extname(path)] || 'application/octet-stream'
          );
          res.end(data);
          return;
        } catch {
          /* Not found; no filesystem detail returned. */
        }
      }
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
        Object.assign(req, {
          query: Object.fromEntries(url.searchParams),
          body,
        }),
        wrapped
      );
    } catch {
      if (!res.headersSent)
        wrapped.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
      else res.end();
    }
  });
}
