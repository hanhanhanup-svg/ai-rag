import { ArrowRight, BrainCircuit, RefreshCw } from 'lucide-react';
import './learning-base-overview.css';

export const learningBaseDescription='系统后台自用的自学习知识库，积累反馈中已确认的纠错经验，在相关问答中辅助系统持续改进回答。';

export function LearningBaseOverview() {
  return <section className="e-card kw-learning-overview" aria-label="系统自学习知识库说明">
    <div className="kw-learning-overview-heading"><span className="kw-learning-overview-icon"><BrainCircuit size={22}/></span><div><span className="kw-learning-overview-label">系统内置 · 后台自用</span><h2>系统自学习知识库</h2></div></div>
    <p className="kw-learning-overview-intro">积累可复用的纠错经验，为知识系统的自学习能力提供知识支撑。</p>
    <div className="kw-learning-overview-flow" aria-label="自学习知识流程"><span>反馈结论</span><ArrowRight size={13}/><span>经验积累</span><ArrowRight size={13}/><span>问答参考</span></div>
    <dl>
      <div><dt>积累什么</dt><dd>反馈中已确认的结论、纠错方法与处理经验。</dd></div>
      <div><dt>如何使用</dt><dd>默认关联文档问答，系统按问题相关性自动参考。</dd></div>
      <div><dt>如何维护</dt><dd>由系统维护调用状态，保留知识来源与版本记录。</dd></div>
    </dl>
    <p className="kw-learning-overview-footer"><RefreshCw size={13}/>来源更新或失效后，停止使用旧结论。</p>
  </section>;
}
