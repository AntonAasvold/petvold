/**
 * The demo's settings from the environment, with defaults for the local
 * environment (docs/teknik/demotjanst.md, the table of settings).
 */
export interface Config {
  petvoldApiUrl: string;
  backofficeUrl: string;
  port: number;
  /** The address Petvold sends webhooks to, without the path. */
  publicUrl: string;
  basePath: string;
  /** A Postgres URL, or 'memory'. */
  databaseUrl: string;
  integrationToken: string;
}

export function configFromEnv(env: Record<string, string | undefined>): Config {
  const port = Number(env.DEMO_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DEMO_PORT must be a port number');
  const basePath = env.DEMO_BASE_PATH?.trim() || '/';
  if (!basePath.startsWith('/')) throw new Error('DEMO_BASE_PATH must start with /');
  return {
    petvoldApiUrl: env.PETVOLD_API_URL?.trim() || 'http://localhost:8787',
    backofficeUrl: env.PETVOLD_BACKOFFICE_URL?.trim() || 'http://localhost:5180',
    port,
    publicUrl: (env.DEMO_PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/$/, ''),
    basePath,
    databaseUrl: env.DEMO_DATABASE_URL?.trim() || 'postgres://petvold:petvold@127.0.0.1:5432/petvold_demo?sslmode=disable',
    integrationToken: env.DEMO_INTEGRATION_TOKEN?.trim() || 'dev-integration',
  };
}
