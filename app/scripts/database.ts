import { readFile } from 'node:fs/promises';
import { database, activeTerm } from '../server/db';
import { migrate } from '../server/migrations';
import { importCatalog, getCatalog } from '../server/catalog-repository';
import { readFixtures } from '../server/fixtures';
import { counts, datasetHash, normalizeDataset } from '../server/catalog-model';
import { SafeError, errorCode } from '../server/errors';

const action = process.argv[2];
let db;
try {
  if (action === 'local-seed') {
    if (
      process.env.DATABASE_URL ||
      process.env.VERCEL ||
      process.env.NODE_ENV === 'production'
    )
      throw new SafeError('LOCAL_SEED_REQUIRES_ISOLATED_CONFIGURATION');
    process.env.PLANORA_LOCAL_DB = 'true';
  }
  db = await database();
  if (action === 'migrate' || action === 'local-seed')
    console.log(JSON.stringify({ migrations: await migrate(db) }));
  if (action === 'import' || action === 'local-seed') {
    // Require explicit attestation; this command never guesses whether Redis contains newer edits.
    const inputFile = process.argv
      .find((a) => a.startsWith('--input='))
      ?.slice(8);
    if (
      action !== 'local-seed' &&
      !inputFile &&
      !process.argv.includes('--fixtures-reviewed')
    )
      throw new SafeError('REVIEW_REDIS_LIVE_OVERRIDES_FIRST');
    if (inputFile && !inputFile.includes('private-exports/'))
      throw new SafeError('IMPORT_FILE_MUST_BE_IN_IGNORED_PRIVATE_EXPORTS');
    const input = inputFile
      ? JSON.parse(await readFile(inputFile, 'utf8'))
      : await readFixtures();
    const checked = normalizeDataset(input); // Validate before any writes.
    const result = await importCatalog(db, checked.dataset);
    console.log(
      JSON.stringify(
        {
          ...result,
          rejected: 0,
          source: inputFile ? 'reviewed-export' : 'reviewed-fixtures',
        },
        null,
        2
      )
    );
  } else if (action === 'verify') {
    const catalog = await getCatalog(db, activeTerm());
    normalizeDataset(catalog.dataset);
    if (datasetHash(catalog.dataset) !== catalog.hash)
      throw new SafeError('CATALOG_CHECKSUM_MISMATCH');
    console.log(
      JSON.stringify(
        {
          verified: true,
          revision: catalog.revision,
          ...counts(catalog.dataset),
        },
        null,
        2
      )
    );
  } else if (action !== 'migrate')
    throw new SafeError('UNKNOWN_DATABASE_COMMAND');
} catch (error) {
  console.error(
    JSON.stringify({
      error: errorCode(error),
      rejected: error instanceof SafeError ? error.details : [],
      published: false,
    })
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
