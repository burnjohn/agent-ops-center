export interface Config {
  readonly databaseUrl: string;
  readonly port: number;
  readonly host: '127.0.0.1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required but not set');
  }
  const rawPort = env['PORT'];
  const port = rawPort === undefined || rawPort === '' ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  return { databaseUrl, port, host: '127.0.0.1' };
}

/** `host:port/db` of a connection string, never including credentials. */
export function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const port = url.port === '' ? '5432' : url.port;
    return `${url.hostname}:${port}/${decodeURIComponent(url.pathname.replace(/^\//, ''))}`;
  } catch {
    return '<invalid DATABASE_URL>';
  }
}
