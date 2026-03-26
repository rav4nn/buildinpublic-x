import { readConfig } from '../utils/config';
import { generateWithAnthropic } from './anthropic';
import { generateWithOpenAI } from './openai';
import { generateWithGemini } from './gemini';
import { generateWithDeepSeek } from './deepseek';
import { generateWithGroq } from './groq';

const MAX_TWEET_CHARS = 280;

export interface GeneratedTweet {
  text: string;
  source: string; // human-readable, e.g. "Phase 0: scaffold package structure..."
}

interface CommitRecord {
  sha: string;
  message: string;
  date: string;
}

interface CommitGroup {
  date: string;        // "2026-03-17"
  commits: CommitRecord[];
  label: string;       // first commit message, used as source
}

/**
 * Group commits into at most `n` buckets, one per tweet.
 * Commits on the same date stay together where possible.
 * If there are fewer commits than n, returns one group per commit.
 */
function groupCommits(commits: CommitRecord[], n: number): CommitGroup[] {
  if (commits.length === 0) return [];

  // First, group by date
  const byDate: Record<string, CommitRecord[]> = {};
  for (const c of commits) {
    const day = c.date.slice(0, 10);
    (byDate[day] = byDate[day] ?? []).push(c);
  }
  const days = Object.keys(byDate).sort();

  // If date-groups fit within n, use them directly
  if (days.length <= n) {
    return days.map(day => ({
      date: day,
      commits: byDate[day],
      label: byDate[day][0].message.slice(0, 80),
    }));
  }

  // Otherwise, bucket commits evenly into n groups
  const groupSize = Math.ceil(commits.length / n);
  const groups: CommitGroup[] = [];
  for (let i = 0; i < n; i++) {
    const slice = commits.slice(i * groupSize, (i + 1) * groupSize);
    if (slice.length === 0) break;
    groups.push({
      date: slice[0].date.slice(0, 10),
      commits: slice,
      label: slice[0].message.slice(0, 80),
    });
  }
  return groups;
}

/**
 * Build the LLM prompt. Groups are already split — one tweet per group.
 */
function buildPrompt(
  repoName: string,
  readme: string,
  groups: CommitGroup[]
): string {
  const n = groups.length;

  const groupList = groups.map((g, i) => {
    const commitLines = g.commits.map(c => `  - ${c.message}`).join('\n');
    return `Group ${i + 1} (${g.date}):\n${commitLines}`;
  }).join('\n\n');

  // Derive project description priority: README > commit messages > fallback
  const hasReadme = readme && readme.trim().length > 100;
  const readmeSection = hasReadme
    ? `README (this is your primary source for understanding the project):\n${readme}`
    : readme && readme.trim().length > 0
      ? `README (brief, supplement with commit messages):\n${readme}`
      : `README: (none — infer the project description entirely from commit messages)`;

  return `You are a senior software engineer writing tweets to share your build journey with your Twitter followers. Your voice is composed, precise, and mildly opinionated. You write like someone who thinks carefully about systems, not like a hype-driven indie hacker.

PROJECT: ${repoName}

${readmeSection}

COMMIT GROUPS — write exactly one tweet per group, in chronological order:
${groupList}

TWEET FORMAT — follow this structure exactly for every tweet:

Line 1 (factual): project context + what happened from the commits. Keep under 140 chars.
[blank line]
Line 2 (personality): 1-2 sentences of honest reflection on what this involved or revealed, then one specific experience-based question that a senior engineer would find worth answering. Keep under 130 chars.
Line 3: hashtags only — always #buildinpublic plus 1 relevant technical tag.

TWEET 1 specifically — start line 1 with:
"Started building ${repoName} today - [what it does in one clause]. [what you shipped in group 1]."

TWEET 2 onwards — start line 1 with:
"I'm building ${repoName} - [what it does in one clause]. [what happened in this group's commits]."

EXAMPLE of correct output for a RAG framework:
"I'm building flux-rag - RAG eval framework. Phase 2: chunking, embeddings, vector store, retrieval and eval all connected.\n\nFirst run without mocks. Works fine in isolation but composing everything is a different story. Where do RAG pipelines tend to break for you?\n#buildinpublic #rag"

STRICT RULES — violations will make the output unusable:
- NEVER use em dashes (—) anywhere. Use a hyphen (-) or restructure the sentence.
- NEVER include a GitHub URL in the tweet body — it will be added separately
- NEVER use generic questions ("any thoughts?", "agree?", "what do you think?")
- Questions must be experience-based and specific — something a senior engineer would actually want to answer
- Subtle emotion is good: "always a tense moment", "hard to validate upfront", "raises questions"
- Use language like: "Got X working", "Wrapped up", "Finally", "Took longer than expected"
- If README is missing or too vague and commit messages are also vague, write: "Continuing to build ${repoName} today. [best description from commits available]. What has your experience been with projects like this?"
- Total tweet length including the blank line and hashtags must be under ${MAX_TWEET_CHARS} characters
- Return a valid JSON array of strings only — no markdown fences, no extra text:

["tweet 1 text", "tweet 2 text", ...]`;
}

/** Parse the LLM response into an array of tweet strings. */
function parseTweetTexts(raw: string, max: number): string[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  let tweets: string[];
  try {
    tweets = JSON.parse(cleaned);
  } catch {
    const matches = cleaned.match(/"([^"\\]|\\.)*"/g);
    if (!matches) throw new Error('Could not parse LLM response as JSON array');
    tweets = matches.map(m => JSON.parse(m));
  }

  if (!Array.isArray(tweets)) throw new Error('LLM did not return a JSON array');

  return tweets.slice(0, max).map(t => {
    if (t.length > MAX_TWEET_CHARS) {
      console.warn(`  Warning: tweet truncated from ${t.length} chars: ${t.slice(0, 40)}...`);
      return t.slice(0, MAX_TWEET_CHARS - 3) + '...';
    }
    return t;
  });
}

/**
 * Generate tweets for a repo using the configured LLM provider.
 * Returns one GeneratedTweet per commit group, with a human-readable source.
 */
export async function generateTweets(
  repoName: string,
  owner: string,
  readme: string,
  commits: CommitRecord[],
  n: number
): Promise<GeneratedTweet[]> {
  const config = readConfig();
  const provider = (process.env.LLM_PROVIDER ?? config.llm_provider ?? 'anthropic').toLowerCase();

  const groups = groupCommits(commits, n);
  const prompt = buildPrompt(repoName, readme, groups);

  console.log(`  Using LLM provider: ${provider}`);
  console.log(`  Grouped ${commits.length} commits into ${groups.length} tweet${groups.length === 1 ? '' : 's'}`);

  let raw: string;
  switch (provider) {
    case 'anthropic': raw = await generateWithAnthropic(prompt); break;
    case 'openai':    raw = await generateWithOpenAI(prompt); break;
    case 'gemini':    raw = await generateWithGemini(prompt); break;
    case 'deepseek':  raw = await generateWithDeepSeek(prompt); break;
    case 'groq':      raw = await generateWithGroq(prompt); break;
    default:
      throw new Error(`Unknown LLM provider: "${provider}". Valid: anthropic | openai | gemini | deepseek | groq`);
  }

  const texts = parseTweetTexts(raw, groups.length);

  return texts.map((text, i) => ({
    text,
    source: groups[i]?.label ?? groups[0].label,
  }));
}
