import { randomBytes } from 'node:crypto';
import { SafeError } from '../server/errors';
import {
  assertProject,
  assertProjectSettings,
  assertDeployment,
  previewVariables,
  PROJECT_SETTINGS,
  REPOSITORY,
  BRANCH,
} from './preview-contract';
/** Server/Actions-only client. Fixed Vercel origin; no token or provider body in an error/log. */
export class VercelPreview {
  constructor(
    private token: string,
    private teamId: string | undefined,
    private fetchImpl: typeof fetch = fetch
  ) {}
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
    missing = false
  ): Promise<any> {
    const url = new URL(path, 'https://api.vercel.com');
    if (this.teamId) url.searchParams.set('teamId', this.teamId);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new SafeError('VERCEL_REQUEST_OUTCOME_UNKNOWN');
    }
    if (missing && response.status === 404) return null;
    if (!response.ok)
      throw new SafeError(`VERCEL_REQUEST_FAILED_${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new SafeError('VERCEL_RESPONSE_INVALID');
    }
  }
  async project(repositoryId: number, approvedProjectId?: string) {
    // IDs are supplied by the operator or retrieved from a Vercel response, never invented.
    const name = `plan-${repositoryId}-preview`;
    let project = await this.request(
      `/v9/projects/${encodeURIComponent(approvedProjectId || name)}`,
      'GET',
      undefined,
      true
    );
    if (!project) {
      if (approvedProjectId)
        throw new SafeError('APPROVED_VERCEL_PROJECT_NOT_FOUND');
      const {
        nodeVersion,
        sourceFilesOutsideRootDirectory,
        ...createSettings
      } = PROJECT_SETTINGS;
      project = await this.request('/v11/projects', 'POST', {
        name,
        gitRepository: { type: 'github', repo: REPOSITORY },
        ...createSettings,
      });
      assertProject(project, repositoryId);
      await this.request(
        `/v9/projects/${encodeURIComponent(project.id)}`,
        'PATCH',
        {
          nodeVersion,
          sourceFilesOutsideRootDirectory,
          autoExposeSystemEnvs: true,
        }
      );
      project = await this.request(
        `/v9/projects/${encodeURIComponent(project.id)}`
      );
    }
    assertProject(project, repositoryId);
    assertProjectSettings(project);
    return { id: project.id, name: project.name };
  }
  async configure(
    projectId: string,
    repositoryId: number,
    values: Record<string, string>
  ) {
    const project = await this.request(
      `/v9/projects/${encodeURIComponent(projectId)}`
    );
    assertProject(project, repositoryId);
    assertProjectSettings(project);
    const result = await this.request(
      `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`,
      'POST',
      previewVariables(values)
    );
    const created = Array.isArray(result.created)
      ? result.created
      : [result.created];
    const expected = previewVariables(values);
    if (
      result.error ||
      !Array.isArray(result.failed) ||
      result.failed.length ||
      !expected.every((value) =>
        created.some(
          (item: any) =>
            item?.key === value.key &&
            item.gitBranch === BRANCH &&
            Array.isArray(item.target) &&
            item.target.length === 1 &&
            item.target[0] === 'preview'
        )
      )
    )
      throw new SafeError('VERCEL_PREVIEW_VARIABLE_UPDATE_FAILED');
  }
  async deploy(
    project: { id: string; name: string },
    repositoryId: number,
    sha: string
  ) {
    const verified = await this.request(
      `/v9/projects/${encodeURIComponent(project.id)}`
    );
    assertProject(verified, repositoryId);
    assertProjectSettings(verified);
    // Omitting target explicitly means preview in Vercel's API. No aliases or promotion call.
    const deployment = await this.request('/v13/deployments', 'POST', {
      project: project.id,
      name: project.name,
      gitSource: { type: 'github', repoId: repositoryId, ref: BRANCH, sha },
      projectSettings: PROJECT_SETTINGS,
    });
    if (!deployment.id) throw new SafeError('INVALID_VERCEL_DEPLOYMENT_ID');
    return deployment.id as string;
  }
  async withAutomationAccess<T>(
    projectId: string,
    repositoryId: number,
    fn: (secret: string) => Promise<T>
  ): Promise<T> {
    const project = await this.request(
      `/v9/projects/${encodeURIComponent(projectId)}`
    );
    assertProject(project, repositoryId);
    assertProjectSettings(project);
    const secret = randomBytes(16).toString('hex');
    try {
      const result = await this.request(
        `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`,
        'PATCH',
        { generate: { secret, note: 'Temporary Plan PR 2 acceptance test' } }
      );
      if (result.protectionBypass?.[secret]?.scope !== 'automation-bypass')
        throw new SafeError('VERCEL_AUTOMATION_ACCESS_NOT_CONFIRMED');
      return await fn(secret);
    } finally {
      // Revoke only this runner's generated capability, never existing protection/access.
      await this.request(
        `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`,
        'PATCH',
        { revoke: { secret, regenerate: false } }
      );
    }
  }
  async waitForPreview(
    id: string,
    projectId: string,
    repositoryId: number,
    sha: string,
    wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms))
  ) {
    for (let i = 0; i < 90; i++) {
      const deployment = await this.request(
        `/v13/deployments/${encodeURIComponent(id)}`
      );
      if (deployment.id !== id)
        throw new SafeError('VERCEL_DEPLOYMENT_ID_MISMATCH');
      // Scope is checked even while building, not only once READY.
      assertDeployment(deployment, projectId, repositoryId, sha);
      if (['ERROR', 'CANCELED'].includes(deployment.readyState))
        throw new SafeError('VERCEL_PREVIEW_BUILD_FAILED');
      if (deployment.readyState === 'READY')
        return {
          id,
          url: assertDeployment(deployment, projectId, repositoryId, sha, true),
          repository: REPOSITORY,
          branch: BRANCH,
          sha,
          projectId,
          target: 'preview',
        };
      await wait(10000);
    }
    throw new SafeError('VERCEL_PREVIEW_READINESS_TIMEOUT');
  }
}
