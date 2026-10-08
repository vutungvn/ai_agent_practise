// Chạy 1 lời gọi tool của model. Đây là CHỐT CHẶN xác nhận: tool ghi chỉ chạy khi confirm() trả về đúng true.
import { TOOL_KIND } from "../tools/registry.js";

const fail = (code, message) => ({ ok: false, code, message });

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Trả về { result: gửi lại cho model, action: ghi nhận thao tác ghi (nếu có) }. Không bao giờ throw.
export async function runToolCall({ registry, db, call, confirm, log = () => {} }) {
    const tool = registry.get(call.name);
    if (!tool) return { result: fail("UNKNOWN_TOOL", `Không có tool tên ${call.name}.`) };
    const args = isPlainObject(call.args) ? call.args : {};

    try {
        if (tool.kind !== TOOL_KIND.WRITE) return { result: tool.run(db, args) };

        // 1. Kiểm tra trước, chưa đổi dữ liệu. Tham số sai thì báo model luôn, không làm phiền giám đốc.
        const preview = tool.preview(db, args);
        if (!preview.ok) return { result: preview, action: { tool: tool.name, status: "INVALID", message: preview.message } };

        // 2. Hỏi con người. Chỉ đúng giá trị true mới tính là đồng ý; lỗi khi hỏi = không đồng ý.
        let approved = false;
        try {
            approved = (await confirm({ tool: tool.name, title: tool.title, message: preview.message, details: preview.data })) === true;
        } catch (err) {
            log(`Lỗi khi hỏi xác nhận: ${err.message}`);
        }
        if (!approved) {
            return {
                result: fail("CANCELLED_BY_USER", "Giám đốc KHÔNG xác nhận. Thao tác chưa được thực hiện. Không gọi lại tool này."),
                action: { tool: tool.name, status: "CANCELLED", message: `Chưa thực hiện: ${preview.message}` },
            };
        }

        // 3. Thực hiện. run() tự kiểm tra lại mọi điều kiện.
        const result = tool.run(db, args);
        return { result, action: { tool: tool.name, status: result.ok ? "DONE" : "FAILED", message: result.message } };
    } catch (err) {
        log(`Tool ${call.name} lỗi: ${err.stack ?? err.message}`);
        return {
            result: fail("INTERNAL_ERROR", "Hệ thống nội bộ gặp lỗi khi chạy thao tác này. Báo giám đốc thử lại sau, không đoán kết quả."),
            action: tool.kind === TOOL_KIND.WRITE ? { tool: tool.name, status: "FAILED", message: "Lỗi hệ thống, chưa rõ kết quả." } : undefined,
        };
    }
}
