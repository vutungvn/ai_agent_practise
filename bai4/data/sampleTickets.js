// Bộ ticket mẫu có nhãn đúng (expected = tập đội phải nhận ticket). Dùng cho `npm run eval` và test.

const OLD_CHAT = [
    "Khách: Shop ơi áo khoác gió size M còn màu xanh rêu không ạ?",
    "Nhân viên: Dạ còn ạ, size M màu xanh rêu còn 12 chiếc, anh chị đặt luôn nhé.",
    "Khách: Áo này chất liệu gì vậy shop, có chống nước không?",
    "Nhân viên: Dạ chất polyester phủ chống thấm nhẹ, đi mưa nhỏ thoải mái ạ.",
    "Khách: Ok mình đặt 1 cái, giao về Cầu Giấy mất mấy ngày?",
    "Nhân viên: Dạ nội thành Hà Nội 1 đến 2 ngày ạ, phí ship 20 nghìn.",
    "Khách: Có mã giảm giá nào không shop, mình là khách cũ.",
    "Nhân viên: Dạ anh chị nhập mã KHACHCU10 để được giảm 10% nhé.",
    "Khách: Mình nhập rồi mà báo mã hết hạn, kiểm tra giúp mình.",
    "Nhân viên: Dạ em đã gia hạn mã, anh chị thử lại giúp em ạ. Cảm ơn anh chị đã kiên nhẫn chờ.",
];

// Lịch sử chat cũ dán vào ticket, lặp tới ~wordTarget từ. midNote chèn vào giữa (phần sẽ bị cắt).
export function makeChatHistory(wordTarget, midNote = "") {
    const lines = [];
    let words = 0;
    for (let i = 0; words < wordTarget; i++) {
        const line = `[${String(8 + Math.floor(i / 6) % 12).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}] ${OLD_CHAT[i % OLD_CHAT.length]}`;
        lines.push(line);
        words += line.split(/\s+/).length;
        if (midNote && words >= wordTarget / 2 && !lines.includes(midNote)) lines.push(midNote);
    }
    return lines.join("\n");
}

export const SAMPLE_TICKETS = [
    // --- 70%: chỉ cần gán nhãn ---
    { ticketId: "T01", expected: ["KHO_HANG"], text: "Shop ơi áo thun basic màu đen size L còn hàng không ạ?" },
    { ticketId: "T02", expected: ["THANH_TOAN"], text: "Mình thanh toán qua VNPAY mà tài khoản bị trừ tiền 2 lần, kiểm tra giúp mình với." },
    { ticketId: "T03", expected: ["DOI_TRA"], text: "Đơn ORD1004 mình nhận rồi nhưng tai nghe bị rè một bên, muốn đổi cái mới." },
    { ticketId: "T04", expected: ["VAN_CHUYEN"], text: "Cho mình đổi địa chỉ giao đơn ORD1001 sang 5 Trần Duy Hưng, Cầu Giấy, Hà Nội nhé." },
    { ticketId: "T05", expected: ["KHO_HANG"], text: "Bao giờ mẫu giày chạy bộ X1 size 42 về hàng lại vậy shop?" },
    { ticketId: "T06", expected: ["THANH_TOAN"], text: "Xuất giúp mình hoá đơn VAT cho đơn ORD1001, thông tin công ty mình gửi sau." },
    { ticketId: "T07", expected: ["DOI_TRA"], text: "Giao nhầm sản phẩm rồi shop ơi, mình đặt cốc giữ nhiệt màu xanh mà nhận cốc màu đỏ." },
    { ticketId: "T08", expected: ["VAN_CHUYEN"], text: "Shipper gọi mình không được, nhờ shop báo shipper giao buổi chiều sau 5 giờ giúp." },
    // --- 30%: phải tra đơn mới biết đội nào ---
    { ticketId: "T09", expected: ["THANH_TOAN"], text: "Đơn ORD1002 sao mãi không thấy giao vậy? Mình đặt 5 ngày rồi." },
    { ticketId: "T10", expected: ["KHO_HANG"], text: "Đơn ORD1003 đặt cả tuần rồi chưa thấy gì hết, shop xem giúp." },
    { ticketId: "T11", expected: ["VAN_CHUYEN"], text: "ORD1001 khi nào tới vậy shop?" },
    { ticketId: "T12", expected: ["THANH_TOAN"], text: "Đơn ORD1005 của mình giờ sao rồi?" },
    { ticketId: "T13", expected: ["VAN_CHUYEN"], text: "Mình muốn trả lại đơn ORD1007, không lấy nữa." },
    { ticketId: "T14", expected: ["VAN_CHUYEN"], text: "Hệ thống báo đơn ORD1004 đã giao mà mình chưa nhận được gì cả." },
    // --- Bẫy: nhiều vấn đề trong 1 ticket ---
    {
        ticketId: "T15",
        expected: ["KHO_HANG", "THANH_TOAN"],
        text: "Cho mình hỏi nồi chiên không dầu Z5 còn hàng không? Với lại hôm qua mình thanh toán đơn ORD1001 bằng thẻ mà bị trừ tiền 2 lần, xử lý giúp mình.",
    },
    {
        ticketId: "T16",
        expected: ["THANH_TOAN", "KHO_HANG"],
        text: "Đơn ORD1002 sao vẫn chưa giao? Tiện hỏi luôn quạt mini cầm tay còn màu trắng không shop?",
    },
    // --- Bẫy: ticket ~4.000 từ do dán cả lịch sử chat ---
    {
        ticketId: "T17",
        expected: ["KHO_HANG"],
        text: `Mình dán lại lịch sử chat cũ để shop nắm tình hình:\n${makeChatHistory(4000)}\nTóm lại đơn ORD1003 của mình bao giờ mới được giao vậy?`,
    },
    {
        ticketId: "T18",
        expected: ["THANH_TOAN"],
        // Yêu cầu ở đầu, mã đơn chỉ nằm ở GIỮA lịch sử chat (phần sẽ bị cắt).
        text: `Đơn của mình sao mãi chưa giao vậy, lịch sử chat bên dưới:\n${makeChatHistory(4000, "Khách: Mã đơn của mình là ORD1002 nhé shop.")}`,
    },
];
