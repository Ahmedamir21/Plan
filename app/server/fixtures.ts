/** CLI/test-only. No browser or production API imports this module. */
import { readFile } from 'node:fs/promises';
export const fixtureDirectory = new URL(
  '../../Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail/src/semester/',
  import.meta.url
);
export async function readFixtures() {
  const pairs = await Promise.all(
    ['semester', 'courses', 'sch', 'majors'].map(async (key) => [
      key,
      JSON.parse(
        await readFile(new URL(`${key}.json`, fixtureDirectory), 'utf8')
      ),
    ])
  );
  return Object.fromEntries(pairs);
}
