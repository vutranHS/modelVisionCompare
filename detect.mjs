// Guess which model an endpoint is really running, from how it reads the images in images/.
//
//   BASE_URL=https://host/v1 API_KEY=sk-... node detect.mjs <model> [advertised-model]
//
// The endpoint must be OpenAI-compatible (/chat/completions or /responses) and accept images.
// Answers are saved in probes/; rerunning only sends the images that are still missing.
// Options: RUNS (number of passes, default 1), CONCURRENCY (default 2), API (chat | responses).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const { BASE_URL, API_KEY } = process.env
const [target, claimed = target] = process.argv.slice(2)
if (!target) {
  console.error('Usage: BASE_URL=https://host/v1 API_KEY=sk-... node detect.mjs <model> [advertised-model]')
  process.exit(2)
}
const RUNS = Number(process.env.RUNS) || 1
const CONCURRENCY = Number(process.env.CONCURRENCY) || 2
const RETRIES = 3
// The baselines were collected with this exact prefix. Changing it changes the answers, so keep it.
const PREFIX = 'Answer from the attached image only. Do not run any commands or use any tools. '

const root = new URL('./', import.meta.url).pathname
const readJson = (path) => JSON.parse(readFileSync(path))
const questions = readJson(root + 'questions.json')
const ids = Object.keys(questions)
const label = target.replace(/[^a-z0-9.-]/gi, '_').toLowerCase()

// ---------- 1. Have the endpoint read the image set ----------

// 'chat' = /chat/completions, 'responses' = /responses. Falls back to /responses when the
// endpoint has no /chat/completions route. Force one with API=chat or API=responses.
let api = process.env.API === 'responses' ? 'responses' : 'chat'

// A /responses body is either one JSON object or a server-sent event stream.
function responsesText(raw) {
  const events = raw.trimStart().startsWith('{')
    ? [JSON.parse(raw)]
    : raw.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]').map((l) => JSON.parse(l.slice(6)))
  const deltas = events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta).join('')
  if (deltas) return deltas
  const done = events.map((e) => e.response ?? e).findLast((r) => Array.isArray(r.output))
  return done?.output.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('')
}

async function ask(id) {
  const text = PREFIX + questions[id]
  const image = `data:image/png;base64,${readFileSync(`${root}images/${id}.png`).toString('base64')}`
  const body = api === 'chat'
    ? { model: target, messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] }] }
    : { model: target, input: [{ role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: image }] }] }
  const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/${api === 'chat' ? 'chat/completions' : 'responses'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  })
  if (res.status === 404 && api === 'chat' && !process.env.API) {
    api = 'responses'
    return ask(id)
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    err.wait = res.status === 429 ? (Number(res.headers.get('retry-after')) || 30) * 1000 : 0
    throw err
  }
  const raw = await res.text()
  const answer = api === 'chat' ? JSON.parse(raw).choices?.[0]?.message?.content : responsesText(raw)
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('empty answer')
  return answer.trim()
}

mkdirSync(root + 'probes', { recursive: true })
const probes = []
const jobs = []
for (let n = 1; n <= RUNS; n++) {
  const path = `${root}probes/${label}-${n}.json`
  const answers = existsSync(path) ? readJson(path) : {}
  probes.push(answers)
  for (const id of ids) if (!answers[id]) jobs.push({ path, answers, id, tag: `pass ${n} ${id}` })
}

