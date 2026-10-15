import { activeTerm, database } from '../server/db.js';
import { SafeError, respondError } from '../server/errors.js';
const categories = [
  'course_added',
  'course_removed',
  'course_modified',
  'section_added',
  'section_removed',
  'section_modified',
  'metadata_modified',
];
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  try {
    const term = req.query?.term ?? activeTerm(),
      search = req.query?.q ?? '',
      category = req.query?.category ?? '';
    const page = Number(req.query?.page ?? 0);
    if (
      typeof term !== 'string' ||
      !/^[a-z0-9-]{1,100}$/.test(term) ||
      typeof search !== 'string' ||
      search.length > 100 ||
      typeof category !== 'string' ||
      (category && !categories.includes(category)) ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 10000
    )
      throw new SafeError('INVALID_CHANGE_FILTER');
    const result = await (
      await database()
    ).query(
      `SELECT * FROM planora.public_changes WHERE term_key=$1
      AND ($2='' OR strpos(lower(coalesce(course_code,'')||' '||coalesce(course_title,'')),lower($2))>0)
      AND ($3='' OR category=$3) ORDER BY published_at DESC,id DESC LIMIT 51 OFFSET $4`,
      [term, search, category, page * 50]
    );
    return res
      .status(200)
      .json({
        changes: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
        page,
        term,
        verified: true,
      });
  } catch (error) {
    return respondError(res, error);
  }
}
