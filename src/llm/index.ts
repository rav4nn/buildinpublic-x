import { readConfig } from '../utils/config';
import { generateWithAnthropic } from './anthropic';
import { generateWithOpenAI } from './openai';
import { generateWithGemini } from './gemini';
import { generateWithDeepSeek } from './deepseek';
import { generateWithGroq } from './groq';

const MAX_TWEET_CHARS = 280;

/**
 * Build the tweet generation prompt.
 */
function buildPrompt(
  repoName: string,
  readme: string,
  commits: Array<{ sha: string; message: string; date: string }>,
  n: number
): string {
  const commitList = commits
    .map(c => `[${c.sha.slice(0, 7)}] ${c.date.slice(0, 10)} — ${c.message}`)
    .join('\n');

  const countInstruction = n === 1
    ? 'Generate 1 tweet — distill the most impressive or interesting thing about this project so far.'
    : `Generate up to ${n} tweets. Only generate as many as the commits genuinely justify — fewer precise tweets beat more generic ones. If there are only 3 commits worth tweeting about, return 3 tweets, not ${n}.`;

  return `You are helping a developer share their build journey on Twitter.

PROJECT: ${repoName}

README:
${readme || '(no README available)'}

COMMITS (oldest → newest):
${commitList}

${countInstruction}

REQUIREMENTS:
- Each tweet must be under ${MAX_TWEET_CHARS} characters
- First person, developer voice: "Replaced...", "Shipped...", "Rewrote...", "Discovered..."
- Technically specific — mention actual things built, decisions made, metrics achieved
- NEVER generic ("Working on my project today!" or "Making progress!")
- 2–3 hashtags, always include #buildinpublic
- Spread across the build journey chronologically, each tweet a distinct moment

Return a valid JSON array of strings only — no markdown, no extra text, just the array:
["tweet text 1", "tweet text 2", ...]`;
}

/** Parse the LLM response into an array of tweet strings. */
function parseTweets(raw: string, max: number): string[] {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  let tweets: string[];
  try {
    tweets = JSON.parse(cleaned);
  } catch {
    // Fallback: extract quoted strings
    const matches = cleaned.match(/"([^"\\]|\\.)*"/g);
    if (!matches) throw new Error('Could not parse LLM response as JSON array');
    tweets = matches.map(m => JSON.parse(m));
  }

  if (!Array.isArray(tweets)) throw new Error('LLM did not return a JSON array');

  // Truncate any over-length tweets with a warning
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
 */
export async function generateTweets(
  repoName: string,
  readme: string,
  commits: Array<{ sha: string; message: string; date: string }>,
  n: number
): Promise<string[]> {
  const config = readConfig();
  const provider = (process.env.LLM_PROVIDER ?? config.llm_provider ?? 'anthropic').toLowerCase();
  const prompt = buildPrompt(repoName, readme, commits, n);

  console.log(`  Using LLM provider: ${provider}`);

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

  return parseTweets(raw, n);
}
