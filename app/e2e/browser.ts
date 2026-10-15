import chromiumBinary, {
  inflate,
  setupLambdaEnvironment,
} from '@sparticuz/chromium';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
/** Packaged headless Chromium: no browser download, user profile, screenshots or trace files. */
export async function openBrowser() {
  const libs = await inflate(
    fileURLToPath(
      new URL(
        '../bin/al2023.tar.br',
        import.meta.resolve('@sparticuz/chromium')
      )
    )
  );
  setupLambdaEnvironment(join(libs, 'lib'));
  const args = chromiumBinary.args.filter(
    (arg) =>
      ![
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--disable-site-isolation-trials',
        '--single-process',
      ].includes(arg) && !arg.startsWith('--disable-features=')
  );
  return chromium.launch({
    executablePath: await chromiumBinary.executablePath(),
    args,
    headless: true,
  });
}
export async function restrictBrowser(
  context: BrowserContext,
  origin: string,
  headers: Record<string, string> = {}
) {
  const blocked: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blocked.push(url.origin);
      await route.abort();
      return;
    }
    // Never attach a protection-bypass capability to a different origin.
    await route.continue({
      headers: { ...route.request().headers(), ...headers },
    });
  });
  return blocked;
}
