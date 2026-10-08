// Định tuyến 1 ticket bằng model thật.
//   npm run route -- "Đơn ORD1002 sao chưa giao vậy?"
//   npm run route -- --sample T17
import { GoogleGenAI } from "@google/genai";
import { createRouter } from "../src/router.js";
import { createOrderDb } from "../src/orderDb.js";
import { MODEL } from "../src/llm.js";
import { SAMPLE_TICKETS } from "../data/sampleTickets.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("Chưa có GEMINI_API_KEY. Copy .env.example thành .env và điền key.");
    process.exit(1);
}

const args = process.argv.slice(2);
let ticket;
if (args[0] === "--sample") {
    ticket = SAMPLE_TICKETS.find((t) => t.ticketId === args[1]?.toUpperCase());
    if (!ticket) {
        console.error(`Không có ticket mẫu ${args[1]}. Chọn: ${SAMPLE_TICKETS.map((t) => t.ticketId).join(", ")}`);
        process.exit(1);
    }
} else {
    ticket = { ticketId: "CLI", text: args.join(" ") };
}

const routeTicket = createRouter({
    ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    db: createOrderDb(),
    log: (msg) => console.warn(`  [WARN] ${msg}`),
});

console.log(`Model: ${MODEL} | ticket ${ticket.ticketId}: ${ticket.text.split(/\s+/).length} từ`);
const result = await routeTicket(ticket);
console.log(JSON.stringify(result, null, 2));
if (ticket.expected) console.log(`Đáp án: ${ticket.expected.join(", ")}`);
