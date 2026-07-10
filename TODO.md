# TODO — những gì còn thiếu để gọi là production

Tài liệu này liệt kê nợ kỹ thuật **đã biết**. Nó không phải danh sách ước mơ; mỗi mục là một
chỗ hệ thống hiện đang im lặng, xấp xỉ, hoặc chưa được chứng minh. Thư viện im lặng về giới
hạn của nó là thư viện dối trá.

Trạng thái tại thời điểm viết: 166 test pass, 1 skip. `tsc -b` và `tsc -p tsconfig.test.json` sạch.
Benchmark `book.apply`: ~3.7–4.0M event/giây (Node 20.9, một máy, chưa có ngưỡng chặn hồi quy).

---

## P0 — Chặn việc tin vào bất kỳ con số nào

### 1. Golden gate chưa từng đóng trên dữ liệu thật
`packages/adapters/lobster/test/golden.test.ts`

`L3Book` mới chỉ được đối chiếu với fixture 8 event tự tính tay. Test trên LOBSTER thật đang
**skip** vì `data/` rỗng. Cho tới khi nó chạy xanh, **mọi** con số markout, OFI, PnL trong repo
này đều chưa được kiểm chứng — book sai thì cả ba vẫn chạy, vẫn ra số đẹp, không ai biết.

- [ ] Tải mẫu free từ lobsterdata.com, đặt `AAPL_..._message_10.csv` + `_orderbook_10.csv` vào `data/`
- [ ] Chạy `npx vitest run packages/adapters/lobster` và xác nhận khớp từng dòng
- [ ] Xử lý order tồn tại trước phiên: LOBSTER có thể phát type 2/3/4 cho orderId chưa từng
      thấy. Hiện đếm vào `unknownOrderEventCount` rồi bỏ qua. Nếu số này > 0 trên dữ liệu thật,
      book đang lệch ngầm so với ground truth — phải quyết định cách xử lý, không được im lặng.
- [ ] Gắn assertion: `unknownOrderEventCount === 0` sau khi replay

### 2. Không có transport mạng
`packages/adapters/binance/src/transport.ts`, `apps/live/src/main.ts`

`BinanceGateway` có đủ L2 book, đồng bộ depth, máy trạng thái lệnh, queue cursor. Thiếu đúng
một thứ: một class implement `OrderTransport` và một vòng đọc WebSocket. Đây là **chỗ duy nhất
spec cho phép thêm npm dependency**.

- [ ] Implement `OrderTransport` qua REST (`POST /api/v3/order`, `DELETE /api/v3/order`)
- [ ] Ký HMAC-SHA256 (dùng `node:crypto`, không cần dep)
- [ ] Quản lý credential ngoài repo (biến môi trường; `.env` đã gitignore)
- [ ] WebSocket feed bơm vào `onDepthUpdate` / `onTrade` / `onExecutionReport`
- [ ] `listenKey` + gia hạn định kỳ cho user data stream
- [ ] REST `GET /api/v3/depth` để lấy snapshot khi `onResyncRequired()` bắn

### 3. Vòng reconcile không có nguồn dữ liệu
`apps/live/src/main.ts` — `fetchExchangeAccount` hiện **ném lỗi**

Logic `LiveSession.reconcileNow()` đúng và có test, nhưng ở daemon thật nó không có gì để đối
chiếu. Đó là lý do `--dry-run` không gọi `session.start()`. **Bug reconcile làm mất tài khoản.**

- [ ] `GET /api/v3/account` + `GET /api/v3/openOrders` → `AccountSnapshot`
- [ ] Quyết định hành vi khi REST timeout: hiện tại exception sẽ giết vòng lặp im lặng

### 4. `maxLossTicks` không bao giờ được kích hoạt
`packages/live/src/kill_switch.ts`, `packages/live/src/guarded_gateway.ts`

`onPnlTicks()` tồn tại, có test, và **không ai gọi nó trong đường chạy thật**. Ngưỡng cắt lỗ
lớn nhất của hệ thống hiện là code chết.

