import OpenAI from 'openai';

export const HEBREW_CHAR_PATTERN = /[֐-׿]/;

export const DEFAULT_SYSTEM_PROMPT = `You normalize Hebrew text that may contain English words, brand names, or technical terms phonetically spelled out in Hebrew letters instead of written in English (e.g. רסיבר should become 'receiver', בלוטוס should become 'Bluetooth', סאונד should become 'sound'). Your ONLY job is to replace such phonetically-transliterated English tokens with their correct English spelling, in place, leaving the rest of the Hebrew text exactly as-is. Do NOT translate Hebrew meaning into English. Do NOT paraphrase, reorder, or add/remove words. Do NOT touch genuine Hebrew words, numbers, or punctuation. If you are not confident a word is a transliterated English term, leave it unchanged. You will receive a JSON object where each value is a piece of Hebrew text; return a JSON object with the exact same keys, each value being the corrected text (unchanged if nothing needed fixing).`;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface HebrewTextNormalizerConfig {
  /** OpenAI API key. If unset, the normalizer fails open (every call is a no-op). */
  apiKey?: string;
  /** Chat completion model to use. Defaults to 'gpt-4o-mini'. */
  model?: string;
  /** Global kill switch. Defaults to true. */
  enabled?: boolean;
  /** Override the default system prompt. */
  systemPrompt?: string;
  /** Called with a human-readable message on any fail-open condition (missing key, disabled, malformed response, thrown error). Defaults to a no-op. */
  onWarning?: (message: string) => void;
}

/**
 * Best-effort LLM rewrite of phonetically-transliterated English words inside
 * otherwise-Hebrew text (e.g. "רסיבר" -> "receiver"). Never throws — fails
 * open (returns null) on missing config, disabled flag, no-Hebrew input,
 * malformed LLM output, or any exception, so callers can always safely treat
 * null as "keep the original text."
 */
export class HebrewTextNormalizer {
  private readonly openai: OpenAI | null;
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly systemPrompt: string;
  private readonly onWarning: (message: string) => void;

  constructor(config: HebrewTextNormalizerConfig = {}) {
    this.model = config.model ?? 'gpt-4o-mini';
    this.enabled = config.enabled ?? true;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.onWarning = config.onWarning ?? (() => {});
    this.openai = config.apiKey ? new OpenAI({ apiKey: config.apiKey }) : null;

    if (!config.apiKey) {
      this.onWarning(
        'No apiKey provided — Hebrew text normalization disabled',
      );
    }
    if (!this.enabled) {
      this.onWarning('enabled=false — Hebrew text normalization disabled');
    }
  }

  hasHebrew(text: string): boolean {
    return HEBREW_CHAR_PATTERN.test(text);
  }

  /**
   * Rewrites phonetically-transliterated English words inside the given
   * fields' Hebrew text, in a single batched LLM call. Returns null when
   * there's nothing to do (disabled, no client, no Hebrew content) or when
   * the LLM call/response fails in any way — callers must treat null exactly
   * like "no changes" and keep all original values.
   */
  async normalizeFields(
    fields: Record<string, string>,
  ): Promise<Record<string, string> | null> {
    if (!this.enabled || !this.openai) return null;

    const filtered = Object.entries(fields).filter(
      ([, value]) => value && this.hasHebrew(value),
    );
    if (filtered.length === 0) return null;

    try {
      const input = Object.fromEntries(filtered);
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: JSON.stringify(input) },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.onWarning('Failed to parse Hebrew normalization JSON response');
        return null;
      }

      const merged: Record<string, string> = { ...fields };
      for (const [key, original] of filtered) {
        const candidate = parsed[key];
        if (typeof candidate !== 'string') continue; // omitted/mismatched — keep original
        // Word-for-word transliteration swaps preserve word count; a
        // mismatch means the model paraphrased, translated, or added/removed
        // words instead of doing a clean substitution — reject and keep the
        // original. (Character-length is a poor proxy here: a short Hebrew
        // word routinely becomes a longer English word, e.g. רסיבר ->
        // receiver, which would otherwise look like a big "over-edit" on a
        // short field even though it's exactly the desired fix.)
        if (wordCount(candidate) !== wordCount(original)) continue;
        merged[key] = candidate;
      }
      return merged;
    } catch (err) {
      this.onWarning(
        `Hebrew text normalization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
