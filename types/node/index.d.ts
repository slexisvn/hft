declare module 'node:fs' {
  export interface ReadStreamLike {
    pipe<T>(destination: T): T;
  }
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding?: 'utf8'): void;
  export function appendFileSync(path: string, data: string, encoding?: 'utf8'): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  export function createReadStream(path: string): ReadStreamLike;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function normalize(p: string): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export const sep: string;
}

declare module 'node:http' {
  export interface IncomingMessage {
    url?: string;
    method?: string;
  }
  export interface ServerResponse {
    setHeader(name: string, value: string): void;
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  }
  export interface Server {
    listen(port: number): Server;
    close(callback?: () => void): void;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:perf_hooks' {
  export const performance: { now(): number };
}

declare class Buffer {
  toString(encoding: 'utf8'): string;
}

declare module 'node:crypto' {
  export function createHmac(
    algorithm: string,
    key: string,
  ): { update(data: string): { digest(encoding: 'hex'): string } };
}

declare module 'node:https' {
  interface IncomingLike {
    statusCode?: number;
    on(event: 'data', callback: (chunk: Buffer) => void): void;
    on(event: 'end', callback: () => void): void;
  }
  interface ClientRequestLike {
    on(event: 'error', callback: (err: Error) => void): void;
    end(): void;
  }
  export function request(
    url: string,
    options: { method: string; headers: Record<string, string> },
    callback: (res: IncomingLike) => void,
  ): ClientRequestLike;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
  exit(code?: number): never;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  cwd(): string;
  hrtime: { bigint(): bigint };
  memoryUsage(): { heapUsed: number; rss: number };
};

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

declare const __dirname: string;
declare const __filename: string;

declare function setTimeout(cb: () => void, ms: number): { unref(): unknown };
declare function clearTimeout(handle: unknown): void;
declare function setInterval(cb: () => void, ms: number): { unref(): unknown };
declare function clearInterval(handle: unknown): void;
