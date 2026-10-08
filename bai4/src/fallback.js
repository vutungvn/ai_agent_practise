// Phân loại dự phòng bằng từ khoá, không gọi AI (~0ms). Dùng khi model lỗi, trả sai định dạng hoặc quá giờ,
// để luồng không bao giờ bị kẹt và vẫn trả lời khách trong 5 giây.
import { TEAMS, TEAM_IDS, DEFAULT_TEAM } from "./teams.js";
import { foldVietnamese } from "./preprocess.js";
import { MAX_ISSUES } from "./classifier.js";

export function keywordClassify(text) {
    const folded = foldVietnamese(text);
    const scored = TEAM_IDS
        .map((team) => ({ team, hits: TEAMS[team].keywords.filter((kw) => folded.includes(kw)).length }))
        .filter((item) => item.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, MAX_ISSUES);

    if (scored.length === 0) {
        return [{ team: DEFAULT_TEAM, summary: "Không nhận diện được chủ đề", needsLookup: false, orderId: null }];
    }
    return scored.map(({ team }) => ({ team, summary: `Phân loại dự phòng theo từ khoá: ${TEAMS[team].name}`, needsLookup: false, orderId: null }));
}
