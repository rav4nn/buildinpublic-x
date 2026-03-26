import OpenAI from 'openai';

export async function generateWithDeepSeek(prompt: string): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
  });
  const completion = await client.chat.completions.create({
    model: 'deepseek-chat',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0].message.content ?? '';
}
