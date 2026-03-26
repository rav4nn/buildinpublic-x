import Groq from 'groq-sdk';

export async function generateWithGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set. Add it to your .env file or GitHub Secrets.');
  const client = new Groq({ apiKey });
  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0].message.content ?? '';
}
