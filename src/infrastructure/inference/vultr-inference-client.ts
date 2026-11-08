export interface VultrInferenceSettings {
  readonly apiKey: string;
  readonly baseUrl: string;
}

type MessageContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: MessageContent;
}

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ANSWER_TOKENS = 1_200;
// The default Qwen models think before answering and can spend the whole token budget doing so,
// leaving the answer empty. We only need a short JSON description, so thinking is turned off.
const WITHOUT_THINKING = { chat_template_kwargs: { enable_thinking: false } };

/** Minimal client for Vultr Serverless Inference's OpenAI-compatible chat completions endpoint. */
export class VultrInferenceClient {
  constructor(private readonly settings: VultrInferenceSettings) {
    if (settings.apiKey.trim().length === 0) {
      throw new Error('VULTR_INFERENCE_API_KEY is required.');
    }
  }

  async askForJson(model: string, messages: readonly ChatMessage[]): Promise<unknown> {
    const response = await fetch(`${this.settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: MAX_ANSWER_TOKENS, ...WITHOUT_THINKING }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Vultr Inference answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const completion = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = completion.choices?.[0]?.message?.content;
    if (answer === undefined || answer.trim().length === 0) {
      throw new Error('Vultr Inference returned an empty answer.');
    }
    return extractJsonObject(answer);
  }
}

/** Models sometimes wrap JSON in prose, code fences or reasoning blocks; keep only the object. */
export function extractJsonObject(answer: string): unknown {
  const withoutReasoning = answer.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = withoutReasoning.indexOf('{');
  const end = withoutReasoning.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('The model did not answer with JSON.');
  }
  return JSON.parse(withoutReasoning.slice(start, end + 1));
}
