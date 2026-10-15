import { SafeError } from '../server/errors';
import { REPOSITORY } from './preview-contract';
const BIND = `local old=redis.call('GET',KEYS[1])
if old then if old==ARGV[1] then return 1 else return -1 end end
if redis.call('DBSIZE')~=0 then return -2 end
redis.call('SET',KEYS[1],ARGV[1]); return 1`;
export async function bindPreviewRedis(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch
) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeError('INVALID_PREVIEW_REDIS_URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname.endsWith('.upstash.io') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  )
    throw new SafeError('INVALID_PREVIEW_REDIS_URL');
  let response: Response;
  try {
    response = await fetchImpl(parsed, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        'EVAL',
        BIND,
        1,
        'plan:preview:repository-binding:v1',
        `${REPOSITORY}:preview`,
      ]),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new SafeError('PREVIEW_REDIS_UNAVAILABLE');
  }
  if (!response.ok) throw new SafeError('PREVIEW_REDIS_UNAVAILABLE');
  const data = await response.json().catch(() => null);
  if (data?.result !== 1)
    throw new SafeError('PREVIEW_REDIS_NOT_EMPTY_OR_NOT_BOUND_TO_PLAN');
}
