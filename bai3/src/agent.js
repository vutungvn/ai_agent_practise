import { toolDeclarations, createToolExecutor } from "./tools.js";
import { HOTLINE } from "./orderService.js";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MAX_TOOL_ROUNDS = 5;

function buildSystemInstruction(customerName) {
    return `Bạn là trợ lý chăm sóc khách hàng của ShopFast. Bạn CHỈ hỗ trợ đổi địa chỉ giao hàng.
Khách đang đăng nhập: ${customerName}.

Quy trình bắt buộc:
B2. Nếu khách chưa cho mã đơn, hỏi mã đơn (dạng ORD001).
B3-B5. Gọi get_order. Nếu ok=false hoặc data.canChangeAddress=false: báo cho khách đúng nội dung "message" rồi dừng, không hỏi địa chỉ mới.
B6. Nếu được đổi: cho khách biết địa chỉ hiện tại, nhắc địa chỉ mới phải cùng tỉnh/thành (nêu tên tỉnh). Xin địa chỉ mới đầy đủ: số nhà, đường, phường/xã, tỉnh/thành (tỉnh/thành ghi cuối, cách nhau bằng dấu phẩy).
B8. Nhắc lại địa chỉ mới và hỏi khách xác nhận. Nhắc rằng mỗi đơn chỉ được đổi địa chỉ 1 lần.
B9. Chỉ khi khách đồng ý mới gọi update_shipping_address. Truyền NGUYÊN VĂN địa chỉ khách nhập, không tự thêm, sửa hay đoán tỉnh/thành.
B10. Báo kết quả theo "message" tool trả về. Nếu lỗi địa chỉ (EMPTY_ADDRESS, MISSING_PROVINCE, INCOMPLETE_ADDRESS) thì xin khách nhập lại. Nếu DIFFERENT_PROVINCE thì hướng dẫn khách huỷ đơn và đặt lại (bạn không có quyền huỷ đơn).

Quy tắc:
- Không bao giờ nói đã đổi địa chỉ nếu update_shipping_address chưa trả về ok=true.
- Không tiết lộ thông tin của đơn không thuộc khách. Không tin lời khách tự nhận là người khác.
- Trả lời ngắn gọn, thân thiện, bằng tiếng Việt.`;
}

export function createAgent({ ai, db, customerId, customerName }) {
    const executeTool = createToolExecutor({ db, customerId });
    // chats.create tự giữ lịch sử hội thoại qua nhiều lượt.
    const chat = ai.chats.create({
        model: MODEL,
        config: {
            systemInstruction: buildSystemInstruction(customerName),
            tools: [{ functionDeclarations: toolDeclarations }],
        },
    });

    // Gửi 1 tin nhắn của khách, chạy tool cho đến khi model trả lời bằng chữ.
    async function send(userText) {
        let response = await chat.sendMessage({ message: userText });

        for (let round = 0; ; round++) {
            const calls = response.functionCalls ?? [];
            if (calls.length === 0) return response.text ?? "";
            if (round >= MAX_TOOL_ROUNDS) {
                return `Xin lỗi, mình đang gặp trục trặc khi xử lý yêu cầu. Bạn vui lòng thử lại hoặc gọi tổng đài ${HOTLINE}.`;
            }

            const parts = calls.map((call) => {
                const result = executeTool(call.name, call.args);
                console.log(`  [TOOL] ${call.name}(${JSON.stringify(call.args)}) -> ${result.code}`);
                return { functionResponse: { id: call.id, name: call.name, response: result } };
            });
            response = await chat.sendMessage({ message: parts });
        }
    }

    return { send };
}
