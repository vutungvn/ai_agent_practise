// Chạy: npm run demo   (cần GEMINI_API_KEY) - chạy các kịch bản demo với model thật.
// Câu trả lời xác nhận được soạn sẵn cho từng kịch bản để demo chạy tự động; trong `npm start` người dùng tự gõ.
import { GoogleGenAI } from "@google/genai";
import { createDb } from "../src/data/seed.js";
import { createOpsAgent } from "../src/agent/orchestrator.js";
import { MODEL } from "../src/agent/llm.js";
import { createConsoleConfirm } from "../src/cli/confirm.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("Chưa có GEMINI_API_KEY. Copy .env.example thành .env và điền key.");
    process.exit(1);
}

const SCENARIOS = [
    {
        title: "Kịch bản 1 - Bức tranh buổi sáng (tool tổng hợp)",
        questions: ["Đêm qua có gì bất thường không?"],
        confirmations: [],
    },
    {
        title: "Kịch bản 2 - Điều tra và xử lý lỗi thanh toán (đọc chi tiết -> ghi, giám đốc ĐỒNG Ý)",
        questions: ["Cổng thanh toán nào đang lỗi, lỗi từ mấy giờ? Nếu đúng là lỗi phía cổng thì tắt tạm cổng đó đi."],
        confirmations: ["có"],
    },
    {
        title: "Kịch bản 3 - Hàng sắp hết (đọc -> ghi, giám đốc ĐỒNG Ý)",
        questions: ["Hàng nào sắp hết? Đặt thêm hàng cho món nguy cấp nhất theo số lượng em đề xuất."],
        confirmations: ["có"],
    },
    {
        title: "Kịch bản 4 - Đơn nghi gian lận (đọc -> ghi, giám đốc TỪ CHỐI)",
        questions: ["Có đơn nào đáng ngờ không? Giữ hết lại cho tôi."],
        confirmations: ["không"],
    },
    {
        title: "Kịch bản 5 - So sánh đêm trước + câu hỏi ngoài quyền",
        questions: ["Đêm hôm kia thì sao, có gì lạ không?", "Xoá hết đơn hàng bị lỗi thanh toán đi."],
        confirmations: [],
    },
    {
        title: "Kịch bản 6 - Đầu vào rỗng / vô nghĩa (không được crash)",
        questions: ["", "     ", "???", "asdkj qwe zzz"],
        confirmations: [],
    },
];

const db = createDb();
let pendingAnswers = [];
const scriptedAsk = async (question) => {
    const answer = pendingAnswers.shift() ?? "không"; // hết câu soạn sẵn -> từ chối cho an toàn
    console.log(`${question}${answer}   ← (giám đốc gõ)`);
    return answer;
};

const agent = createOpsAgent({
    ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    db,
    confirm: createConsoleConfirm(scriptedAsk),
    onToolCall: (call) => console.log(`  … tool: ${call.name}(${JSON.stringify(call.args ?? {})})`),
});

console.log(`Demo trợ lý vận hành ShopFast | dữ liệu sáng ${db.reportDate} | model ${MODEL}`);
for (const scenario of SCENARIOS) {
    console.log(`\n${"=".repeat(80)}\n${scenario.title}\n${"=".repeat(80)}`);
    pendingAnswers = [...scenario.confirmations];
    for (const question of scenario.questions) {
        console.log(`\nGiám đốc: ${JSON.stringify(question)}`);
        const started = Date.now();
        const { reply, actions, rounds } = await agent.ask(question);
        console.log(`\nTrợ lý: ${reply}`);
        for (const action of actions) console.log(`  [${action.status}] ${action.message}`);
        console.log(`  (${rounds ?? "-"} vòng, ${Date.now() - started}ms)`);
    }
}

console.log(`\n${"=".repeat(80)}\nTrạng thái dữ liệu sau demo\n${"=".repeat(80)}`);
console.log("Cổng thanh toán:", Object.fromEntries([...db.gateways].map(([name, g]) => [name, g.enabled ? "BẬT" : "TẮT"])));
console.log("Phiếu nhập hàng:", db.restockOrders);
console.log("Đơn đang tạm giữ:", [...db.orders.values()].filter((o) => o.status === "TAM_GIU").map((o) => o.orderId));
console.log("Nhật ký thao tác ghi:", db.auditLog);
