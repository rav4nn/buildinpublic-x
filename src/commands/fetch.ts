import * as fs from 'fs';
import * as path from 'path';
import { findRepo } from '../utils/config';
import { fetchAllCommits, fetchNewCommits, fetchReadme, CommitsCache } from '../utils/github';

export async function fetchCommand(args: string[]): Promise<void> {
  const repoName = args[0];
  if (!repoName) {
    console.error('Usage: npm run fetch -- <repo-name>');
    process.exit(1);
  }

  const repoConfig = findRepo(repoName);
  const { owner, repo } = repoConfig;

  const repoDir = path.join(process.cwd(), repo);
  if (!fs.existsSync(repoDir)) fs.mkdirSync(repoDir, { recursive: true });

  const cacheFile = path.join(repoDir, 'commits.json');
  let cache: CommitsCache | null = null;

  if (fs.existsSync(cacheFile)) {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as CommitsCache;
  }

  if (!cache) {
    // First fetch — get everything
    console.log(`Fetching all commits for ${owner}/${repo}...`);
    const [commits, readme] = await Promise.all([
      fetchAllCommits(owner, repo),
      fetchReadme(owner, repo),
    ]);

    // Sort oldest → newest
    commits.sort((a, b) => a.date.localeCompare(b.date));

    const lastCommit = commits[commits.length - 1];
    cache = {
      owner,
      repo,
      lastFetchedAt: new Date().toISOString(),
      lastCommitSHA: lastCommit?.sha ?? '',
      lastCommitDate: lastCommit?.date ?? '',
      readme,
      commits,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`✓ Fetched ${commits.length} commits and saved to ${repo}/commits.json`);
  } else {
    // Incremental fetch — only new commits since last known date
    console.log(`Fetching new commits for ${owner}/${repo} since ${cache.lastCommitDate}...`);
    const newCommits = await fetchNewCommits(owner, repo, cache.lastCommitDate);

    if (newCommits.length === 0) {
      console.log(`✓ No new commits since last fetch (${cache.commits.length} cached).`);
      return;
    }

    cache.commits = [...cache.commits, ...newCommits];
    const lastCommit = newCommits[newCommits.length - 1];
    cache.lastCommitSHA = lastCommit.sha;
    cache.lastCommitDate = lastCommit.date;
    cache.lastFetchedAt = new Date().toISOString();

    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`✓ Appended ${newCommits.length} new commits. Total: ${cache.commits.length} in ${repo}/commits.json`);
  }
}
