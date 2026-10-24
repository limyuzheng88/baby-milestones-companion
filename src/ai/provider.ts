// The AI behind chat understanding. Swappable: the rest of the app only sees AiProvider.
import Anthropic from '@anthropic-ai/sdk';

export type AiRequest = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  /** When set, the reply is JSON matching this schema (structured outputs). */
  jsonSchema?: Record<string, unknown>;
};

export type AiResponse = { text: string; inputTokens: number; outputTokens: number };

export interface AiProvider {
  readonly model: string;
  complete(req: AiRequest): Promise<AiResponse>;
}

/** The model declined. Carries token counts so the spend is still recorded. */
export class AiRefusal extends Error {
  override name = 'AiRefusal';
  constructor(
    readonly inputTokens: number,
    readonly outputTokens: number,
  ) {
    super('model refused');
  }
}

export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    fetchFn?: typeof fetch,
  ) {
    // The router enforces its own 10 s limit; one retry covers a transient blip.
    this.client = new Anthropic({ apiKey, timeout: 10_000, maxRetries: 1, ...(fetchFn ? { fetch: fetchFn } : {}) });
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      ...(req.jsonSchema ? { output_config: { format: { type: 'json_schema' as const, schema: req.jsonSchema } } } : {}),
    });
    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    if (res.stop_reason === 'refusal') throw new AiRefusal(inputTokens, outputTokens);
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, inputTokens, outputTokens };
  }
}
