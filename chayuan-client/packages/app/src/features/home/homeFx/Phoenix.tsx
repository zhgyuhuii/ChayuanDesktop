/**
 * 智灵鸟 — 一只金红凤凰滑翔而过。
 *
 * 跟金龙的视觉差异
 * ----------------
 * 龙是"蛇形扭动 + 蜿蜒盘旋",凤凰走的是"展翅滑翔 + 拖尾翎羽飘动"。
 * 实现方式不一样:
 *   - 龙用 24 段铰链 follow-the-leader
 *   - 凤凰用 1 个核心鸟体 + 5 根独立 bezier 翎羽 + 2 翼 SMIL 拍翼
 *
 * 出场频率:90~150s 一次,跟龙(60~110s)错开,避免两个主秀同框。
 * 飞行路径:大 S 弯,无盘旋,8~11s 一次。
 */

import * as React from 'react';
import { makeFlightPath, type FlightPath } from './dragonPath';

interface PhoenixProps {
  flightKey: number;
  width: number;
  height: number;
  onFlightDone?: () => void;
}

export const Phoenix: React.FC<PhoenixProps> = ({
  flightKey,
  width,
  height,
  onFlightDone,
}) => {
  const reducedMotion = useReducedMotion();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const pathRef = React.useRef<FlightPath | null>(null);
  const startRef = React.useRef(0);
  const rafRef = React.useRef<number | null>(null);
  // 翎羽尾迹:5 根尾羽,每根记录最近 8 帧位置 → 平滑 bezier 拖尾
  const tailHistRef = React.useRef<Array<{ x: number; y: number; angle: number }>>([]);

  React.useEffect(() => {
    if (reducedMotion) return;
    if (flightKey <= 0) return;
    if (width <= 0 || height <= 0) return;

    // 凤凰用高位滑翔参数:不盘旋、yBias 0.15(贴近屏顶)、速度乘子 1.15
    pathRef.current = makeFlightPath(width, height, {
      allowCoil: false,
      yBias: 0.18,
      speedScale: 1.15,
    });
    startRef.current = performance.now();
    tailHistRef.current = [];

    const path = pathRef.current;
    // 凤凰速度比龙快一档,9~12s 飞完 → 路径时长按比例缩
    const dur = Math.max(8, path.durationSec * 0.85) * 1000;
    // 离场延长 — 翎羽要拖出屏外,凤凰比龙短(身体本就短)所以 900ms 够
    const exitState = path.at(1);
    const EXIT_MS = 900;
    const EXIT_VEL = 560;

    const loop = (now: number) => {
      if (document.hidden) {
        startRef.current = now - 0;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const elapsed = now - startRef.current;
      let head: { x: number; y: number; angle: number };

      if (elapsed < dur) {
        const t = elapsed / dur;
        head = path.at(t);
      } else {
        const extElapsed = elapsed - dur;
        if (extElapsed >= EXIT_MS) {
          // 凤凰飞出去 — 清掉残留 path + 鸟体挪屏外
          clearPhoenixFromDom(svgRef.current);
          rafRef.current = null;
          onFlightDone?.();
          return;
        }
        const extSec = extElapsed / 1000;
        head = {
          x: exitState.x + Math.cos(exitState.angle) * EXIT_VEL * extSec,
          y: exitState.y + Math.sin(exitState.angle) * EXIT_VEL * extSec,
          angle: exitState.angle,
        };
      }

      tailHistRef.current.push(head);
      if (tailHistRef.current.length > 36) tailHistRef.current.shift();

      commitPhoenixToDom(svgRef.current, head, tailHistRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [flightKey, width, height, reducedMotion, onFlightDone]);

  if (reducedMotion) return null;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
      }}
    >
      <defs>
        {/* 金红渐变 — 凤凰的"赤"调,头尾从亮金到深红 */}
        <linearGradient id="ph-body" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#fff5c2">
            <animate attributeName="offset" values="0%;30%;0%" dur="3.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="40%" stopColor="#ffaa3a">
            <animate attributeName="offset" values="40%;70%;40%" dur="3.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="80%" stopColor="#d63b1a" />
          <stop offset="100%" stopColor="#7a1208" />
        </linearGradient>
        <linearGradient id="ph-feather" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffd75a" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#ff7a1a" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#7a1208" stopOpacity="0" />
        </linearGradient>
        <filter id="ph-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b1" />
          <feGaussianBlur stdDeviation="7" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 拖尾翎羽 — 5 根 bezier,顺主翼后方流出 */}
      <g data-role="ph-tails" filter="url(#ph-glow)" />

      {/* 主鸟体 */}
      <g data-role="ph-body" filter="url(#ph-glow)">
        <PhoenixBody />
      </g>
    </svg>
  );
};

// ──────────────────────────────────────────────────────────────
// 凤凰躯干 — 头 + 身 + 双翼 + 颈冠
// ──────────────────────────────────────────────────────────────

