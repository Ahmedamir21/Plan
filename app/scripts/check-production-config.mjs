/** Deployment gate only: no connections, migrations, account access or emails. */
export function checkProductionConfig(env) {
  if (env.VERCEL_ENV !== 'production') return;
  const missing = [
    'DATABASE_URL',
    'PLANORA_TERM_KEY',
    'PLANORA_ADMIN_SESSION_SECRET',
    'PLANORA_ADMIN_AHMED_PASSWORD_HASH',
    'PLANORA_ADMIN_YOUSSEF_PASSWORD_HASH',
  ].filter((name) => !env[name]);
  if (
    !(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) &&
    !(env.KV_REST_API_URL && env.KV_REST_API_TOKEN)
  )
    missing.push('private Redis configuration');
  if (env.PLANORA_SQL_CUTOVER_APPROVED !== 'true')
    missing.push(
      'PLANORA_SQL_CUTOVER_APPROVED (set only after the migration and preview review)'
    );
  if (env.PLANORA_LOCAL_DB === 'true' || env.DATABASE_SSL === 'disable')
    missing.push('production PostgreSQL with verified TLS');
  if (missing.length)
    throw new Error(
      `Production SQL cutover blocked. Configure and verify: ${missing.join(', ')}. Existing deployment should remain in service. No migration was run.`
    );
}
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  try {
    checkProductionConfig(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
