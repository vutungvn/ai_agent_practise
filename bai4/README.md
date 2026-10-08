# Bài 8: Chọn kiến trúc cho bộ định tuyến ticket ShopFast (3.000 lượt/ngày)

Kết luận: chọn **kiến trúc lai (c)**. Mọi ticket đi qua một lời gọi phân loại. Chỉ những vấn đề phụ thuộc trạng thái đơn hàng mới được đẩy sang agent có tool tra cứu. Phương án này nằm trong 4 triệu đ/tháng (ước tính khoảng 2,1 triệu), ticket chậm nhất (ca tra cứu) mất khoảng 3,2 giây và có hạn chót cứng 4,5 giây. Số ticket gán sai ít hơn phương án chỉ phân loại khoảng 8.600 ticket/tháng.

```bash
npm install
npm test          # 28 test, không cần API key (dùng Gemini giả)
npm run cost      # in bảng so sánh 3 kiến trúc kèm cách tính
cp .env.example .env   # điền GEMINI_API_KEY
npm run route -- --sample T18            # định tuyến 1 ticket mẫu bằng model thật
npm run route -- "Đơn ORD1002 sao chưa giao vậy?"
npm run eval      # chạy 18 ticket mẫu có nhãn: đo độ chính xác, độ trễ, chi phí thật
```

---

## A. Phân tích bài toán

### Đầu vào / đầu ra

| | Nội dung |
|---|---|
| **Đầu vào** | `{ ticketId, text }`. `text` là nội dung khách gửi, dài từ 1 câu tới khoảng 4.000 từ (khi khách dán cả lịch sử chat), có thể chứa nhiều vấn đề cùng lúc. |
| **Nguồn dữ liệu phụ** | Hệ thống đơn hàng (`get_order`): trạng thái đơn, trạng thái thanh toán, số ngày từ lúc giao. |
| **Đầu ra** | `routes[]`: mỗi phần tử là một phiếu con cho **một đội**, gồm `team`, `summary`, `orderId`, `via` (classifier / agent / fallback), `needsHumanReview` và `reason`. Kèm theo `meta` gồm số từ, có bị cắt hay không, mã đơn tìm thấy, độ trễ, số lời gọi model, token và chi phí của ticket. |
| **4 đội** | `KHO_HANG` (Sản phẩm & Tồn kho), `THANH_TOAN` (Thanh toán & Hoàn tiền), `VAN_CHUYEN` (Giao hàng), `DOI_TRA` (Đổi trả & Bảo hành) |

Ví dụ cho thấy vì sao 30% ticket cần tra cứu. Ticket *"Đơn ORD1002 sao mãi không thấy giao?"* nghe như việc của đội Giao hàng. Nhưng khi tra đơn thì thấy **thanh toán VNPAY thất bại**, nên đơn chưa từng được xuất kho và đội đúng là Thanh toán. Cùng một câu hỏi *"chưa thấy giao"* có thể thuộc 3 đội khác nhau:

| Trạng thái thật của đơn | Đội đúng |
|---|---|
| Thanh toán thất bại / chờ thanh toán | THANH_TOAN |
| Chờ nhập hàng (kho hết) | KHO_HANG |
| Đang giao | VAN_CHUYEN |

### Ba giải pháp (khác nhau về kiến trúc, không phải biến thể prompt)

**(a) Một lời gọi phân loại.** Ticket đi vào LLM, LLM trả JSON `{team}`. Không có tool, không đọc dữ liệu.
```
ticket ──► [LLM phân loại] ──► đội
```

**(b) Agent đầy đủ.** Mọi ticket đều vào một vòng lặp agent có tool `get_order`. Agent tự quyết định có tra đơn hay không, rồi gọi `route_issue`.
```
ticket ──► [Agent] ⇄ get_order ──► route_issue ──► đội
```

**(c) Lai (đã chọn).** Code tiền xử lý trước, rồi đưa qua bộ phân loại (1 lời gọi, có tách vấn đề và có cờ `needsLookup`). Chỉ các vấn đề có `needsLookup=true` mới vào agent.
```
ticket ──► [Tiền xử lý: cắt, trích mã đơn] ──► [LLM phân loại] ──┬─ needsLookup=false (~70%) ──► đội
                                                                 └─ needsLookup=true  (~30%) ──► [Agent ⇄ get_order] ──► đội
           (lỗi / quá giờ ở bất kỳ bước nào ──► dự phòng từ khoá hoặc giữ đội tạm + cờ needsHumanReview)
```

