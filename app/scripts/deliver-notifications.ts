import { database } from '../server/db';
import { deliverNotifications } from '../server/notifications';
import { errorCode } from '../server/errors';
let db;
try {
  db = await database();
  const result = await deliverNotifications(db);
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch (error) {
  console.error(errorCode(error));
  process.exitCode = 1;
} finally {
  await db?.close();
}
