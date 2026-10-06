// Chạy: node --env-file=.env chat.js KH001
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { GoogleGenAI } from "@google/genai";
import { createDb, CUSTOMERS } from "./src/db.js";
import { createAgent, MODEL } from "./src/agent.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("Chưa có GEMINI_API_KEY. Hãy tạo file .env chứa GEMINI_API_KEY=...");
    process.exit(1);
}

// Giả lập đăng nhập: customerId lấy từ tham số dòng lệnh, KHÔNG lấy từ lời khách nói.
const customerId = (process.argv[2] ?? "KH001").toUpperCase();
if (!CUSTOMERS[customerId]) {
    console.error(`Không có khách ${customerId}. Chọn một trong: ${Object.keys(CUSTOMERS).join(", ")}`);
    process.exit(1);
}

const db = createDb();
const agent = createAgent({
    ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    db,
    customerId,
    customerName: CUSTOMERS[customerId],
});

console.log(`Đăng nhập: ${customerId} - ${CUSTOMERS[customerId]} | model: ${MODEL}`);
console.log('Gõ "thoat" để thoát.\n');

const rl = readline.createInterface({ input, output });
while (true) {
    const text = await rl.question("Bạn: ");
    if (text === "") continue; // Chỉ bỏ qua Enter trống; vẫn gửi "   " để test bẫy khoảng trắng.
    if (text.trim().toLowerCase() === "thoat") break;
    try {
        console.log(`Agent: ${await agent.send(text)}\n`);
    } catch (err) {
        console.error(`[LỖI API] ${err.message}\n`);
    }
}
rl.close();

console.log("\nDữ liệu đơn hàng sau phiên chat:");
console.table([...db.orders.values()]);