const PhoenixBody: React.FC = () => (
  <>
    {/* 双翼 — SMIL animateTransform 拍动 0.6s 一拍,起伏柔和 */}
    <g>
      {/* 上翼(右翼) */}
      <path
        d="M 0,-2 Q -20,-30 -45,-22 Q -38,-12 -10,-6 Z"
        fill="url(#ph-body)"
        opacity="0.92"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="-8;-22;-8"
          keyTimes="0;0.5;1"
          dur="0.6s"
          repeatCount="indefinite"
          additive="sum"
        />
      </path>
      {/* 下翼(左翼)— 比上翼略小,作错相位拍动 */}
      <path
        d="M 0,2 Q -20,30 -45,22 Q -38,12 -10,6 Z"
        fill="url(#ph-body)"
        opacity="0.92"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="8;22;8"
          keyTimes="0;0.5;1"
          dur="0.6s"
          repeatCount="indefinite"
          additive="sum"
        />
      </path>
    </g>

    {/* 身体椭圆 */}
    <ellipse cx="0" cy="0" rx="18" ry="6" fill="url(#ph-body)" />
    {/* 颈 */}
    <path d="M 12,-3 Q 22,-8 26,-5" stroke="#d63b1a" strokeWidth="3" fill="none" strokeLinecap="round" />
    {/* 头 */}
    <circle cx="26" cy="-5" r="4.5" fill="url(#ph-body)" />
    {/* 喙 */}
    <path d="M 30,-5 L 35,-4 L 30,-2.5 Z" fill="#7a4a06" />
    {/* 眼 */}
    <circle cx="27" cy="-6" r="1.1" fill="#fff5c2" />
    <circle cx="27.2" cy="-6" r="0.5" fill="#1a0d00" />
    {/* 头顶冠羽 — 3 缕飘动 */}
    <path
      d="M 22,-9 Q 22,-18 18,-22 Q 16,-20 19,-12"
      fill="url(#ph-feather)"
      opacity="0.9"
    />
    <path
      d="M 24,-9 Q 25,-20 22,-26"
      stroke="#ffd75a"
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
      opacity="0.85"
    />
    <path
      d="M 26,-9 Q 28,-18 26,-24"
      stroke="#ff7a1a"
      strokeWidth="1.2"
      fill="none"
      strokeLinecap="round"
      opacity="0.85"
    />
  </>
);

// ──────────────────────────────────────────────────────────────
// DOM commit — 主鸟体定位 + 5 根尾羽 bezier 跟随历史轨迹
// ──────────────────────────────────────────────────────────────

function commitPhoenixToDom(
  svg: SVGSVGElement | null,
  head: { x: number; y: number; angle: number },
  history: Array<{ x: number; y: number; angle: number }>,
): void {
  if (!svg) return;

  const bodyGroup = svg.querySelector<SVGGElement>('g[data-role="ph-body"]');
  if (bodyGroup) {
    bodyGroup.setAttribute(
      'transform',
      `translate(${head.x.toFixed(1)} ${head.y.toFixed(1)}) rotate(${((head.angle * 180) / Math.PI).toFixed(1)})`,
    );
  }

  const tails = svg.querySelector<SVGGElement>('g[data-role="ph-tails"]');
  if (!tails) return;
  while (tails.firstChild) tails.removeChild(tails.firstChild);
  if (history.length < 3) return;

  // 5 根尾羽,从尾根向后散开 ±25° 一根
  // 每根用 quadratic bezier:控制点 = 尾根 + 法向偏移,终点 = history 取样点
  const fanAngles = [-0.4, -0.2, 0, 0.2, 0.4]; // radians
  const tailRootOffset = -16; // 尾根在 body 正后方 16 px
  for (let i = 0; i < fanAngles.length; i++) {
    const fan = fanAngles[i]!;
    // 取历史不同距离的点 — 短的尾羽用近期采样,长的用更早采样
    const sampleIdx = Math.max(
      0,
      Math.floor(history.length - 1 - (5 - i) * (history.length / 9)),
    );
    const sample = history[sampleIdx];
    if (!sample) continue;
    const cos = Math.cos(head.angle);
    const sin = Math.sin(head.angle);
    const rootX = head.x + cos * tailRootOffset;
    const rootY = head.y + sin * tailRootOffset;
    // 中间控制点:从尾根沿法向偏,加一个垂直 fan 角度偏移
    const ctrlOffset = 30;
    const fa = head.angle + Math.PI + fan;
    const ctrlX = rootX + Math.cos(fa) * ctrlOffset;
    const ctrlY = rootY + Math.sin(fa) * ctrlOffset;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute(
      'd',
      `M ${rootX.toFixed(1)},${rootY.toFixed(1)} Q ${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${sample.x.toFixed(1)},${sample.y.toFixed(1)}`,
    );
    p.setAttribute('stroke', 'url(#ph-feather)');
    p.setAttribute('stroke-width', String(2.4 + i * 0.4));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('fill', 'none');
    p.setAttribute('opacity', String(0.55 + i * 0.08));
    tails.appendChild(p);
  }
}

function clearPhoenixFromDom(svg: SVGSVGElement | null): void {
  if (!svg) return;
  // 翎羽尾迹 — 每帧重画,直接清掉
  const tails = svg.querySelector<SVGGElement>('g[data-role="ph-tails"]');
  if (tails) while (tails.firstChild) tails.removeChild(tails.firstChild);
  // 鸟体挪到屏外,下次飞行第一帧 commit 会重设 transform
  const body = svg.querySelector<SVGGElement>('g[data-role="ph-body"]');
  body?.setAttribute('transform', 'translate(-9999 -9999)');
}

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
