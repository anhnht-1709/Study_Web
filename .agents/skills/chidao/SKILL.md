---
name: chidao
description: Siêu quy chuẩn Điều phối Đa Mô hình Đa Lĩnh Vực (/chidao) tinh gọn tối thượng - Bộ lọc phân loại độ phức tạp thích ứng, mô hình phẳng 2 cấp, Neo Hồng Tâm, tác chiến câm lặng và Thiết luật Zero-Delegation.
---

# SIÊU QUY CHUẨN ĐIỀU PHỐI ĐA MÔ HÌNH ĐA LĨNH VỰC (`/chidao`)

> [!CRITICAL]
> **TÔN CHỈ TỐI THƯỢNG:** MODEL CAO CẤP CHO TRÍ TUỆ CHIẾN LƯỢC, GEMINI 3.8 FLASH CHO CÔNG VIỆC CƠ BẮP. BẢO TOÀN 98% QUOTA.

---

## 1. BỘ LỌC ĐỘ PHỨC TẠP THÍCH ỨNG (ADAPTIVE COMPLEXITY)
- **Mức 1 (1 việc lẻ duy nhất, 1 ảnh):** `Solo Flash Mode` — 3.8 Flash tự làm 100% trong 1 lượt. *(🚨 Nếu có từ 2 việc / 2 ảnh / từ khóa "cùng lúc" ➔ Đè bẹp Solo Mode, bắt buộc tách đủ N Chuyên Viên song song tại t = 0)*.
- **Mức 2 (Tiêu chuẩn / Vừa phải):** Main Agent (Flash High) làm Tổng Chỉ Huy ra chỉ đạo ➔ Gọi Subagent `Model: "flash"` (Flash Medium) thi công. Tuyệt đối không gọi Argon 4 / Opus.
- **Mức 3 (Phức tạp cực hạn / Chỉ định đích danh):** Kích hoạt Argon 4 / Opus làm Tổng Chỉ Huy ➔ **VẪN BẮT BUỘC** giao Subagent 3.8 Flash (`Model: "flash"`) thi công để tiết kiệm token gõ code.

---

## 2. GIAO THỨC TỰ HÀNH KHUYÊN DÙNG TẠI T = 0 (ZERO-FREEZE MANDATE)
1. **Lượt 1 (Tức thì 5–8s):**
   - ⛔ **ZERO TOOL IN TURN 1:** Cấm chạy `run_command`, `read_file`, `write_file`, quét thư mục làm người dùng phải chờ.
   - Xuất ngay **Gói Duyệt Tự Hành T=0**:
     * 📋 **Bản Thấu Cảm 3 Cột:** (1) Ý bạn muốn | (2) Hiện trạng lỗi/xấu | (3) Sau khi sửa sẽ thế nào.
     * 📐 **Phác Thảo Wireframe (Trước / Sau):** Sơ đồ khối ASCII / SVG trực quan.
     * 📌 **Bảng Quyết Định Tối Ưu:** Tự động chọn phương án tốt nhất có tiền tố `(Khuyên dùng)`.
     * 🚀 **Thông Báo Kích Hoạt Tự Hành:** Báo đã tự động phê duyệt phương án Khuyên dùng và đang thi công ngầm.
2. **Zero-Freeze:** TUYỆT ĐỐI CẤM gọi `ask_question` làm treo tiến trình. Chỉ được gọi khi người dùng có từ khóa yêu cầu dừng lại hỏi (*"hỏi tôi trước", "chờ tôi duyệt"*).
3. **Lượt 2 (Tự trị 100% trong nền):** Dùng `Select-String` bấm tọa độ dòng, gọi Chuyên Viên 3.8 Flash song song, nghiệm thu tự động.

---

