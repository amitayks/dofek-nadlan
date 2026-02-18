import type { PipelineError } from '../types';

interface TriggerResult {
  triggered: boolean;
  error?: PipelineError;
}

export async function triggerGitHubAction(
  githubToken: string,
  runId: string
): Promise<TriggerResult> {
  // These should be configured — using env vars or constants
  // For now, they need to be set in wrangler.toml or as secrets
  const owner = 'ozkeisar';
  const repo = 'Klikat';
  const workflowFile = 'pipeline.yml';

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          run_id: runId,
        },
      }),
    });

    if (response.status === 204) {
      console.log(`Triggered GitHub Action for run ${runId}`);
      return { triggered: true };
    }

    if (response.status === 429 || response.status === 403) {
      const errMsg = `GitHub API rate limited: ${response.status}`;
      console.error(errMsg);
      return {
        triggered: false,
        error: {
          phase: 'trigger',
          error_message: errMsg,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const body = await response.text();
    const errMsg = `GitHub API error ${response.status}: ${body}`;
    console.error(errMsg);
    return {
      triggered: false,
      error: {
        phase: 'trigger',
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      triggered: false,
      error: {
        phase: 'trigger',
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
