import { useEffect, useState, type CSSProperties } from "react";

const particleWords = ["知识", "来源", "摘要", "标签", "引用", "FAQ", "SOP", "入库", "可信"];
const particleAngles = [-78, -34, 8, 46, 82];

interface ClickEffect {
  id: string;
  x: number;
  y: number;
  words: Array<{ text: string; dx: number; dy: number }>;
}

function shouldSkipTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest("input, textarea, select, [contenteditable='true'], [data-no-knowledge-effect]")) return true;
  if (target.closest("[data-radix-dialog-content]")) return true;
  return false;
}

function isKnowledgeTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("button, a, [role='button'], .knowledge-card, .knowledge-clickable"));
}

export function KnowledgeClickEffect() {
  const [effects, setEffects] = useState<ClickEffect[]>([]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (shouldSkipTarget(event.target) || !isKnowledgeTarget(event.target)) return;

      const seed = Date.now();
      const wordCount = 3 + Math.floor(Math.random() * 3);
      const words = Array.from({ length: wordCount }, (_, index) => {
        const angle = particleAngles[index] ?? 0;
        const distance = 24 + Math.random() * 22;
        return {
          text: particleWords[(seed + index * 3) % particleWords.length],
          dx: Math.cos((angle * Math.PI) / 180) * distance,
          dy: Math.sin((angle * Math.PI) / 180) * distance
        };
      });
      const effect: ClickEffect = {
        id: `${seed}-${Math.random().toString(16).slice(2)}`,
        x: event.clientX,
        y: event.clientY,
        words
      };

      setEffects((items) => [...items.slice(-3), effect]);
      window.setTimeout(() => {
        setEffects((items) => items.filter((item) => item.id !== effect.id));
      }, 900);
    };

    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className="knowledge-click-layer" aria-hidden="true">
      {effects.map((effect) => (
        <div key={effect.id} className="knowledge-click-effect" style={{ left: effect.x, top: effect.y }}>
          <span className="knowledge-click-ripple" />
          {effect.words.map((word, index) => (
            <span
              key={`${word.text}-${index}`}
              className="knowledge-click-particle"
              style={{ "--kx": `${word.dx}px`, "--ky": `${word.dy}px` } as CSSProperties}
            >
              {word.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
