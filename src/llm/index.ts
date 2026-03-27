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

/**
 * Build the LLM prompt. Always targets exactly n tweets.
 * When n > commits the LLM is instructed to paraphrase and use README context.
 */
function buildPrompt(
  repoName: string,
  readme: string,
  commits: CommitRecord[],
  n: number
): string {
  const commitList = commits
    .map((c, i) => `${i + 1}. [${c.date.slice(0, 10)}] ${c.message}`)
    .join('\n');

  const hasReadme = readme && readme.trim().length > 100;
  const readmeSection = hasReadme
    ? `README (this is your primary source for understanding the project):\n${readme}`
    : readme && readme.trim().length > 0
      ? `README (brief, supplement with commit messages):\n${readme}`
      : `README: (none — infer the project description entirely from commit messages)`;

  const distributionNote = n > commits.length
    ? `There are only ${commits.length} commit(s) but you must write ${n} tweets. Find multiple angles: architecture decisions, design tradeoffs, what the project name implies, what the README reveals about intent, lessons learned from specific implementation choices. Different tweets can cover the same commit from a different angle.`
    : n < commits.length
      ? `There are ${commits.length} commits. Group related commits together so the ${n} tweets each cover a coherent chunk of work.`
      : `There is one commit per tweet — cover each commit directly.`;

  return `You are a senior software engineer writing tweets to share your build journey with your Twitter followers. Your voice is composed, precise, and mildly opinionated. You write like someone who thinks carefully about systems, not like a hype-driven indie hacker.

PROJECT: ${repoName}

${readmeSection}

COMMITS (chronological):
${commitList}

TASK: Write exactly ${n} tweets about this project's build journey, in chronological order.
${distributionNote}

TWEET FORMAT — follow this structure exactly for every tweet:

Line 1 (factual): project context + what happened. MAX 110 characters.
Line 2 (reflection): 1 sentence of honest reflection. No question. MAX 80 characters.
[blank line]
Line 3 (question): The experience-based question, isolated. MAX 60 characters.
Line 4: hashtags only — always #buildinpublic plus 1 relevant technical tag. MAX 30 characters.

CHARACTER BUDGET — Twitter counts every character including newlines:
- Line 1: 110 + newline = 111
- Line 2: 80 + newline = 81
- blank line: 1
- Line 3: 60 + newline = 61
- Line 4: 30
- TOTAL MUST BE UNDER 280. Target 270 to be safe.

TWEET 1 specifically — start line 1 with:
"Started building ${repoName} today - [what it does]. [what you shipped]."

TWEET 2 onwards — start line 1 with:
"I'm building ${repoName} - [what it does]. [what happened]."

EXAMPLE of correct output (count the chars — this is exactly right):
"I'm building flux-rag - RAG eval framework. Phase 2: chunking, embeddings, retrieval connected.\nFirst run without mocks. Composing pieces is a different problem than building them.\n\nWhere do RAG pipelines tend to break for you?\n#buildinpublic #rag"

STRICT RULES — violations will make the output unusable:
- NEVER use em dashes (—) anywhere. Use a hyphen (-) or restructure the sentence.
- NEVER include a GitHub URL in the tweet body — it will be added separately
- NEVER use generic questions ("any thoughts?", "agree?", "what do you think?")
- Questions must be experience-based and specific — something a senior engineer would actually want to answer
- Subtle emotion is good: "always a tense moment", "hard to validate upfront", "raises questions"
- Use language like: "Got X working", "Wrapped up", "Finally", "Took longer than expected"
- If README is missing or vague, write: "Continuing to build ${repoName} today. [best description from commits]. What has your experience been with projects like this?"
- HARD LIMIT: total tweet must be under 280 characters. Count every character. Be ruthless with brevity.
- Return a valid JSON array of exactly ${n} objects — no markdown fences, no extra text:

[{"text": "tweet body", "source": "short label for what this tweet covers"}, ...]`;
}

/**
 * Escape literal control characters inside JSON string values.
 * Some LLMs output raw newlines inside JSON strings (invalid JSON) — this fixes it.
 */
function fixLiteralNewlinesInJson(str: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      result += ch;
      escaped = false;
    } else if (ch === '\\') {
      result += ch;
      escaped = true;
    } else if (ch === '"') {
      result += ch;
      inString = !inString;
    } else if (inString && ch === '\n') {
      result += '\\n';
    } else if (inString && ch === '\r') {
      result += '\\r';
    } else if (inString && ch === '\t') {
      result += '\\t';
    } else {
      result += ch;
    }
  }
  return result;
}

/** Parse the LLM response into GeneratedTweet objects. */
function parseGeneratedTweets(raw: string, n: number): GeneratedTweet[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const sanitized = fixLiteralNewlinesInJson(cleaned);

  let parsed: unknown[];
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    // Fallback: extract all JSON objects from the string
    const matches = sanitized.match(/\{[^{}]*\}/g);
    if (!matches) throw new Error('Could not parse LLM response as JSON array');
    parsed = matches.map(m => JSON.parse(m));
  }

  if (!Array.isArray(parsed)) throw new Error('LLM did not return a JSON array');

  return parsed.slice(0, n).map((item, i) => {
    // Handle both {text, source} objects and plain strings (fallback)
    const text = typeof item === 'object' && item !== null && 'text' in item
      ? String((item as Record<string, unknown>).text)
      : String(item);
    const source = typeof item === 'object' && item !== null && 'source' in item
      ? String((item as Record<string, unknown>).source)
      : `tweet ${i + 1}`;

    if (text.length > MAX_TWEET_CHARS) {
      console.warn(`  Warning: tweet #${i + 1} is ${text.length} chars (over ${MAX_TWEET_CHARS}). Edit it down before posting.`);
    }
    return { text, source };
  });
}

/**
 * Generate exactly n tweets for a repo using the configured LLM provider.
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

  return parseGeneratedTweets(raw, n);
}
