const DEFAULT_BASE = 'postgres://agent_ops:agent_ops@127.0.0.1:5432';

/** Test DB name: one per agent/run via AGENT_OPS_TEST_DB_SUFFIX, never the dev `agent_ops` database. */
export function testDatabaseName(env: NodeJS.ProcessEnv = process.env): string {
  const suffix = (env['AGENT_OPS_TEST_DB_SUFFIX'] ?? 'default').replace(/[^a-zA-Z0-9_]/g, '_');
  return `agent_ops_test_${suffix}`;
}

function baseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env['DATABASE_URL_TEST_BASE'];
  return (raw === undefined || raw.trim() === '' ? DEFAULT_BASE : raw).replace(/\/+$/, '');
}

/** Connection string of the per-run test database. */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${baseUrl(env)}/${testDatabaseName(env)}`;
}

/** Connection string of the maintenance database, used only to CREATE the test database. */
export function adminDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${baseUrl(env)}/postgres`;
}
