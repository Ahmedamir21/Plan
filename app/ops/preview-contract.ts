import { SafeError } from '../server/errors';
export const REPOSITORY = 'Ahmedamir21/Plan';
export const BRANCH = 'arena/cd36c549-plan';
export const PREVIEW_ACK = 'Plan isolated preview only';
export const PROJECT_SETTINGS = {
  rootDirectory: 'app',
  framework: null,
  buildCommand: 'npm run build',
  installCommand: 'npm ci',
  outputDirectory: 'dist',
  nodeVersion: '22.x',
  sourceFilesOutsideRootDirectory: true,
  commandForIgnoringBuildStep: 'test "$VERCEL_ENV" = "production"',
};
export const PREVIEW_SAFEGUARDS = {
  PLANORA_SQL_CUTOVER_APPROVED: 'false',
  PLANORA_SELF_SERVICE_ENABLED: 'false',
  PLANORA_EMAIL_MODE: 'disabled',
  PLANORA_EMAIL_LIVE_APPROVED: 'false',
  PLANORA_SECURITY_MAIL_ENABLED: 'false',
  PLANORA_REPORT_MAIL_WEBHOOK_URL: '',
  PLANORA_REPORT_MAIL_WEBHOOK_SECRET: '',
  PLANORA_LOCAL_DB: 'false',
};
export function assertPreviewJob(env: NodeJS.ProcessEnv) {
  if (
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== `refs/heads/${BRANCH}` ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.PLAN_PREVIEW_ACK !== PREVIEW_ACK ||
    !env.GITHUB_SHA ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)
  )
    throw new SafeError('PREVIEW_REQUIRES_APPROVED_PLAN_PR_JOB');
  if (
    env.PLANORA_SQL_CUTOVER_APPROVED === 'true' ||
    env.PLANORA_SELF_SERVICE_ENABLED === 'true' ||
    ['resend', 'resend-test'].includes(env.PLANORA_EMAIL_MODE || '')
  )
    throw new SafeError('PREVIEW_LIVE_FEATURES_FORBIDDEN');
}
export function assertGithubIdentity(repository: any, pr: any, sha: string) {
  if (
    repository?.full_name !== REPOSITORY ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    pr?.number !== 2 ||
    pr.state !== 'open' ||
    pr.merged ||
    pr.base?.repo?.full_name !== REPOSITORY ||
    pr.head?.repo?.full_name !== REPOSITORY ||
    pr.head?.ref !== BRANCH ||
    pr.head?.sha !== sha
  )
    throw new SafeError('PREVIEW_PR_REPOSITORY_OR_COMMIT_MISMATCH');
}
export function assertProject(project: any, repositoryId: number) {
  if (
    !project?.id ||
    !['github', 'github-limited'].includes(project.link?.type) ||
    project.link.org?.toLowerCase() !== 'ahmedamir21' ||
    project.link.repo?.toLowerCase() !== 'plan' ||
    String(project.link.repoId) !== String(repositoryId)
  )
    throw new SafeError('VERCEL_PROJECT_NOT_LINKED_TO_PLAN');
  if (project.link.productionBranch === BRANCH)
    throw new SafeError('PREVIEW_BRANCH_IS_CONFIGURED_AS_PRODUCTION');
}
export function assertProjectSettings(project: any) {
  for (const [key, value] of Object.entries(PROJECT_SETTINGS))
    if (project[key] !== value)
      throw new SafeError('VERCEL_PREVIEW_SETTINGS_REQUIRE_REVIEW', 409, [key]);
}
export function assertDeployment(
  deployment: any,
  projectId: string,
  repositoryId: number,
  sha: string,
  ready = false
) {
  const source = deployment?.gitSource;
  if (
    deployment?.projectId !== projectId ||
    (deployment.target != null && deployment.target !== 'preview') ||
    deployment.customEnvironment ||
    !source ||
    !['github', 'github-limited'].includes(source.type) ||
    String(source.repoId) !== String(repositoryId) ||
    source.ref !== BRANCH ||
    source.sha !== sha
  )
    throw new SafeError('DEPLOYMENT_REPOSITORY_BRANCH_OR_SHA_MISMATCH');
  if (ready && deployment.readyState !== 'READY')
    throw new SafeError('PREVIEW_NOT_READY');
  if (
    typeof deployment.url !== 'string' ||
    !/^[-a-z0-9.]+\.vercel\.app$/i.test(deployment.url)
  )
    throw new SafeError('INVALID_PREVIEW_DEPLOYMENT_URL');
  return `https://${deployment.url}`;
}
export function previewVariables(values: Record<string, string>) {
  return Object.entries({ ...values, ...PREVIEW_SAFEGUARDS }).map(
    ([key, value]) => ({
      key,
      value,
      type: 'encrypted',
      target: ['preview'],
      gitBranch: BRANCH,
      comment: 'Plan PR #2 isolated preview. No production variables.',
    })
  );
}
/** Neon direct owner + restricted runtime may use its pooler, but must address the SAME DB. */
export function previewDatabaseUrls(ownerValue: string, runtimeValue: string) {
  let owner: URL, runtime: URL;
  try {
    owner = new URL(ownerValue);
    runtime = new URL(runtimeValue);
  } catch {
    throw new SafeError('INVALID_PREVIEW_DATABASE_URL');
  }
  const normalizeHost = (u: URL) => u.hostname.replace('-pooler.', '.');
  if (
    ![owner, runtime].every(
      (u) =>
        ['postgres:', 'postgresql:'].includes(u.protocol) &&
        u.hostname.endsWith('.neon.tech') &&
        u.username &&
        u.password &&
        u.pathname.length > 1
    ) ||
    owner.hostname.includes('-pooler.') ||
    normalizeHost(owner) !== normalizeHost(runtime) ||
    owner.pathname !== runtime.pathname ||
    owner.username === runtime.username ||
    !/^plan_preview_[a-z0-9_]{1,32}$/.test(decodeURIComponent(runtime.username))
  )
    throw new SafeError('PREVIEW_REQUIRES_ISOLATED_NEON_OWNER_AND_RUNTIME');
  return { owner, runtime, role: decodeURIComponent(runtime.username) };
}
