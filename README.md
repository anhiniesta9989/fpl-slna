# FPL Master Dashboard v2

MVP dashboard kiểu FPLGameweek nhưng tập trung thêm vào **planning 4–6 Gameweek**.

Default manager: **2320843**.

## Chạy local

Yêu cầu: Node.js 18+.

```bash
npm start
```

Mở:

```text
http://localhost:8787
```

Không cần `npm install` vì MVP dùng **0 dependency** ngoài Node.js built-in APIs.

## Dữ liệu public được proxy

Server gọi các public endpoint của FPL:

- `bootstrap-static/`
- `fixtures/`
- `entry/{team_id}/`
- `entry/{team_id}/history/`
- `entry/{team_id}/event/{gw}/picks/`
- `event/{gw}/live/`

Proxy local:

- `/api/fpl/bootstrap`
- `/api/fpl/fixtures`
- `/api/fpl/entry/:id`
- `/api/fpl/history/:id`
- `/api/fpl/picks/:id/:gw`
- `/api/fpl/live/:gw`

Có cache mặc định 120 giây để tránh gọi API liên tục. Có thể đổi bằng `CACHE_TTL_MS`.

## Privacy / login

MVP **không yêu cầu đăng nhập FPL**, không lưu password, cookie hoặc token. Endpoint authenticated `/my-team/{id}/` không được proxy.

Điều này có nghĩa:

- Squad public gần nhất: tự động.
- Live/public points: tự động.
- FT chính xác trước deadline, selling price, pending transfers: không lấy được từ public API.
- FT trong dashboard là manual/localStorage.
- Transfer planner chỉ mô phỏng, không submit lên FPL.

## Tính năng MVP

- Manager summary + GW/deadline.
- Pitch / formation.
- Bench + captain / vice.
- Bảng đánh giá 15 cầu thủ.
- `Start confidence %` heuristic.
- `Hold 4–6GW /10` heuristic dựa trên form, ppg, xGI, fixture, minutes, value.
- Transfer planner local, preview Hold delta / budget delta.
- H2H bằng opponent Team ID.
- Challenge rule card + draft local; không tự đoán Challenge rule.
- Offline demo để UI vẫn xem được khi FPL API/network tạm lỗi.

## Deploy

Vì chỉ là Node server chuẩn, có thể deploy lên Render, Railway, Fly.io, VPS, Docker hoặc bất kỳ host nào chạy `node server.mjs`.

Biến môi trường:

```text
PORT=8787
CACHE_TTL_MS=120000
USER_AGENT=FPL-Master-Dashboard/0.1
```

## Lưu ý

Đây là công cụ không chính thức, không liên kết với Premier League. API public có thể thay đổi schema bất kỳ lúc nào.


## v2 additions
- Club-colour shirt cards on the pitch and bench.
- Current local squad override for Mosquera → Konsa and Igor Jesus → Wissa until public GW4 picks become available.
- H2H projected score, heuristic win/draw/loss probability, captain battle, biggest swings, and SAFE/BALANCED/AGGRESSIVE strategy suggestion.
- H2H opponent team-value model: current public squad value, declared team value/bank, GW-over-GW value trend, and budget-aware suggestions that do not blindly copy the opponent.

## v3 — H2H Recommendation Engine

Tab **H2H** giờ có thêm Recommendation Engine với 3 lớp quyết định:

- **H2H — hành động GW này**: SAFE/BALANCED/AGGRESSIVE, captain model và tối đa 2 transfer gợi ý chỉ khi move vừa tăng xPts H2H vừa không làm xấu 4–6GW.
- **4–6 Gameweek**: xếp hạng upgrade theo projected points, Hold score, Start confidence và fixture; không chase một blank/haul.
- **Cấu trúc cả mùa**: weak links, core nên bảo vệ, WC watch/NO WC và FT policy.

Các transfer recommendation chỉ là mô hình hỗ trợ. Dashboard hiển thị chênh lệch giá theo current price; hãy xác nhận selling price/bank thực tế trong FPL trước khi bấm transfer.

Baseline local hiện đã migrate một lần sang trạng thái sau `Mosquera → Konsa`, `Igor Jesus → Wissa`, và FT mặc định còn `1` sau hai transfer. Bạn vẫn có thể sửa FT thủ công.
