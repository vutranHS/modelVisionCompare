# modelVisionCompare

**English** | [Tiếng Việt](README.vi.md)

Guess which model an LLM API is really running by looking at how it **reads images**. Use it to check whether an API has been relabeled, meaning a cheap model sold under an expensive model's name.

Every model sees images in its own way: it breaks down at a different font size, miscounts differently, and guesses blurry text differently. This tool has the model under test read 43 hard images, then compares its answers with models known to be real.

## Usage

Requires Node 22 or later. Nothing else to install.

```bash
git clone https://github.com/vutranHS/modelVisionCompare
cd modelVisionCompare
BASE_URL=https://host/v1 API_KEY=sk-... node detect.mjs <model-name>
```

The endpoint must be OpenAI-compatible (`/chat/completions`) and accept images. One pass sends 43 requests.

Output:

```
Read 43/43 images, 1 pass(es).

GUESS: gpt-6-luna, 74% similar

Baseline model        Similarity   That model vs itself
gpt-6-luna             74%          74%
gpt-5.6-sol            67%          87%
gpt-6-sol              67%          85%
gpt-6.1-sol            66%          87%
gpt-6.1-terra          66%          83%

Advertised as: claude-opus-5-5
→ LIKELY RELABELED, DIFFERENT VENDOR: closer to gpt-6-luna (74%) than to claude-opus-5-5 (63%).
```

Options:

| How | Effect |
|---|---|
| `node detect.mjs <model> <advertised-model>` | When the name sent to the API differs from the model the seller advertises |
| `RUNS=3` | Read the image set 3 times for a firmer conclusion (default 1) |
| `CONCURRENCY=4` | Number of parallel requests (default 2) |

Answers are saved in `probes/`. Rerunning with the same model name only sends the images that are still missing; to measure from scratch, delete the matching file in `probes/`.

## Reading the similarity number

Similarity never reaches 100%. Two passes of the same real model only match each other 74–91% of the way, which is the "That model vs itself" column. So:

- Similarity **close to the right column**: very likely that model.
- Similarity **well below it** (the tool prints a "Note"): possibly a model that has no baseline yet.

## What is in the repo

| Item | Contents |
|---|---|
| `images/` | 43 test images: shrinking text, fading text, rotated text, dot counting, analog clocks, captchas, Ishihara-style dot plates, a worn gravestone, graffiti, a handwritten prescription… |
| `questions.json` | The question asked for each image |
| `baselines/` | Baselines: answers from 14 models, two or more passes each |
| `detect.mjs` | The whole tool |

Models with a baseline:

- **Claude:** `claude-fable-5-2`, `claude-opus-5-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5-5`, `claude-haiku-5-5`
- **GPT:** `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`

## How scoring works

1. For each image, compare the endpoint's answer with a baseline answer (case and punctuation removed): similarity = 1 − Levenshtein distance ÷ length.
2. Average over all images and all baseline passes of each model.
3. The model with the highest average similarity is the guess.

## Reliability

Cross-check on the baselines themselves (hide one pass, find the most similar pass among the rest):

- **Right vendor: 30 of 30 passes.** Telling Claude from GPT is solid.
- **Right model: 22 of 30 passes.** Telling models of the same vendor apart only partly works. `gpt-6-astra` and `gpt-6.1-sol` are nearly indistinguishable; Haiku and Sonnet are sometimes taken for Opus 5.5.

## Limitations

- **Baselines were not collected through the raw API.** They came from each vendor's official command-line tool, while this tool calls `/chat/completions` directly. A different call path can shift answers slightly.
- **Each model has only 2 baseline passes** (`claude-opus-5-5` has 4), so the verdict is a nearest neighbour, with no statistical test.
- **A fixed image set can be recognized.** A reseller could detect these images and route just those requests to the real model.
- **Baselines exist only for Claude and GPT**, and only OpenAI-compatible endpoints are supported.

## Adding a baseline

Run the tool against an endpoint you trust to be real, then copy the file from `probes/` to `baselines/` as `<model>-<pass number>.json`.

## License

MIT, see `LICENSE`. It covers the code, the image set and the baseline data.
