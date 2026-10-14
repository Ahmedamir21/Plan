/** Explicit read-only cutover tool; writes private academic export, never credentials or personal schedules. */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFixtures } from '../server/fixtures';
import { normalizeDataset, counts, datasetHash } from '../server/catalog-model';
import { redis, storageConfigured } from '../server/admin-store';
import { SafeError, errorCode } from '../server/errors';
try {
  if (!storageConfigured()) throw new SafeError('REDIS_NOT_CONFIGURED');
  const data = await readFixtures();
  for (const file of ['courses', 'sch']) {
    const raw = await redis(['GET', `planora:admin:live:v1:${file}.json`]);
    if (raw !== null) data[file] = JSON.parse(raw);
  }
  const { dataset, warnings } = normalizeDataset(data);
  await mkdir(new URL('../private-exports/', import.meta.url), {
    recursive: true,
    mode: 0o700,
  });
  const filename = new URL(
    `../private-exports/catalog-${Date.now()}.json`,
    import.meta.url
  );
  await writeFile(filename, JSON.stringify(dataset, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      file: filename.pathname.split('/').slice(-2).join('/'),
      ...counts(dataset),
      hash: datasetHash(dataset),
      warnings,
    })
  );
} catch (error) {
  console.error(errorCode(error));
  process.exitCode = 1;
}