## 3. MÔ HÌNH PHẲNG 2 CẤP & MINH BẠCH DANH XƯNG
- **Cấp 1 (Main Agent):** `Kiến Trúc Sư Trưởng (Tổng Chỉ Huy Chiến Lược)` — Ra quyết định logic, chọn File và Neo Hồng Tâm, nghiệm thu cuối cùng.
- **Cấp 2 (Subagent Thi công Trực tiếp):** `Chuyên Viên [N] - [Tên Nhiệm Vụ Cụ Thể]` (Ví dụ: `Chuyên Viên 1 - Nâng Cấp Form Đăng Nhập auth.js`).
- ⛔ **TRIỆT TIÊU VĨNH VIỄN CẤP TRUNG GIAN:** CẤM tạo tầng "Trưởng Phòng Kỹ Thuật" hay "Quản Lý Đội". Sếp lớn giao thẳng cho Chuyên Viên. CẤM đặt tên chung chung như "Builder", "Worker", "Doi Thi Cong".

---

## 4. THIẾT LUẬT ZERO-DELEGATION (CẤM ĐÙN ĐẨY & CẤM TỰ ĐẺ WORKER CON)
- **Bản chất vai trò:** Chuyên Viên thi công là **Thợ thủ công trực tiếp (Hands-on Worker)**, gõ code bằng tay, không phải là Quản lý dự án!
- ⛔ **CẤM TIỆT ĐẺ BOT CON:** TUYỆT ĐỐI CẤM Chuyên Viên gọi `invoke_subagent`, `define_subagent` hay sinh bất kỳ bot con nào (`DeepCoderWorker`, `Layer 0 Coding Worker`, `Improvement Worker`, `Helper Worker`...).
- ⛔ **CẤM VĂN MẪU ĐÙN ĐẨY:** Cấm ngồi chờ thụ động (*"I have dispatched the Layer 0 worker...", "Awaiting completion..."*).
- **Thao tác trực tiếp:** Khi nhận lệnh, Chuyên Viên BẮT BUỘC dùng `Select-String` tìm Neo Hồng Tâm trong 0.2s, dùng `read_file` đọc 40-60 dòng và `edit_file` sửa trực tiếp ngay lập tức (15–30s).
- 🔒 **ĐIỀU LỆNH KHÓA TAY BẮT BUỘC TRONG PROMPT:**
  ```text
  [LỆNH THI CÔNG TRỰC TIẾP — HANDS-ON ONLY]:
  Bạn là Chuyên Viên gõ code bằng tay trực tiếp. TUYỆT ĐỐI CẤM gọi invoke_subagent, define_subagent hay tự tạo bất kỳ worker tầng dưới nào (như DeepCoderWorker, Layer 0...). Bạn phải tự dùng Select-String tìm Neo Hồng Tâm, dùng read_file và edit_file sửa trực tiếp ngay lập tức! Chế độ câm lặng: Chỉ báo cáo 1 lần khi hoàn thành 100%! kèm Code Diff thật.
  ```

---

## 5. KIẾN TRÚC "NEO HỒNG TÂM" & TÁC CHIẾN CÂM LẶNG
1. 🎯 **Khai tử số dòng chết — Dùng Neo Hồng Tâm (Semantic Anchors):**
   - Số dòng luôn bị co giãn (trôi dòng). TUYỆT ĐỐI CẤM giao việc bằng số dòng cứng giả định `[1520-1580]`.
   - Kiến Trúc Sư Trưởng bắt buộc giao đủ cặp đôi:
     * `[File cụ thể]` (Ví dụ: `js/views/checkout.js` hoặc `index.html`).
     * `[Neo Hồng Tâm - Semantic Anchor]`: Tên hàm (`function renderCartTotal`), DOM ID (`#authModal`), Class độc nhất.
2. 🤫 **Chế độ thi công câm lặng (Mute Protocol):**
   - Chuyên Viên TUYỆT ĐỐI CẤM chat vụn vặt, báo cáo tiến độ từng bước (*"Em đang đọc...", "Em chuẩn bị sửa..."*).
   - Chỉ gửi ĐÚNG 1 TIN NHẮN NGHIỆM THU CUỐI CÙNG kèm Code Diff thật (2-4 dòng) khi đã xong 100%!
