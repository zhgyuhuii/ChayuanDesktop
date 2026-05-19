/**
 * 喜鹊群飞 — 3 只小鸟成 V 字编队穿越主页。
 *
 * 跟金龙的关系
 * ------------
 * 金龙是"主秀",60~110s 一次,占据视觉中心。喜鹊是"配菜",30~50s 一次,
 * 一掠而过,提供持续的活力感。两者不抢戏:龙在中段做盘旋,鹊永远直线掠过
 * 顶部 1/3 区域。
 *
 * 实现
 * ----
 * - 3 只 SVG 鸟,V 字偏移(领队居中,僚机左右各下沉 18px,后置 30px)
 * - 翅膀 SVG `<animateTransform>` 拍频 0.18s/cycle
 * - 整组 CSS keyframe translateX 一次跨过去,7~9s
 * - 触发器:首次 12s,之后 30~50s 随机
 */

import * as React from 'react';

export const MagpieFlock: React.FC = () => {
  const reducedMotion = useReducedMotion();
  const [flightId, setFlightId] = React.useState(0);
  const [params, setParams] = React.useState<FlightParams | null>(null);

  React.useEffect(() => {
    if (reducedMotion) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        setParams(makeFlightParams());
        setFlightId((n) => n + 1);
        // 安排下一次
        schedule(30_000 + Math.random() * 20_000);
      }, delayMs);
    };
    schedule(12_000); // 首飞延迟 12s,跟龙错开
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [reducedMotion]);

  if (reducedMotion || !params) return null;

  return (
    <div
      key={flightId}
      aria-hidden
      style={{
        position: 'absolute',
        top: params.topPct,
        left: 0,
        right: 0,
        height: 80,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '-12%',
          top: 0,
          width: 80,
          height: 60,
          animation: `cy-magpie-fly ${params.durationSec}s linear forwards`,
        }}
      >
        {/* V 字编队:领队、左僚机、右僚机 */}
        <Magpie size={1.0} dx={0} dy={0} flapDelay="0s" />
        <Magpie size={0.78} dx={-22} dy={14} flapDelay="0.06s" />
        <Magpie size={0.78} dx={-22} dy={-14} flapDelay="0.12s" />
      </div>
      <style>{MAGPIE_KEYFRAMES}</style>
    </div>
  );
};

interface FlightParams {
  topPct: string;
  durationSec: number;
}

function makeFlightParams(): FlightParams {
  return {
    // 顶部 8%~28% 内随机,避开内容核心区
    topPct: `${8 + Math.random() * 20}%`,
    durationSec: 7 + Math.random() * 2.5,
  };
}

interface MagpieProps {
  size: number;
  dx: number;
  dy: number;
  flapDelay: string;
}

const Magpie: React.FC<MagpieProps> = ({ size, dx, dy, flapDelay }) => {
  // 喜鹊配色:近黑头身 + 白腹 + 长尾。视口里只有几像素大,细节弱化。
  return (
    <svg
      width={36 * size}
      height={24 * size}
      viewBox="-18 -10 36 24"
      style={{
        position: 'absolute',
        left: dx,
        top: dy,
        filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))',
      }}
    >
      {/* 身体 */}
      <ellipse cx="-2" cy="0" rx="8" ry="3" fill="#1a1a2e" />
      {/* 白腹 */}
      <ellipse cx="-3" cy="1.5" rx="5" ry="1.6" fill="#f5f5f5" opacity="0.92" />
      {/* 头 */}
      <circle cx="6" cy="-1.5" r="2.6" fill="#1a1a2e" />
      {/* 喙 */}
      <path d="M 8,-1.5 L 11,-1 L 8,-0.2 Z" fill="#d49b1a" />
      {/* 眼 */}
      <circle cx="6.5" cy="-2" r="0.5" fill="#fff5c2" />
      {/* 尾 */}
      <path d="M -10,0 L -16,-2 L -16,2 Z" fill="#1a1a2e" />
      {/* 翅膀 — 拍翼用 animateTransform 在原点旋转 */}
      <g transform="translate(0, -2)">
        <path d="M 0,0 Q -5,-8 -12,-8 Q -8,-3 -2,-1 Z" fill="#2a2a4e">
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="-15;-55;-15"
            keyTimes="0;0.5;1"
            dur="0.18s"
            begin={flapDelay}
            repeatCount="indefinite"
          />
        </path>
      </g>
    </svg>
  );
};

const MAGPIE_KEYFRAMES = `
@keyframes cy-magpie-fly {
  0%   { transform: translateX(0); }
  100% { transform: translateX(120vw); }
}
`;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}