---

## B. So sánh và lựa chọn

### Giả định đầu vào (tất cả nằm trong [src/costModel.js](src/costModel.js))

| Giả định | Giá trị | Ghi chú |
|---|---|---|
| Khối lượng | 3.000 × 30 = **90.000 ticket/tháng** | |
| Model | `gemini-3.5-flash-lite`: **$0,30 / 1M token vào, $2,50 / 1M token ra** | Giá lấy từ các trang tổng hợp giá, cần đối chiếu với trang giá chính thức của Google khi chạy thật. Sửa ở `PRICING` trong [src/llm.js](src/llm.js). |
| Tỉ giá | 1 USD = 26.000 đ | |
| Token tiếng Việt | ~1,5 token/từ; ticket TB 120 từ; 2% ticket dài 4.000 từ, cắt còn 600 từ | Token nội dung TB = (0,98×120 + 0,02×600)×1,5 = **194 token** |
| Prompt cố định | classifier 700 token; agent (b) 1.200 token (prompt + tool dài hơn); agent (c) 800 token | |
| Độ trễ 1 lời gọi | classifier ~0,9 s; 1 bước agent ~1,1 s; tra DB 50 ms | Output ngắn, thinking ở mức MINIMAL |
| Chi phí gán sai | 6 phút × 40.000 đ/giờ (~7 triệu/tháng ÷ 176 giờ) = **4.000 đ/ticket** | |
| Độ chính xác | ticket thường 95% cho cả 3 cách. Ticket cần tra cứu: (a) **60%**, (b)/(c) **92%** | (a) không nhìn thấy trạng thái đơn nên chỉ đoán theo chữ. Số đo thật lấy bằng `npm run eval`. |

### Cách tính chi phí, ví dụ với (c) Lai

```
Ticket thường (70%):   1 lời gọi classifier
  input  = 700 + 194                    =   894 token      output = 120
Ticket tra cứu (30%):  classifier + 2 bước agent (get_order → route_issue)
  input  = 894 + (800+225) + (800+225+330) = 3.274 token   output = 120 + 80 + 80 = 280
         (225 = đoạn trích 150 từ; 330 = lịch sử vòng trước + kết quả tool)

Trung bình 1 ticket: input  = 0,7×894 + 0,3×3.274 = 1.608 token
                     output = 0,7×120 + 0,3×280   =   168 token
Tiền/ticket = 1.608×0,30/1e6 + 168×2,50/1e6 = $0,000483 + $0,000420 = $0,000903
Tiền/tháng  = 0,000903 × 90.000 × 26.000 đ ≈ 2.111.900 đ
```
(a) và (b) tính theo cùng công thức. Chạy `npm run cost` để xem đủ cả bảng.

### Bảng so sánh