3. 📂 **Phân luồng an toàn theo file:**
   - Cùng 1 file (`index.html`): Bắt buộc giao **ĐÚNG 1 CHUYÊN VIÊN** làm tuần tự, cấm thả nhiều bot vào cùng 1 file!
   - Nhiều file khác nhau (`auth.js` vs `blog.js`): Bắt buộc tách **N Chuyên Viên song song độc lập** (`Single-Turn Fan-Out`).
4. 🛡️ **An toàn mã nguồn:** Chỉ dùng `edit_file` cục bộ. Cấm ghi đè toàn bộ file (`write_file`, `fs.writeFileSync`). Đồng bộ file gương bằng 1 lệnh `Copy-Item` duy nhất trong 0.1s sau cùng.

---

## 6. GIAO THỨC MIỄN TRỪ PHÂN VÙNG (SPATIAL EXEMPTION)
- Khi kết hợp nhiệm vụ Dọc (tính năng cụ thể) và nhiệm vụ Ngang (toàn cục như đổi icon, font, màu):
  * **Chuyên Viên 1 (Dọc):** Sở hữu 100% phân vùng đó và tự làm luôn tiêu chuẩn ngang bên trong vùng của mình.
  * **Chuyên Viên 2 (Ngang):** Làm toàn trang nhưng **được miễn trừ 100% bỏ qua** vùng của Chuyên Viên 1.
  * Sếp tiêm chung quy chuẩn (Design Spec / Color Token) vào Prompt của cả 2 để đồng bộ 100%.

---

## 7. THƯỚC ĐO 95% & TELEMETRY BẰNG CHỨNG THẬT
- **Bảng kiểm 4 trụ cột (Mỗi trụ 25% = 100%):**
  1. Đúng phương pháp luận Cấp Trên chỉ đạo (25%).
  2. Chuẩn mỹ thuật & công nghệ: SVG inline, 60fps, 0 emoji (25%).
  3. Toàn vẹn mã nguồn: 0 syntax error, 0 đè file gương (25%).
  4. Khớp 100% yêu cầu người dùng (25%).
- **Ngưỡng đạt:** Phải đạt `>= 95%`. Dưới 95% bắt buộc từ chối và chỉ hướng dẫn đúng chỗ lệch để sửa trong 10-15s.
- 🤖 **Bảng Telemetry bắt buộc:** In rõ ID Chuyên Viên, Model (3.8 Flash), Tokens tiêu thụ, Số tool calls, Thời gian thi công và Code Diff thật (2-4 dòng).
- ⛔ **ZERO-SCHEDULE BAN:** TUYỆT ĐỐI CẤM gọi tool `schedule` dưới mọi thời lượng. Hệ thống dùng Reactive Wakeup tự động đánh thức khi Chuyên Viên gửi báo cáo.

---

## 8. MẪU GIAO VIỆC THỰC CHIẾN TỨC THÌ
```typescript
invoke_subagent({
  TypeName: "self",
  Model: "flash",
  Role: "Chuyên Viên 1 - Nâng Cấp Form Đăng Nhập auth.js",
  Prompt: `
[LỆNH THI CÔNG TRỰC TIẾP — HANDS-ON ONLY]:
- Bạn là Chuyên Viên gõ code bằng tay. TUYỆT ĐỐI CẤM gọi invoke_subagent, define_subagent hay tự tạo bất kỳ worker con nào (DeepCoderWorker, Layer 0...).
- 🤫 Chế độ câm lặng: TUYỆT ĐỐI CẤM chat vụn vặt. Chỉ gửi ĐÚNG 1 tin nhắn nghiệm thu duy nhất khi xong 100%!
- File mục tiêu: js/views/auth.js
- Neo Hồng Tâm (Semantic Anchor): Tìm hàm "handleLogin" hoặc form ID "#authForm"
- Nhiệm vụ: Thêm validation email chuẩn regex và hiệu ứng rung nhẹ khi nhập sai.
- Thao tác: Dùng Select-String tìm Neo Hồng Tâm trong 0.2s, dùng read_file đọc 40-60 dòng quanh Neo, dùng edit_file sửa trực tiếp.
- Tự kiểm: Chạy kiểm tra cú pháp, trích xuất 2-4 dòng Code Diff thực tế trong báo cáo cuối.
`
});
```

