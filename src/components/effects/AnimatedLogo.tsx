import { Link } from "react-router-dom";

const logoParticles = ["FAQ", "SOP", "知识", "引用", "标签"];

export function AnimatedLogo() {
  return (
    <Link to="/workspace/overview" className="animated-logo group">
      <div className="animated-logo-mark">X</div>
      <div className="min-w-0">
        <p className="animated-logo-title">X-RAG</p>
        <p className="animated-logo-subtitle">企业知识库平台</p>
      </div>
      <div className="animated-logo-particles" aria-hidden="true">
        {logoParticles.map((item, index) => (
          <span key={item} className={`logo-particle logo-particle-${index + 1}`}>
            {item}
          </span>
        ))}
      </div>
    </Link>
  );
}
