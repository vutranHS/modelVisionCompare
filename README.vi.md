# modelVisionCompare

[English](README.md) | **Tiếng Việt**

Đoán xem một API LLM đang thật sự chạy model nào bằng cách xem nó **đọc ảnh** ra sao. Dùng để kiểm tra API có bị "đè tem" hay không, tức là bán model rẻ dưới tên model đắt.

Mỗi model nhìn ảnh theo một kiểu riêng: gãy ở cỡ chữ khác nhau, đếm lệch khác nhau, đoán chữ mờ khác nhau. Tool cho model cần kiểm tra đọc 43 ảnh khó, rồi so câu trả lời với các model đã biết là thật.

## Dùng

Cần Node 22 trở lên, không cần cài thêm gì.

```bash
git clone https://github.com/vutranHS/modelVisionCompare
cd modelVisionCompare
BASE_URL=https://host/v1 API_KEY=sk-... node detect.mjs <tên-model>
```

Endpoint phải là OpenAI-compatible (`/chat/completions` hoặc `/responses`) và nhận ảnh. Một lượt gửi 43 request. Hãy dùng địa chỉ `https://`: địa chỉ `http://` bị chuyển hướng thường làm rơi API key.

Kết quả (tool in bằng tiếng Anh):

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

Tùy chọn:

| Cách | Tác dụng |
|---|---|
| `node detect.mjs <model> <advertised-model>` | Khi tên gửi lên API khác tên model mà bên bán quảng cáo |
| `RUNS=3` | Đọc bộ ảnh 3 lượt, kết luận chắc hơn (mặc định 1) |
| `CONCURRENCY=4` | Số request chạy song song (mặc định 2) |
| `API=responses` | Gọi `/responses` thay cho `/chat/completions`. Nếu không đặt, tool thử `/chat/completions` trước và tự chuyển khi endpoint không có route đó |

Câu trả lời được lưu trong `probes/`. Chạy lại cùng tên model sẽ chỉ gửi những ảnh còn thiếu; muốn đo lại từ đầu thì xóa file tương ứng trong `probes/`.

## Đọc con số tương đồng thế nào

Tương đồng không bao giờ lên 100%. Hai lượt đọc của cùng một model thật cũng chỉ giống nhau 74–91%, đó là cột "That model vs itself". Vì vậy:

- Tương đồng **gần bằng cột bên phải**: nhiều khả năng đúng là model đó.
- Tương đồng **thấp hơn hẳn** (tool sẽ ghi "Note"): có thể là một model chưa có trong bộ mốc.

## Trong repo có gì

| Thứ | Nội dung |
|---|---|
| `images/` | 43 ảnh test: chữ nhỏ dần, chữ nhạt dần, chữ xoay, đếm chấm, đồng hồ kim, captcha, chấm màu kiểu Ishihara, bia mộ mòn, graffiti, đơn thuốc viết tay… |
| `questions.json` | Câu hỏi cho từng ảnh |
| `baselines/` | Mốc chuẩn: câu trả lời của 14 model, mỗi model 2 lượt trở lên |
| `detect.mjs` | Toàn bộ tool |

Model có mốc chuẩn:

- **Claude:** `claude-fable-5-2`, `claude-opus-5-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5-5`, `claude-haiku-5-5`
- **GPT:** `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`

## Cách chấm

1. Với mỗi ảnh, so câu trả lời của endpoint với câu trả lời mốc chuẩn (bỏ hoa thường và dấu câu): độ giống = 1 − khoảng cách Levenshtein ÷ độ dài.
2. Lấy trung bình trên mọi ảnh và mọi lượt mốc chuẩn của từng model.
3. Model có độ giống trung bình cao nhất là phỏng đoán.

## Độ tin cậy

Kiểm tra chéo trên chính bộ mốc chuẩn (giấu một lượt, tìm lượt giống nhất trong số còn lại):

- **Đúng hãng: 30/30 lượt.** Phân biệt Claude với GPT là chắc.
- **Đúng model: 22/30 lượt.** Phân biệt các model cùng hãng mới được một phần. `gpt-6-astra` và `gpt-6.1-sol` gần như không tách được; Haiku và Sonnet đôi khi bị nhận thành Opus 5.5.

## Giới hạn

- **Mốc chuẩn chưa lấy qua API thô.** Chúng được lấy qua công cụ dòng lệnh chính hãng của từng hãng, còn tool này gọi thẳng API. Khác đường gọi có thể làm lệch câu trả lời đôi chút.
- **Mỗi model mới có 2 lượt mốc chuẩn** (riêng `claude-opus-5-5` có 4), nên kết luận là láng giềng gần nhất, chưa có kiểm định thống kê.
- **Bộ ảnh cố định có thể bị nhận ra.** Bên bán lại có thể phát hiện các ảnh này và chuyển riêng những request đó về model thật.
- **Chỉ có mốc cho Claude và GPT**, và chỉ hỗ trợ endpoint OpenAI-compatible.

## Thêm mốc chuẩn

Chạy tool trên một endpoint bạn tin là thật, rồi chép file từ `probes/` sang `baselines/` với tên `<model>-<số lượt>.json`.

## Giấy phép

MIT, xem file `LICENSE`. Áp dụng cho cả code, bộ ảnh và dữ liệu mốc chuẩn.