- [ ] Tính PnL mark-to-market theo chu kỳ trong `LiveSession` (cash + position × mid)
- [ ] Gọi `guarded.onPnlTicks()` mỗi vòng reconcile
- [ ] Test: chạm ngưỡng → huỷ hết lệnh + dừng

### 5. Kill switch không có mặt trong backtest
`packages/sim/src/engine.ts`

`risk.*` chỉ được thực thi ở tầng `live`. Sim chạy không có giới hạn nào ngoài
`strategy.maxPosition`. **Backtest và live vì thế không chạy cùng luật rủi ro** — đúng thứ bệnh
mà kiến trúc này sinh ra để tránh.

- [ ] Bọc `SimGateway` bằng `GuardedGateway` (nó implement `Gateway`, không cần sửa strategy)
- [ ] Parity test: cùng chuỗi event, kill switch trip ở cùng một điểm trong sim và paper

---

## P1 — Sim đang nói dối theo những cách đã biết

### 6. Self-impact / market response không được mô phỏng
`packages/sim/src/engine.ts`

Lệnh ảo không nằm trong book. Lịch sử không phản ứng với lệnh của bạn. Kết quả chỉ đáng tin khi
lệnh **nhỏ so với depth**. Không có cơ chế nào cảnh báo khi vi phạm giả định đó.

- [ ] Ghi tỉ lệ `orderSize / depth_at_level` cho mỗi fill vào `fills`
- [ ] Cảnh báo trong `metrics.json` nếu phân vị 95 của tỉ lệ đó vượt ngưỡng config
- [ ] Cân nhắc mô hình impact tối giản (square-root law) như một tuỳ chọn, mặc định TẮT

### 7. Taker fill ăn thanh khoản mà không xoá khỏi book
`packages/sim/src/engine.ts` (`onOrderArrival`), `packages/live/src/paper_gateway.ts`

`takerWalk` đọc depth và khớp, nhưng không giảm size các level đã ăn. Hai lệnh taker liên tiếp
trong cùng một nano-giây sẽ cùng ăn hết một level. Hệ quả trực tiếp của mục 6.

- [ ] Ít nhất: trừ tạm size đã tiêu trong phạm vi một event, để hai taker không nhân đôi thanh khoản

### 8. Latency là ba hằng số, không phải phân phối
`contracts/config.ts` → `latency.{marketDataNs, decisionNs, orderEntryNs}`

Latency thật có đuôi. Đuôi mới là thứ giết bạn. Hiện sim dùng ba số cố định nên mọi kết quả đều
là "trường hợp trung bình" — trường hợp không bao giờ xảy ra.

- [ ] Cho phép phân phối (hằng số / lognormal / mẫu thực nghiệm từ file), có seed
- [ ] `sim.seed` hiện **được validate nhưng không ai đọc** — nối nó vào PRNG này
- [ ] Determinism test phải vẫn xanh với seed cố định

### 9. Chưa từng đo simulator có nói dối hay không
Cả `fills` và `live_fills` đã dùng **chung một schema** — đó là toàn bộ lý do schema trùng nhau.
Nhưng **không có công cụ nào so sánh chúng**. Vòng phản hồi tồn tại trên giấy, chưa tồn tại trong code.

- [ ] `apps/compare`: đọc `fills.csv` + `live_fills.csv`, khớp theo `client_order_id`
- [ ] Báo cáo: chênh lệch fill ratio, chênh lệch `queue_position_at_fill`, fill có trong sim mà
      không có trong live (và ngược lại), chênh lệch markout
- [ ] Đây là chỉ số quan trọng nhất của cả repo. Không có nó, sim là ý kiến.

### 10. Mô hình queue của L2 là xấp xỉ, chưa được kiểm chứng
`packages/book/src/l2_book.ts`

Trên L2, `setLevel` giảm size không làm tiến hàng đợi (huỷ có thể nằm sau ta), chỉ `applyTrade`
mới tiến. Đây là lựa chọn bảo thủ, hợp lý — nhưng **chưa ai chứng minh nó gần sự thật đến đâu**.