| Tiêu chí | (a) 1 lời gọi phân loại | (b) Agent đầy đủ | **(c) Lai** |
|---|---|---|---|
| Lời gọi model / ticket | 1,00 | 1,73 | 1,60 |
| Token vào / ra mỗi ticket | 894 / 120 | 2.703 / 138 | 1.608 / 168 |
| **Chi phí API / tháng** | **1,33 triệu** ✅ | **2,71 triệu** ✅ (dùng 68% ngân sách) | **2,11 triệu** ✅ (dùng 53% ngân sách) |
| Số ticket/ngày tối đa trước khi vượt 4 triệu | ~9.000 | ~4.400 | ~5.700 |
| **Độ trễ trung bình** | 0,9 s | 1,95 s | 1,58 s |
| Độ trễ ca tra cứu | 0,9 s | 2,8 s | 3,15 s |
| Ca xấu nhất (mỗi lời gọi chậm gấp đôi), khi chưa có hạn chót | 1,8 s | 6,7 s ❌ | 6,3 s, nhưng bị chặn ở 4,5 s và trả đội tạm |
| **Độ chính xác dự kiến** | **84,5%** | **94,1%** | **94,1%** |
| Ticket gán sai / tháng | 13.950 (1.395 giờ người) | 5.310 (531 giờ) | 5.310 (531 giờ) |
| Chi phí nhân sự chuyển tay | **55,8 triệu** | 21,2 triệu | 21,2 triệu |
| Khi model lỗi hoặc quá giờ | chỉ còn từ khoá | chưa có kết quả gì, chỉ còn từ khoá | **đã có đội từ tầng 1**, chỉ mất bước tra cứu |
| Ticket đa vấn đề | được, nếu schema trả mảng | agent phải tự tách trong vòng lặp, khó kiểm soát | tầng 1 tách thành mảng; mỗi vấn đề tra cứu chạy agent **song song** |
| **Độ phức tạp bảo trì** | Thấp: 1 prompt, 1 schema | Cao: prompt dài, vòng lặp tool không tất định, khó tái hiện lỗi | Trung bình: 2 prompt, mỗi tầng test riêng, luật tra cứu gom một chỗ |
| Ưu điểm chính | Rẻ nhất, nhanh nhất, đơn giản | Linh hoạt nhất, ca tra cứu nhanh hơn (c) 0,35 s | Rẻ hơn (b) 22%, chính xác như (b), luôn có đường lui |
| Nhược điểm chính | Sai 40% ca cần tra cứu, tiền chuyển tay gấp ~40 lần tiền API | Trả giá agent cho cả 70% ticket không cần; ít dư ngân sách | Ca tra cứu thêm 1 lời gọi; có 2 prompt phải đồng bộ |

### Lựa chọn: (c) Lai, và căn cứ

1. **Ràng buộc 4 triệu đ/tháng.** (a), (b), (c) đều đạt theo giả định, nhưng mức dư khác nhau. (c) dùng 53% ngân sách, (b) dùng 68%. Kiểm tra độ nhạy: nếu model sinh thêm khoảng 200 token "thinking" mỗi lời gọi (ví dụ khi quên tắt thinking), (b) tăng lên **4,73 triệu và vượt ngân sách**, còn (c) lên 3,98 triệu và vẫn trong ngân sách. Khi lượng ticket tăng, (b) vượt ngân sách từ khoảng 4.400 ticket/ngày, (c) từ khoảng 5.700.
2. **Ràng buộc 5 giây.** 70% ticket của (c) chỉ tốn 1 lời gọi (~0,9 s). Ca tra cứu tốn khoảng 3,15 s, vẫn còn dư 1,35 s. Quan trọng hơn, (c) có **hạn chót cứng 4,5 s** (giữ lại 0,5 s để ghi ticket và phản hồi khách). Nếu agent chưa xong, hệ thống vẫn trả về đội tạm mà classifier đã chọn. (b) cũng đặt được hạn chót, nhưng khi agent quá giờ thì chưa có kết quả phân loại nào để dùng.
3. **Chi phí 6 phút mỗi lần gán sai.** Đây là yếu tố loại (a). (a) tiết kiệm được khoảng 0,78 triệu tiền API mỗi tháng so với (c), nhưng gán sai thêm khoảng **8.640 ticket/tháng, tức 864 giờ người, khoảng 34,6 triệu đ**. Số tiền tiết kiệm không bù được chi phí đó.
4. **Tóm lại:** (c) chính xác như (b), rẻ và nhanh hơn ở mức trung bình, và có đường lui tốt hơn khi model lỗi hoặc quá giờ.

---

## C. Thiết kế và triển khai

### Các bước xử lý một ticket ([src/router.js](src/router.js))

