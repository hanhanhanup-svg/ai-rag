const words = [
  "知识沉淀",
  "智能问答",
  "来源可追溯",
  "FAQ",
  "SOP",
  "标签体系",
  "质量治理",
  "权限控制",
  "摘要生成",
  "知识地图",
  "复审下架",
  "审核入库",
  "引用来源",
  "知识资产",
  "可信知识",
  "业务知识",
  "文档解析",
  "问题变体",
  "知识生产",
  "知识应用",
  "知识体检",
  "冲突合并"
];

const rows = [
  { className: "knowledge-bg-row-a", words: [...words.slice(0, 12), ...words.slice(6, 18)] },
  { className: "knowledge-bg-row-b", words: [...words.slice(10), ...words.slice(0, 10)] },
  { className: "knowledge-bg-row-c", words: [...words.slice(4, 20), ...words.slice(0, 8)] }
];

export function KnowledgeTextBackground() {
  return (
    <div className="knowledge-text-background" aria-hidden="true">
      {rows.map((row) => (
        <div key={row.className} className={`knowledge-bg-row ${row.className}`}>
          <div className="knowledge-bg-track">
            {[...row.words, ...row.words].map((word, index) => (
              <span key={`${row.className}-${word}-${index}`} className={word.length > 4 ? "is-large" : word.length > 2 ? "is-medium" : "is-small"}>
                {word}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
