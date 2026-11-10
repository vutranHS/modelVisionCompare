// Đoán xem một endpoint đang thật sự chạy model nào, dựa vào cách nó đọc bộ ảnh trong images/.
//
//   BASE_URL=https://host/v1 API_KEY=sk-... node detect.mjs <model> [model-được-quảng-cáo]
//
// Endpoint phải là OpenAI-compatible (/chat/completions) và nhận ảnh.
// Câu trả lời được lưu trong probes/, chạy lại sẽ làm tiếp phần còn thiếu.
// Tùy chọn: RUNS (số lượt đọc, mặc định 1), CONCURRENCY (mặc định 2).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const { BASE_URL, API_KEY } = process.env
const [target, claimed = target] = process.argv.slice(2)
if (!target) {
  console.error('Cách dùng: BASE_URL=https://host/v1 API_KEY=sk-... node detect.mjs <model> [model-được-quảng-cáo]')
  process.exit(2)
}
const RUNS = Number(process.env.RUNS) || 1
const CONCURRENCY = Number(process.env.CONCURRENCY) || 2
const RETRIES = 3
// Câu dẫn này đã dùng khi lấy mốc chuẩn. Đổi câu dẫn là đổi luôn câu trả lời, nên giữ nguyên.
const PREFIX = 'Answer from the attached image only. Do not run any commands or use any tools. '

const root = new URL('./', import.meta.url).pathname
const readJson = (path) => JSON.parse(readFileSync(path))
const questions = readJson(root + 'questions.json')
const ids = Object.keys(questions)
const label = target.replace(/[^a-z0-9.-]/gi, '_').toLowerCase()

// ---------- 1. Cho endpoint đọc bộ ảnh ----------

async function ask(id) {
  const image = readFileSync(`${root}images/${id}.png`).toString('base64')
  const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: target,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PREFIX + questions[id] },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
      ] }],
    }),
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    err.wait = res.status === 429 ? (Number(res.headers.get('retry-after')) || 30) * 1000 : 0
    throw err
  }
  const text = (await res.json()).choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('trả lời rỗng')
  return text.trim()
}

mkdirSync(root + 'probes', { recursive: true })
const probes = []
const jobs = []
for (let n = 1; n <= RUNS; n++) {
  const path = `${root}probes/${label}-${n}.json`
  const answers = existsSync(path) ? readJson(path) : {}
  probes.push(answers)
  for (const id of ids) if (!answers[id]) jobs.push({ path, answers, id, tag: `lượt ${n} ${id}` })
}

if (jobs.length) {
  if (!BASE_URL || !API_KEY) {
    console.error(`Còn ${jobs.length} ảnh chưa đọc. Cần đặt BASE_URL và API_KEY để gọi endpoint.`)
    process.exit(2)
  }
  console.log(`Gửi ${jobs.length} ảnh tới ${target}...`)
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
          console.error(`… ${job.tag} thử lại lần ${attempt}${e.wait ? ` sau ${e.wait / 1000}s (429)` : ''}`)
          if (e.wait) await new Promise((r) => setTimeout(r, e.wait))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (failed) console.error(`\n${failed} ảnh lỗi. Kết quả dưới đây tính trên phần đã đọc được; chạy lại để làm bù.`)
}

// ---------- 2. So với mốc chuẩn ----------

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
// Độ giống giữa hai lượt đọc: trung bình trên các ảnh mà cả hai cùng có câu trả lời
const runSim = (a, b) => mean(ids.map((id) => (a[id] == null || b[id] == null ? NaN : sim(norm(a[id]), norm(b[id])))))

const baselines = {} // model -> các lượt đọc mốc chuẩn
for (const f of readdirSync(root + 'baselines').filter((f) => f.endsWith('.json')))
  (baselines[f.replace(/-\d+\.json$/, '')] ??= []).push(readJson(`${root}baselines/${f}`))

const family = (m) => (m.startsWith('gpt') ? 'GPT' : m.startsWith('claude') ? 'Claude' : m)
const pct = (x) => (Number.isNaN(x) ? ' –' : `${Math.round(x * 100)}%`.padStart(4))
// ponytail: láng giềng gần nhất trên độ giống trung bình, chưa có kiểm định thống kê.
// Khi mỗi model có 5+ lượt mốc chuẩn thì so với phân phối độ tự giống của từng model.
const rank = Object.entries(baselines).map(([m, runs]) => ({
  m,
  score: mean(probes.flatMap((p) => runs.map((b) => runSim(p, b)))),
  self: mean(runs.flatMap((a, i) => runs.slice(i + 1).map((b) => runSim(a, b)))),
})).filter((r) => !Number.isNaN(r.score)).sort((x, y) => y.score - x.score)

const read = Math.round(mean(probes.map((p) => ids.filter((id) => p[id] != null).length)))
if (!rank.length || !read) { console.error('Chưa có câu trả lời nào để so.'); process.exit(1) }
const top = rank[0]

console.log(`\nĐã đọc ${read}/${ids.length} ảnh, ${probes.length} lượt.\n`)
console.log(`ĐOÁN: ${top.m}, tương đồng ${pct(top.score).trim()}\n`)
console.log('Model mốc chuẩn'.padEnd(22) + 'Tương đồng   Model đó tự giống chính nó')
for (const r of rank.slice(0, 5)) console.log(r.m.padEnd(22) + pct(r.score).padEnd(13) + pct(r.self))
console.log('\nHai lượt đọc của cùng một model thật cũng chỉ giống nhau cỡ cột bên phải, không bao giờ 100%.')

// ponytail: ngưỡng 10 điểm chọn bằng mắt từ bộ mốc hiện tại, cần chỉnh lại khi có thêm lượt.
if (top.score < top.self - 0.1)
  console.log(`Lưu ý: ${top.m} là gần nhất nhưng còn xa mức tự giống của nó, có thể đây là model chưa có trong bộ mốc.`)

const c = rank.find((r) => r.m === claimed)
console.log(`\nĐược quảng cáo là: ${claimed}`)
if (!c) console.log(`→ Chưa có mốc chuẩn cho "${claimed}", chỉ đưa ra được phỏng đoán ở trên.\n  Các model có mốc: ${Object.keys(baselines).sort().join(', ')}`)
else if (top.m === claimed) console.log(`→ KHỚP: giống ${claimed} nhất.`)
else if (family(top.m) !== family(claimed))
  console.log(`→ NGHI ĐÈ TEM KHÁC HÃNG: giống ${top.m} (${pct(top.score).trim()}) hơn ${claimed} (${pct(c.score).trim()}).`)
else
  console.log(`→ CÙNG HÃNG, KHÁC MODEL: giống ${top.m} (${pct(top.score).trim()}) hơn ${claimed} (${pct(c.score).trim()}).\n  Tách model cùng hãng chưa chắc; chạy thêm lượt (RUNS=3) trước khi kết luận.`)