if (jobs.length) {
  if (!BASE_URL || !API_KEY) {
    console.error(`${jobs.length} images still unread. Set BASE_URL and API_KEY to call the endpoint.`)
    process.exit(2)
  }
  console.log(`Sending ${jobs.length} images to ${target}...`)
  let failed = 0
  const worker = async () => {
    for (let job; (job = jobs.shift()); ) {
      for (let attempt = 1; ; attempt++) {
        try {
          job.answers[job.id] = await ask(job.id)
          writeFileSync(job.path, JSON.stringify(job.answers, null, 2))
          console.log(`✓ ${job.tag}`)
          break
        } catch (e) {
          if (attempt > RETRIES) { failed++; console.error(`✗ ${job.tag}: ${e.message}`); break }
          console.error(`… ${job.tag} retry ${attempt}${e.wait ? ` in ${e.wait / 1000}s (429)` : ''}`)
          if (e.wait) await new Promise((r) => setTimeout(r, e.wait))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (failed) console.error(`\n${failed} images failed. The result below uses what was read; rerun to fill the gaps.`)
}

// ---------- 2. Compare with the baselines ----------

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1]))
    prev = cur
  }
  return prev[b.length]
}
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const sim = (a, b) => (a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length, 1))
const mean = (all) => {
  const xs = all.filter((x) => !Number.isNaN(x))
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN
}
// Similarity of two passes: mean over the images both of them answered
const runSim = (a, b) => mean(ids.map((id) => (a[id] == null || b[id] == null ? NaN : sim(norm(a[id]), norm(b[id])))))

const baselines = {} // model -> its baseline passes
for (const f of readdirSync(root + 'baselines').filter((f) => f.endsWith('.json')))
  (baselines[f.replace(/-\d+\.json$/, '')] ??= []).push(readJson(`${root}baselines/${f}`))

const family = (m) => (m.startsWith('gpt') ? 'GPT' : m.startsWith('claude') ? 'Claude' : m)
const pct = (x) => (Number.isNaN(x) ? ' –' : `${Math.round(x * 100)}%`.padStart(4))
// ponytail: nearest neighbour on mean similarity, no statistical test.
// Once each model has 5+ baseline passes, compare against each model's self-similarity distribution.
const rank = Object.entries(baselines).map(([m, runs]) => ({
  m,
  score: mean(probes.flatMap((p) => runs.map((b) => runSim(p, b)))),
  self: mean(runs.flatMap((a, i) => runs.slice(i + 1).map((b) => runSim(a, b)))),
})).filter((r) => !Number.isNaN(r.score)).sort((x, y) => y.score - x.score)

const read = Math.round(mean(probes.map((p) => ids.filter((id) => p[id] != null).length)))
if (!rank.length || !read) { console.error('No answers to compare yet.'); process.exit(1) }
const top = rank[0]

console.log(`\nRead ${read}/${ids.length} images, ${probes.length} pass(es).\n`)
console.log(`GUESS: ${top.m}, ${pct(top.score).trim()} similar\n`)
console.log('Baseline model'.padEnd(22) + 'Similarity   That model vs itself')
for (const r of rank.slice(0, 5)) console.log(r.m.padEnd(22) + pct(r.score).padEnd(13) + pct(r.self))
console.log('\nTwo passes of the same real model only match each other about as much as the right column, never 100%.')

// ponytail: the 10-point gap was picked by eye from the current baselines; retune when more passes exist.
if (top.score < top.self - 0.1)
  console.log(`Note: ${top.m} is the closest, but still far from its own self-similarity. This may be a model with no baseline yet.`)

const c = rank.find((r) => r.m === claimed)
console.log(`\nAdvertised as: ${claimed}`)
if (!c) console.log(`→ No baseline for "${claimed}", so only the guess above is available.\n  Models with a baseline: ${Object.keys(baselines).sort().join(', ')}`)
else if (top.m === claimed) console.log(`→ MATCH: closest to ${claimed}.`)
else if (family(top.m) !== family(claimed))
  console.log(`→ LIKELY RELABELED, DIFFERENT VENDOR: closer to ${top.m} (${pct(top.score).trim()}) than to ${claimed} (${pct(c.score).trim()}).`)
else
  console.log(`→ SAME VENDOR, DIFFERENT MODEL: closer to ${top.m} (${pct(top.score).trim()}) than to ${claimed} (${pct(c.score).trim()}).\n  Telling models of one vendor apart is not reliable yet; run more passes (RUNS=3) before concluding.`)