| Bước | Làm gì | AI? | Đường lui |
|---|---|---|---|
| 1. Tiền xử lý ([preprocess.js](src/preprocess.js)) | Chuẩn hoá khoảng trắng. **Trích mọi mã đơn `ORD…` từ toàn văn**. Nếu dài hơn 600 từ thì giữ 200 từ đầu và 400 từ cuối, thay phần giữa bằng `[... đã lược bỏ N từ ...]`. Chặn thêm ở 6.000 ký tự. | Không | Ticket rỗng hoặc không phải chuỗi thì trả `REJECTED`, không tốn lời gọi model |
| 2. Phân loại ([classifier.js](src/classifier.js)) | 1 lời gọi, `responseSchema` JSON, `temperature 0`, timeout 2 s. Trả về `issues[]` (tối đa 3), mỗi phần tử có `team`, `summary`, `needsLookup`, `orderId`. Code kiểm tra lại toàn bộ output. | Có | JSON hỏng, đội lạ, lỗi mạng hoặc quá giờ thì chuyển sang dự phòng từ khoá ([fallback.js](src/fallback.js)), gắn `needsHumanReview` |
| 3. Tra cứu ([lookupAgent.js](src/lookupAgent.js)) | Chỉ cho vấn đề có `needsLookup=true`. Tool `get_order` (chỉ đọc) và `route_issue` (chốt đội, `enum` 4 đội). `mode: ANY` để model buộc phải gọi tool. Tối đa 3 vòng. Các vấn đề chạy song song. | Có | Quá giờ, quá 3 vòng hoặc đội không hợp lệ thì giữ đội tạm của bước 2, gắn `needsHumanReview` |
| 4. Gộp ([router.js](src/router.js) `mergeByTeam`) | Hai vấn đề cùng một đội được gộp thành 1 phiếu con | Không | |

### Xử lý 2 bẫy dữ liệu

**Ticket 4.000 từ**
- Cắt bằng code trước khi gọi model. Mỗi lời gọi chỉ nhận tối đa khoảng 600 từ (~900 token) thay vì ~6.000 token, nên chi phí và độ trễ không phụ thuộc độ dài ticket.
- Giữ **đầu và cuối**: khách thường viết yêu cầu ở đầu rồi dán lịch sử, hoặc dán lịch sử rồi hỏi ở cuối. Phần giữa thường là hội thoại cũ đã giải quyết xong.
- Bẫy con: mã đơn có thể nằm đúng ở phần bị cắt (ticket mẫu T18). Vì vậy mã đơn được **trích từ toàn văn trước khi cắt**, gửi kèm cho classifier làm gợi ý, và router dùng mã đó cho agent nếu classifier trả `orderId = null`.
- Prompt dặn model ưu tiên yêu cầu mới nhất, không phân loại theo các câu hỏi cũ trong lịch sử.

**Ticket nhiều vấn đề**
- Schema trả về **mảng** `issues` thay vì một `team` duy nhất. Prompt có ví dụ cụ thể "vừa hỏi tồn kho vừa khiếu nại thanh toán thì là 2 phần tử".
- Mỗi vấn đề thành một phiếu con cho đúng đội. Vấn đề nào cần tra cứu thì chạy agent riêng, song song, chung một hạn chót. Vấn đề còn lại không phải chờ.
- Dự phòng từ khoá cũng trả nhiều đội khi khớp nhiều nhóm từ khoá.

### Cấu trúc mã nguồn
```
bai4/
├── src/
│   ├── teams.js         # 4 đội + từ khoá dự phòng
│   ├── preprocess.js    # cắt ticket dài, trích mã đơn
│   ├── llm.js           # gọi Gemini có timeout + đếm token + bảng giá
│   ├── classifier.js    # tầng 1: 1 lời gọi, JSON schema
│   ├── lookupAgent.js   # tầng 2: agent get_order → route_issue
│   ├── fallback.js      # phân loại bằng từ khoá khi model lỗi/quá giờ
│   ├── router.js        # ghép các tầng, hạn chót 5 s
│   ├── orderDb.js       # dữ liệu đơn giả lập
│   └── costModel.js     # mô hình chi phí/độ trễ/độ chính xác 3 kiến trúc
├── data/sampleTickets.js  # 18 ticket có nhãn, gồm 2 ticket ~4.000 từ và 2 ticket đa vấn đề
├── scripts/  cost.js · route.js · eval.js
└── test/     router.test.js · fakeAi.js (Gemini giả)
```

### Hướng cải thiện
- **Lấy trước dữ liệu đơn bằng code** khi classifier đã có `orderId`, rồi đưa thẳng vào agent. Agent chỉ còn 1 bước, nên ca tra cứu giảm từ ~3,15 s xuống ~2 s.
- Các luật tra cứu hiện tại khá tất định. Khi đã ổn định có thể chuyển hẳn sang code, giữ agent cho các ca mơ hồ.
- Dùng context caching cho system prompt nếu prompt dài ra.
- Thay các giả định độ chính xác bằng số đo `npm run eval` trên vài trăm ticket thật đã gán nhãn.
