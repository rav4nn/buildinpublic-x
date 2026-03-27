import { Octokit } from '@octokit/rest';

export interface CommitRecord {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface CommitsCache {
  owner: string;
  repo: string;
  lastFetchedAt: string;
  lastCommitSHA: string;
  lastCommitDate: string;
  lastGeneratedSHA: string; // SHA of latest commit at time of last generate run
  readme: string;
  commits: CommitRecord[];
}

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  return new Octokit({ auth: token });
}

/** Fetch the README for a repo, decoded from base64. */
export async function fetchReadme(owner: string, repo: string): Promise<string> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getReadme({ owner, repo });
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    console.warn(`  Warning: No README found for ${owner}/${repo}`);
    return '';
  }
}

/** Fetch ALL commits for a repo (handles pagination). */
export async function fetchAllCommits(owner: string, repo: string): Promise<CommitRecord[]> {
  const octokit = getOctokit();
  const commits: CommitRecord[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: 100,
      page,
    });

    for (const c of data) {
      commits.push({
        sha: c.sha,
        message: c.commit.message.split('\n')[0], // first line only
        date: c.commit.author?.date ?? c.commit.committer?.date ?? '',
        author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return commits;
}

/**
 * Fetch only commits newer than `since` (ISO date string).
 * Returns newest-first from GitHub; we reverse to chronological.
 */
export async function fetchNewCommits(
  owner: string,
  repo: string,
  since: string
): Promise<CommitRecord[]> {
  const octokit = getOctokit();
  const commits: CommitRecord[] = [];
  let page = 1;

  // Add 1 second to since to avoid re-fetching the last known commit
  const sinceDate = new Date(new Date(since).getTime() + 1000).toISOString();

  while (true) {
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      since: sinceDate,
      per_page: 100,
      page,
    });

    for (const c of data) {
      commits.push({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        date: c.commit.author?.date ?? c.commit.committer?.date ?? '',
        author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
      });
    }

    if (data.length < 100) break;
    page++;
  }

  // GitHub returns newest-first; reverse to chronological
  return commits.reverse();
}
