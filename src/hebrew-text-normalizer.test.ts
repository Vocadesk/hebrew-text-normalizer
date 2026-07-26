import { HebrewTextNormalizer } from './hebrew-text-normalizer';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

function jsonResponse(body: Record<string, unknown>) {
  return {
    choices: [{ message: { content: JSON.stringify(body) } }],
  };
}

describe('HebrewTextNormalizer', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('never calls the LLM when no apiKey is configured', async () => {
    const normalizer = new HebrewTextNormalizer({});
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('never calls the LLM when enabled=false', async () => {
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k', enabled: false });
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips the LLM call entirely when no field contains Hebrew', async () => {
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({ greeting: 'hello receiver' });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('applies a valid substitution returned by the model', async () => {
    mockCreate.mockResolvedValue(
      jsonResponse({ greeting: 'שלום receiver' }),
    );
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toEqual({ greeting: 'שלום receiver' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('only sends Hebrew-containing fields to the model, passing others through untouched', async () => {
    mockCreate.mockResolvedValue(jsonResponse({ greeting: 'שלום receiver' }));
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({
      greeting: 'שלום רסיבר',
      englishOnly: 'nothing to fix here',
    });
    expect(result).toEqual({
      greeting: 'שלום receiver',
      englishOnly: 'nothing to fix here',
    });
    const sentInput = JSON.parse(mockCreate.mock.calls[0][0].messages[1].content);
    expect(sentInput).toEqual({ greeting: 'שלום רסיבר' });
  });

  it('falls back to the original value when the model omits a key', async () => {
    mockCreate.mockResolvedValue(jsonResponse({}));
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toEqual({ greeting: 'שלום רסיבר' });
  });

  it('falls back to the original value when the word count changes (over-edit, not a clean swap)', async () => {
    mockCreate.mockResolvedValue(
      jsonResponse({ greeting: 'a much longer replacement text than the original had' }),
    );
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toEqual({ greeting: 'שלום רסיבר' });
  });

  it('accepts a single-word swap even when it changes the field length substantially', async () => {
    // רסיבר (5 chars) -> receiver (8 chars) is a >20% length change on this
    // short field, but word count is preserved — must be accepted.
    mockCreate.mockResolvedValue(jsonResponse({ item: 'receiver' }));
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({ item: 'רסיבר' });
    expect(result).toEqual({ item: 'receiver' });
  });

  it('returns null when the model response is not valid JSON', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toBeNull();
  });

  it('returns null and reports a warning when the LLM call throws', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const warnings: string[] = [];
    const normalizer = new HebrewTextNormalizer({
      apiKey: 'k',
      onWarning: (msg) => warnings.push(msg),
    });
    const result = await normalizer.normalizeFields({ greeting: 'שלום רסיבר' });
    expect(result).toBeNull();
    expect(warnings.some((w) => w.includes('boom'))).toBe(true);
  });

  it('hasHebrew detects Hebrew script and rejects plain English', () => {
    const normalizer = new HebrewTextNormalizer({ apiKey: 'k' });
    expect(normalizer.hasHebrew('שלום')).toBe(true);
    expect(normalizer.hasHebrew('hello')).toBe(false);
  });
});
