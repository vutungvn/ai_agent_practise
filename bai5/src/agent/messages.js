// Mọi câu trả lời soạn sẵn cho tình huống lỗi. Giữ giọng thân thiện, không lộ chi tiết kỹ thuật.
export const CAPABILITIES =
    "Em có thể giúp anh/chị: xem tóm tắt bất thường đêm qua, kiểm tra lỗi cổng thanh toán và tạm tắt cổng, " +
    "xem hàng sắp hết và tạo phiếu nhập, tìm đơn nghi gian lận và tạm giữ đơn.";

const EXAMPLE = 'Ví dụ: "Đêm qua có gì bất thường không?"';

export const MESSAGES = {
    EMPTY_INPUT: `Anh/chị chưa nhập câu hỏi ạ. ${EXAMPLE} ${CAPABILITIES}`,
    NO_CONTENT: `Em chưa hiểu ý anh/chị ạ. ${CAPABILITIES} ${EXAMPLE}`,
    TOO_LONG: "Câu hỏi hơi dài nên em chưa xử lý được ạ. Anh/chị tóm lại trong 1-2 câu giúp em nhé.",
    EMPTY_REPLY: `Em chưa tìm được câu trả lời phù hợp, anh/chị hỏi lại theo cách khác giúp em nhé. ${EXAMPLE}`,
};

function actionsNote(actions) {
    const done = actions.filter((a) => a.status === "DONE");
    if (done.length === 0) return " Chưa có thao tác nào được thực hiện.";
    return ` Lưu ý: trước khi dừng, em ĐÃ thực hiện: ${done.map((a) => a.message).join(" ")}`;
}

export function maxRoundsMessage(maxRounds, actions) {
    return `Yêu cầu này cần nhiều bước hơn mức cho phép (${maxRounds} bước) nên em dừng lại để tránh chạy vòng vòng. ` +
        `Anh/chị chia nhỏ câu hỏi giúp em nhé.${actionsNote(actions)}`;
}

export function apiErrorMessage(err, actions) {
    const status = err?.status ?? err?.code;
    let reason;
    if (err?.code === "TIMEOUT") reason = "Hệ thống AI phản hồi quá lâu";
    else if (status === 429) reason = "Hệ thống AI đang quá tải";
    else if (status === 401 || status === 403) reason = "Khoá API không hợp lệ hoặc hết quyền, cần bộ phận kỹ thuật kiểm tra";
    else if (typeof status === "number" && status >= 500) reason = "Hệ thống AI đang gặp sự cố";
    else if (/fetch failed|network|ENOTFOUND|ECONNRESET/i.test(err?.message ?? "")) reason = "Không kết nối được tới hệ thống AI";
    else reason = "Có lỗi ngoài dự kiến";
    return `Xin lỗi anh/chị, ${reason.charAt(0).toLowerCase()}${reason.slice(1)}. Anh/chị thử lại sau ít phút giúp em.${actionsNote(actions)}`;
}
