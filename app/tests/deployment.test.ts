import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProductionConfig } from '../scripts/check-production-config.mjs';
test('production is blocked until explicit SQL cutover approval; no migration runs in the build', () => {
  assert.doesNotThrow(() => checkProductionConfig({}));
  assert.throws(
    () => checkProductionConfig({ VERCEL_ENV: 'production' }),
    /cutover blocked/
  );
  const env: any = {
    VERCEL_ENV: 'production',
    DATABASE_URL: 'configured',
    PLANORA_TERM_KEY: 'fall-2026-main',
    PLANORA_ADMIN_SESSION_SECRET: 'configured',
    PLANORA_ADMIN_AHMED_PASSWORD_HASH: 'configured',
    PLANORA_ADMIN_YOUSSEF_PASSWORD_HASH: 'configured',
    UPSTASH_REDIS_REST_URL: 'configured',
    UPSTASH_REDIS_REST_TOKEN: 'configured',
  };
  assert.throws(
    () => checkProductionConfig(env),
    /PLANORA_SQL_CUTOVER_APPROVED/
  );
  assert.doesNotThrow(() =>
    checkProductionConfig({ ...env, PLANORA_SQL_CUTOVER_APPROVED: 'true' })
  );
  assert.throws(
    () =>
      checkProductionConfig({
        ...env,
        PLANORA_SQL_CUTOVER_APPROVED: 'true',
        PLANORA_LOCAL_DB: 'true',
      }),
    /verified TLS/
  );
});
