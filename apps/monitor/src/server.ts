import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import type { StatsSource } from './source';

const STATS_ROUTE = '/stats';
const REPORT_ROUTE = '/report';
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const INDEX_FILE = 'index.html';

export interface MonitorServerOptions {
  readonly port: number;
  readonly staticDir: string;
  readonly source: StatsSource;
}

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': CONTENT_TYPES['.json'] });
  res.end(payload);
}

function resolveStaticFile(staticDir: string, urlPath: string): string | null {
  const relative = urlPath === '/' ? INDEX_FILE : urlPath.replace(/^\/+/, '');
  const candidate = normalize(join(staticDir, relative));
  if (!candidate.startsWith(staticDir)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const fallback = join(staticDir, INDEX_FILE);
  return existsSync(fallback) ? fallback : null;
}

function serveStatic(res: ServerResponse, staticDir: string, urlPath: string): void {
  const file = resolveStaticFile(staticDir, urlPath);
  if (file === null) {
    res.writeHead(404, { 'Content-Type': CONTENT_TYPES['.html'] });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? DEFAULT_CONTENT_TYPE });
  createReadStream(file).pipe(res);
}

function handle(req: IncomingMessage, res: ServerResponse, options: MonitorServerOptions): void {
  applyCors(res);
  const urlPath = (req.url ?? '/').split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  if (urlPath === STATS_ROUTE) {
    sendJson(res, 200, options.source.read());
    return;
  }
  if (urlPath === REPORT_ROUTE) {
    sendJson(res, 200, options.source.readReport());
    return;
  }
  serveStatic(res, resolve(options.staticDir), urlPath);
}

export function startMonitorServer(options: MonitorServerOptions): Server {
  const staticDir = resolve(options.staticDir);
  const server = createServer((req, res) => handle(req, res, { ...options, staticDir }));
  server.listen(options.port);
  return server;
}