- [ ] Property test: replay L3 (ground truth) → sinh ra L2 tương ứng → so `cursorAhead` của
      `L2Book` với `L3Book`. Đo sai số, ghi vào README.

---

## P2 — Nghiên cứu định lượng

### 11. Một lần tách mẫu không phải là validation
`apps/train/src/main.ts`

Hiện chỉ có train/test 70/30 theo thời gian. Đủ để bắt overfit thô (và nó **đã bắt**: out-of-sample
R² = −0.53), nhưng không đủ để chọn `lambda` hay so sánh model.

- [ ] Walk-forward / purged k-fold có embargo (tránh rò rỉ qua horizon chồng lấn)
- [ ] Chọn `lambda` bằng CV thay vì cố định trong config
- [ ] Với horizon 1s và lưới 100ms, **10 hàng liền kề chồng lấn nhau** — hiện chưa embargo

### 12. Biến mục tiêu không giao dịch được
`y = mid[t+h] - mid[t]`. Không trừ phí, không trừ spread phải trả để vào lệnh. Một model có IC
dương trên mid vẫn có thể lỗ sau chi phí.

- [ ] Thêm biến mục tiêu thay thế: PnL sau phí của một lệnh giả định tại quote hiện tại

### 13. OFI mới là mức tốt nhất, và `ofiWindowNs` là code chết
`packages/metrics/src/ofi.ts`

Cont/Kukanov/Stoikov 2014 dùng OFI mức tốt nhất — đúng như đang làm. Nhưng bản mở rộng nhiều mức
(Cont et al. 2021) mạnh hơn đáng kể. Và `metrics.ofiWindowNs` **được validate nhưng không ai đọc**;
OFI hiện được reset theo ô lưới của `train.gridIntervalNs`, không theo cửa sổ cấu hình.

- [ ] Nối `ofiWindowNs`, hoặc xoá nó khỏi schema
- [ ] Multi-level OFI có trọng số theo độ sâu

### 14. Trường config được validate nhưng không ai đọc
Đây là nợ nguy hiểm: người dùng chỉnh nó, tin rằng nó có tác dụng, và không có gì báo lỗi.

- [ ] `sim.seed` — xem mục 8
- [ ] `metrics.ofiWindowNs` — xem mục 13
- [ ] `instrument.lotSize` — chưa dùng để làm tròn/validate `orderSize`
- [ ] `output.format` — chỉ chấp nhận `"csv"`, không có nhánh code nào rẽ theo nó

Nguyên tắc: hoặc nối vào, hoặc xoá khỏi `STRATEGY_CONFIG_SPEC`. Không để lơ lửng.

### 15. `priceImprovementTicksMean` dùng tham chiếu thô
`apps/backtest/src/pipeline.ts`

Half-spread tham chiếu = trung bình `spreadTicks` trên toàn bộ lưới feature, chia đôi. Đúng ra
phải là spread **tại thời điểm fill**, không phải trung bình cả phiên.

- [ ] Ghi `spread_ticks_at_fill` vào schema `fills` (bump `SCHEMA_VERSION`)

### 16. Thiếu chỉ số rủi ro cơ bản
`metrics.json` có markout, spread, fill ratio, inventory, PnL.

- [ ] Sharpe / Sortino trên chuỗi PnL theo lưới thời gian
- [ ] Max drawdown
- [ ] Markout tách theo bên (bid/ask) — adverse selection thường bất đối xứng
- [ ] Inventory có trọng số thời gian (hiện là trung bình theo mẫu, đúng vì lưới đều — sẽ sai
      nếu lưới trở nên không đều)

---

## P3 — Vận hành và độ bền

### 17. Idempotency mất khi tiến trình khởi động lại
`packages/live/src/client_order_id.ts`

`ClientOrderIdGenerator` deterministic trong một tiến trình, và `IdempotentSubmitter` giữ
`Set` **trong bộ nhớ**. Restart → mất hết → có thể đặt trùng lệnh. `epoch` hiện lấy từ đồng hồ
lúc khởi động, nên restart sinh epoch mới, nhưng các lệnh đang treo của epoch cũ thì không ai biết.

