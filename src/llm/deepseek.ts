import OpenAI from 'openai';

export async function generateWithDeepSeek(prompt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set. Add it to your .env file or GitHub Secrets.');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  });
  const completion = await client.chat.completions.create({
    model: 'deepseek-chat',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0].message.content ?? '';
}
