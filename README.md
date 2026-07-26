# @vocadesk/hebrew-text-normalizer

LLM-based normalizer that rewrites phonetically-transliterated English words in Hebrew text back to correct English spelling — e.g. `"אתמול קניתי רסיבר עם בלוטוס"` becomes `"אתמול קניתי receiver עם Bluetooth"`.

It uses a single batched LLM call (OpenAI-compatible) with a narrow prompt and two safety checks: fields with no Hebrew characters are never sent to the model, and any returned value whose length deviates too far from the original is discarded in favor of the original. It never throws — on a missing API key, a disabled config, or any failure, it fails open and returns `null`, meaning "keep the original text."

## Install

Not published to a registry — install directly from this repo, pinned to a tag:

```
npm install github:Vocadesk/hebrew-text-normalizer#v1.0.0
```

## Usage

```ts
import { HebrewTextNormalizer } from '@vocadesk/hebrew-text-normalizer';

const normalizer = new HebrewTextNormalizer({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL, // defaults to 'gpt-4o-mini'
  enabled: process.env.HEBREW_NORMALIZER_ENABLED !== 'false',
  onWarning: (msg) => logger.warn(msg),
});

const normalized = await normalizer.normalizeFields({
  greeting: 'שלום, אני רוצה רסיבר עם בלוטוס',
});
// normalized === { greeting: 'שלום, אני רוצה receiver עם Bluetooth' }
// or null if there was nothing to do / the call failed — callers should
// keep the original values in that case.
```

This package intentionally has no framework coupling (no NestJS, no logging library) — pass in whatever config values and a warning callback fit your app.

## Contributing

Open to external contributions via PR. Merges to `main` require review from a listed code owner.
