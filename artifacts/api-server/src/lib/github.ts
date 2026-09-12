import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/**
 * Parses `owner/repo` out of a GitHub repo URL the team gave at check-in.
 * Accepts the usual shapes: with/without protocol, trailing slash, `.git`
 * suffix, or a deep link into a specific file/issue in the repo.
 */
export function parseGithubRepoUrl(url: string): GithubRepoRef | null {
  const match = url.trim().match(
    /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i,
  );
  if (!match) {
    return null;
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

export class GithubIssueError extends Error {}

/**
 * Files a GitHub issue through the authenticated connector proxy.
 * Throws GithubIssueError with a message safe to surface to the moderator.
 */
export async function fileGithubIssue(params: {
  githubUrl: string;
  title: string;
  body: string;
  labels: string[];
}): Promise<{ issueUrl: string; issueNumber: number }> {
  const ref = parseGithubRepoUrl(params.githubUrl);
  if (!ref) {
    throw new GithubIssueError(
      `Could not parse an owner/repo out of "${params.githubUrl}"`,
    );
  }

  const response = await connectors.proxy(
    "github",
    `/repos/${ref.owner}/${ref.repo}/issues`,
    {
      method: "POST",
      body: {
        title: params.title,
        body: params.body,
        labels: params.labels,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, owner: ref.owner, repo: ref.repo, text },
      "Failed to file GitHub issue",
    );
    throw new GithubIssueError(
      `GitHub rejected the issue (${response.status}) for ${ref.owner}/${ref.repo}`,
    );
  }

  const issue = (await response.json()) as {
    html_url: string;
    number: number;
  };
  return { issueUrl: issue.html_url, issueNumber: issue.number };
}

/**
 * Comments on and closes a filed GitHub issue when a ticket is resolved.
 * Best-effort: logs and swallows failures so resolving a ticket in the
 * dashboard never gets blocked by a GitHub-side error.
 */
export async function closeGithubIssue(params: {
  githubUrl: string;
  issueNumber: number;
  comment: string;
}): Promise<void> {
  const ref = parseGithubRepoUrl(params.githubUrl);
  if (!ref) {
    logger.warn(
      { githubUrl: params.githubUrl },
      "Could not parse repo to close GitHub issue",
    );
    return;
  }

  try {
    await connectors.proxy(
      "github",
      `/repos/${ref.owner}/${ref.repo}/issues/${params.issueNumber}/comments`,
      { method: "POST", body: { body: params.comment } },
    );

    const closeResponse = await connectors.proxy(
      "github",
      `/repos/${ref.owner}/${ref.repo}/issues/${params.issueNumber}`,
      {
        method: "PATCH",
        body: { state: "closed", state_reason: "completed" },
      },
    );

    if (!closeResponse.ok) {
      const text = await closeResponse.text().catch(() => "");
      logger.error(
        { status: closeResponse.status, ...ref, text },
        "Failed to close GitHub issue",
      );
    }
  } catch (err) {
    logger.error({ err, ...ref }, "Error closing GitHub issue");
  }
}
