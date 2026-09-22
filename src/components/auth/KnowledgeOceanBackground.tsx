import { FileText, Network, Tags } from "lucide-react";

const words = [
  "知识",
  "FAQ",
  "制度",
  "流程",
  "合同",
  "政策",
  "标签",
  "审核",
  "摘要",
  "问答",
  "知识图谱",
  "可信来源",
  "员工",
  "客户",
  "产品",
  "培训",
  "加班申请",
  "竞品对比",
  "规章制度",
  "售前资料",
  "人事流程",
  "客户问答",
  "质量治理",
  "权限安全",
  "来源引用"
];

function WordRow({ index, reverse = false }: { index: number; reverse?: boolean }) {
  const rowWords = [...words.slice(index * 7), ...words.slice(0, index * 7), ...words.slice(2, 18)];

  return (
    <div className={`knowledge-ocean-row knowledge-ocean-row-${index + 1} ${reverse ? "knowledge-ocean-row-reverse" : ""}`}>
      <div className="knowledge-ocean-track">
        {[...rowWords, ...rowWords].map((word, wordIndex) => (
          <span key={`${word}-${wordIndex}`} className={word.length > 4 ? "text-[22px]" : word.length > 2 ? "text-lg" : "text-sm"}>
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}

export function KnowledgeOceanBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_50%_10%,rgba(224,231,255,0.9),transparent_34%),linear-gradient(135deg,#F8FAFC_0%,#EEF2FF_48%,#F5F3FF_100%)]">
      <div className="absolute left-[8%] top-[12%] h-56 w-56 rounded-full bg-indigo-200/45 blur-3xl" />
      <div className="absolute right-[12%] top-[22%] h-64 w-64 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="absolute bottom-[8%] left-[35%] h-72 w-72 rounded-full bg-violet-200/35 blur-3xl" />

      <WordRow index={0} />
      <WordRow index={1} reverse />
      <WordRow index={2} />

      <div className="absolute inset-x-[12%] top-[24%] h-px bg-gradient-to-r from-transparent via-indigo-200/60 to-transparent" />
      <div className="absolute inset-x-[18%] bottom-[22%] h-px -rotate-3 bg-gradient-to-r from-transparent via-emerald-200/60 to-transparent" />

      <div className="absolute left-[14%] top-[34%] rounded-3xl border border-indigo-200/45 bg-white/25 p-3 text-indigo-300/70">
        <FileText className="h-8 w-8" />
      </div>
      <div className="absolute right-[16%] top-[40%] rounded-3xl border border-emerald-200/45 bg-white/25 p-3 text-emerald-300/70">
        <Network className="h-8 w-8" />
      </div>
      <div className="absolute bottom-[18%] left-[20%] rounded-3xl border border-violet-200/45 bg-white/25 p-3 text-violet-300/70">
        <Tags className="h-8 w-8" />
      </div>

      <div className="absolute left-[18%] top-[21%] h-2 w-2 rounded-full bg-indigo-300/60" />
      <div className="absolute right-[25%] top-[18%] h-2 w-2 rounded-full bg-emerald-300/60" />
      <div className="absolute bottom-[28%] right-[18%] h-2 w-2 rounded-full bg-violet-300/60" />
    </div>
  );
}
