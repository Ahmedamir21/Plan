import { activeTerm, database } from '../server/db';
import { getCatalog } from '../server/catalog-repository';
import { SafeError, respondError } from '../server/errors';
export type CatalogFile = 'courses.json' | 'sch.json';
export const isCatalogFile = (file: unknown): file is CatalogFile =>
  file === 'courses.json' || file === 'sch.json';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  try {
    const term = req.query?.term ?? activeTerm();
    if (typeof term !== 'string' || !/^[a-z0-9-]{1,100}$/.test(term))
      throw new SafeError('INVALID_TERM');
    const catalog = await getCatalog(await database(), term);
    const filter = req.query?.catalog;
    if (filter !== undefined && !['courses', 'sch'].includes(filter))
      throw new SafeError('INVALID_CATALOG');
    if (req.query?.courseId !== undefined) {
      if (
        typeof req.query.courseId !== 'string' ||
        req.query.courseId.length > 100
      )
        throw new SafeError('INVALID_COURSE');
      const found = [...catalog.dataset.courses, ...catalog.dataset.sch].find(
        (c) => c.id === req.query.courseId
      );
      if (!found) throw new SafeError('COURSE_NOT_FOUND', 404);
      return res
        .status(200)
        .json({
          course: found,
          term,
          revision: catalog.revision,
          source: 'postgresql',
        });
    }
    return res
      .status(200)
      .json({
        ...catalog.dataset,
        ...(filter ? { [filter === 'sch' ? 'courses' : 'sch']: [] } : {}),
        revision: catalog.revision,
        publishedAt: catalog.publishedAt,
        hash: catalog.hash,
        source: 'postgresql',
        schemaVersion: 1,
      });
  } catch (error) {
    return respondError(res, error);
  }
}
