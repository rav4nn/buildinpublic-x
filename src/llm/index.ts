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
- Line 1: max 90 chars + newline
- Line 2: max 60 chars + newline
- blank line: 1
- Line 3 (question): max 65 chars + newline
- Line 4 (hashtags): #buildinpublic + 1 tag = ~25 chars
- TOTAL TARGET: under 250. Hard limit: 280.

TWEET 1 — introduce the project:
"Started building ${repoName} today - [one clause: what it does]. [what you shipped]."

TWEET 2 onwards — drop the project description, just the repo name and what happened:
"Building ${repoName}: [what happened in this commit]. Keep line 1 under 90 chars."

EXAMPLE of correct output — count this, it fits:
"Building flux-rag: Phase 2 done - chunking, embeddings, vector store, retrieval all connected.\nFirst run without mocks. Composing pieces is harder than building them.\n\nWhere do RAG pipelines tend to break for you?\n#buildinpublic #rag"

STRICT RULES — violations will make the output unusable:
- NEVER use em dashes (—) anywhere. Use a hyphen (-) or restructure the sentence.
- NEVER include a GitHub URL in the tweet body — it will be added separately
- NEVER use generic questions ("any thoughts?", "agree?", "what do you think?")
- Questions must be experience-based and specific — something a senior engineer would actually want to answer
- Subtle emotion is good: "always a tense moment", "hard to validate upfront", "raises questions"
- Use language like: "Got X working", "Wrapped up", "Finally", "Took longer than expected"
- If README is missing or vague, write: "Building ${repoName}: [best description from commits]. What has your experience been with projects like this?"
- HARD LIMIT: total tweet under 280 characters. Count every character including newlines. Be ruthless.
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

/**
 * Enforce the 280-char Twitter limit by trimming the reflection line first,
 * then the factual line. The question and hashtags are never touched.
 * Format assumed: "factual\nreflection\n\nquestion\n#hashtags"
 */
function enforceCharLimit(text: string): string {
  if (text.length <= MAX_TWEET_CHARS) return text;

  const parts = text.split('\n\n');
  if (parts.length < 2) return text.slice(0, MAX_TWEET_CHARS);

  const upper = parts[0]; // factual + reflection
  const lower = parts.slice(1).join('\n\n'); // question + hashtags
  const lowerCost = lower.length + 2; // +2 for the \n\n separator
  const budget = MAX_TWEET_CHARS - lowerCost;

  if (budget < 10) return text; // nothing reasonable to cut — leave as-is

  const upperLines = upper.split('\n');
  if (upperLines.length >= 2) {
    const factual = upperLines[0];
    const reflection = upperLines.slice(1).join('\n');
    const reflectionBudget = budget - factual.length - 1; // -1 for \n

    if (reflectionBudget <= 0) {
      // Drop reflection entirely, trim factual if needed
      const trimmedFactual = factual.length > budget
        ? factual.slice(0, factual.lastIndexOf(' ', budget)) || factual.slice(0, budget)
        : factual;
      return trimmedFactual + '\n\n' + lower;
    }

    // Trim reflection to fit
    const trimmedReflection = reflection.length > reflectionBudget
      ? reflection.slice(0, reflection.lastIndexOf(' ', reflectionBudget)) || reflection.slice(0, reflectionBudget)
      : reflection;
    return factual + '\n' + trimmedReflection + '\n\n' + lower;
  }

  // Only one line above the break — trim it
  const trimmed = upper.length > budget
    ? upper.slice(0, upper.lastIndexOf(' ', budget)) || upper.slice(0, budget)
    : upper;
  return trimmed + '\n\n' + lower;
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

    const enforced = enforceCharLimit(text);
    if (enforced.length > MAX_TWEET_CHARS) {
      console.warn(`  Warning: tweet #${i + 1} is ${enforced.length} chars — trim it manually before posting.`);
    } else if (enforced.length < text.length) {
      console.log(`  tweet #${i + 1}: trimmed ${text.length - enforced.length} chars to fit 280`);
    }
    return { text: enforced, source };
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