- [ ] Ghi `seq` và tập id đã gửi xuống đĩa (append-only), đọc lại lúc khởi động
- [ ] Lúc khởi động: `GET /openOrders` rồi nạp lại vào `OrderRegistry` trước khi gửi lệnh mới

### 18. Đồng hồ
`packages/live/src/real_clock.ts`

- [ ] `performance.now()` trôi so với đồng hồ tường sau nhiều giờ; chưa có tái đồng bộ
- [ ] Không xử lý chuyển ngày (nano-giây tính từ nửa đêm UTC sẽ nhảy về 0)
- [ ] Không xử lý lệch đồng hồ với sàn; chưa dùng `serverTime` của Binance

### 19. Máy trạng thái lệnh không được dùng trong sim
`packages/sim/src/gateway.ts`

Sim không phát ack, không phát reject từ sàn, không có cancel-reject. Strategy vì thế không bao
giờ thực tập các đường lỗi mà nó sẽ gặp khi chạy thật. `OrderRegistry` chỉ sống ở `live`.

- [ ] Cho `SimGateway` phát ack sau `orderEntryLatencyNs`
- [ ] Mô phỏng cancel-reject (lệnh đã khớp trước khi lệnh huỷ tới nơi) — tình huống này **đã**
      xảy ra trong sim nhưng đang bị nuốt im lặng

### 20. Chưa có amend/replace, chưa có huỷ một phần lệnh của mình
Quoter hiện huỷ rồi đặt lại — mất vị trí hàng đợi mỗi lần requote. Sàn thật có cancel-replace.

### 21. Benchmark chưa có ngưỡng chặn hồi quy
`bench/book_bench.ts` đã có chỗ gắn (`HFT_BENCH_FLOOR`) nhưng mặc định tắt vì mới đo trên một máy.

- [ ] Đo trên máy CI, chốt ngưỡng, bật mặc định
- [ ] Bench cho `L2Book.setLevel` và `SimEngine.run`, không chỉ `book.apply`

### 22. `repairBest` quét tuyến tính
`packages/book/src/book.ts`, `packages/book/src/l2_book.ts`

Khi best level rỗng, quét ra ngoài từng tick. Amortized O(1) trên dữ liệu thật, nhưng worst case
theo độ rộng cửa sổ tick. Với dải tick rất rộng và thưa (crypto), đây sẽ là vấn đề.

- [ ] Bitmap/hierarchical bitset của các level không rỗng, hoặc ánh xạ thưa
- [ ] Benchmark chứng minh trước khi đổi

---

## Ghi chú nhỏ

- [ ] `parseCsv` không xử lý ô có dấu ngoặc kép; `formatCell` thì có. Bất đối xứng.
- [ ] Type 5 (hidden) có giá dưới mức tick được **làm tròn** khi parse. Tape mất thông tin sub-tick.
      Ghi rõ hoặc giữ giá thô ở cột riêng.
- [ ] `midTicksAtFill` có thể là `NaN` khi book một phía; CSV ghi ô rỗng. Downstream phải biết
      cột này nullable.
- [ ] Chưa có logging có cấu trúc, chưa export metric ra ngoài (Prometheus/statsd).

---

## Những gì KHÔNG nằm trong kế hoạch

Đã quyết, đừng đề xuất lại:

- Không equities/futures HFT. Trần latency của JS là mili-giây.
- Không kernel bypass, không FIX/OUCH, không colo.
- Không đổi ngôn ngữ.
- Không mạng nơ-ron. Nếu hồi quy tuyến tính không tìm ra tín hiệu thì mạng sâu cũng không —
  nó chỉ giỏi thuyết phục bạn rằng có. (Xem out-of-sample R² = −0.53 hiện tại.)
- Không thêm npm dependency ở runtime, trừ transport trong `adapters/binance` (mục 2).
