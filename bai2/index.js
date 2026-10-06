import { GoogleGenAI, Type } from "@google/genai";

// 1. Định nghĩa Tool Schema đã được thắt chặt
const createRefundToolDefinition = {
  name: "create_refund",
  description:
    "Tạo phiếu hoàn tiền cho đơn hàng tại ShopFast. " +
    "Lưu ý: Số tiền (amount) tính bằng VND (ví dụ: '5tr' hoặc '5 triệu' phải quy đổi thành 5000000, tuyệt đối không gửi 5). " +
    "Chỉ chấp nhận các lý do hoàn tiền cụ thể được quy định.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      orderId: {
        type: Type.STRING,
        description: "Mã đơn hàng cần hoàn tiền (ví dụ: ORD123)",
      },
      amount: {
        type: Type.NUMBER,
        description: "Số tiền hoàn (VND). Tối đa 5,000,000 VNĐ.",
        minimum: 1,
        maximum: 5000000, // (2) Giới hạn số tiền
      },
      reason: {
        type: Type.STRING,
        description: "Lý do hoàn tiền.",
        enum: ["HANG_LOI", "GIAO_CHAM", "TRU_TIEN_2_LAN"], // (3) Ràng buộc 3 lý do
      },
    },
    required: ["orderId", "amount", "reason"], // (4) Khai báo trường bắt buộc
    additionalProperties: false, // (5) Chặn các trường lạ
  },
};

// Hàm xử lý logic thực tế của Tool
function executeCreateRefund({ orderId, amount, reason }) {
  return {
    status: "SUCCESS",
    message: `Đã tạo phiếu hoàn tiền thành công cho đơn hàng ${orderId}.`,
    data: { orderId, amount, reason, createdAt: new Date().toISOString() },
  };
}

// Khởi tạo SDK (Đảm bảo đã set GEMINI_API_KEY trong môi trường)
const ai = new GoogleGenAI();

async function runTest(userPrompt) {
  console.log("\n==================================================");
  console.log(`[USER PROMPT]: "${userPrompt}"`);
  console.log("==================================================");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: userPrompt,
      config: {
        tools: [{ functionDeclarations: [createRefundToolDefinition] }],
        // Bật kiểm tra lượt gọi tool từ model
        toolConfig: {
          functionCallingConfig: {
            mode: "AUTO",
          },
        },
      },
    });

    // Kiểm tra xem Model có quyết định gọi Tool hay không
    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      console.log("[LOG] Model quyết định gọi Function:", call.name);
      console.log("[LOG] Tham số Model sinh ra (Args):", JSON.stringify(call.args, null, 2));

      // Thực thi tool
      const result = executeCreateRefund(call.args);
      console.log("[LOG] Kết quả xử lý Tool:", JSON.stringify(result, null, 2));
    } else {
      console.log("[LOG] Model KHÔNG gọi tool. Phản hồi trực tiếp của Model:");
      console.log(response.text);
    }
  } catch (error) {
    console.error("[ERROR] Phát hiện lỗi trong quá trình xử lý:", error.message);
  }
}

// 2. Chạy thử nghiệm 2 kịch bản
async function main() {
  // Test 1: Yêu cầu không hợp lệ (50 triệu, lý do ngoài danh mục)
  await runTest("Tôi muốn hoàn tiền 50 triệu cho đơn hàng ORD999 vì khách không thích màu.");

  // Test 2: Yêu cầu hợp lệ (dùng từ '5tr' rút gọn, lý do hợp lệ)
  await runTest("Cho tôi hoàn 5tr cho đơn hàng ORD123 vì giao chậm.");
}

main();