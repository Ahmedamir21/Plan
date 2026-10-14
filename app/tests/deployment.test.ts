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

test('workflow working directories preserve the actual nested planner root', async () => {
  const { readFile, stat } = await import('node:fs/promises');
  const workflow = await readFile(
    new URL('../../.github/workflows/planner-ci.yml', import.meta.url),
    'utf8'
  );
  const directories = [
    ...workflow.matchAll(/^\s+working-directory: (.+)$/gm),
  ].map((match) => match[1].trim());
  assert(directories.length > 0);
  for (const directory of directories) {
    const file = new URL(`../../${directory}/package.json`, import.meta.url);
    assert(
      (await stat(file)).isFile(),
      `CI working directory is not a planner package: ${directory}`
    );
    assert.equal(
      JSON.parse(await readFile(file, 'utf8')).name,
      'react-vite-tailwind'
    );
  }
});
