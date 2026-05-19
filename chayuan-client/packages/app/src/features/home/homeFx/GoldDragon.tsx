/**
 * 金龙 — 全屏盘旋游动动画。
 *
 * 渲染策略
 * --------
 * 1. **躯干**:24 段铰链椭圆,**follow-the-leader 物理**:
 *    - 头 (segment 0) 按 dragonPath.at(t) 实时定位
 *    - 后续每段 i 朝 i-1 移动,距离超过 SEG_LEN 时拉拽至 SEG_LEN
 *    - 这套算法天然产生蛇形扭动 — 头一拐弯,后面节节蜿蜒跟上
 * 2. **金光流转**:linearGradient 的 stop-offset 用 SMIL `<animate>`
 *    循环 2.4s,鳞片亮带沿身体从头扫到尾。
 * 3. **辉光**:filter feGaussianBlur + feMerge,让龙身泛金雾。
 * 4. **拖尾粒子**:头位置历史采样 12 个点,半衰期 0.5s 渐隐。
 *
 * 性能
 * ----
 * - rAF 仅在 active=true 时启动;document.hidden 自动停。
 * - prefers-reduced-motion: 整体不渲染。
 * - 一次飞行 7~14s,期间持续 60fps;两次飞行间静默(无 rAF)。
 */

import * as React from 'react';
import { makeFlightPath, type FlightPath } from './dragonPath';

const SEG_COUNT = 24;
const SEG_LEN = 14; // 段间距 px;调小 = 龙更紧凑
const HEAD_LEN = 36;
const HEAD_WIDTH = 22;
const TRAIL_LEN = 14;

// 段半径渐变 — 头粗尾细,中段最粗
function segRadius(i: number): number {
  if (i === 0) return HEAD_WIDTH;
  // 平缓抛物线:头 18 → 中 13 → 尾 4
  const u = i / (SEG_COUNT - 1);
  return 18 * (1 - u * 0.78);
}

interface DragonState {
  segs: Array<{ x: number; y: number; angle: number }>;
  trail: Array<{ x: number; y: number; t: number; r: number }>;
  active: boolean;
}

export interface GoldDragonProps {
  /** 飞行触发器:外部把这个数加 1 → 启动新一次飞行。 */
  flightKey: number;
  /** 视口尺寸,父层 ResizeObserver 监听传入。 */
  width: number;
  height: number;
  /** 飞行结束的回调 — 父层用来安排下一次的间隔。 */
  onFlightDone?: () => void;
  /** 调试用:暴露当前位置(主页之外不用)。 */
  onTick?: (x: number, y: number) => void;
}

export const GoldDragon: React.FC<GoldDragonProps> = ({
  flightKey,
  width,
  height,
  onFlightDone,
}) => {
  const reducedMotion = useReducedMotion();
  const containerRef = React.useRef<SVGSVGElement>(null);
  const stateRef = React.useRef<DragonState>({
    segs: Array.from({ length: SEG_COUNT }, () => ({ x: -200, y: -200, angle: 0 })),
    trail: [],
    active: false,
  });
  const pathRef = React.useRef<FlightPath | null>(null);
  const startTimeRef = React.useRef(0);
  const rafRef = React.useRef<number | null>(null);

  // 强制重渲染节流:每帧 setState 会撑爆 React,我们改用 ref 直接 DOM 操作 +
  // 每帧手动 commit 段位置。useState 只在飞行开始/结束时改一次。
  const [, forceRender] = React.useState(0);

  React.useEffect(() => {
    if (reducedMotion) return;
    if (flightKey <= 0) return;
    if (width <= 0 || height <= 0) return;

    // —— 新一次飞行
    pathRef.current = makeFlightPath(width, height);
    startTimeRef.current = performance.now();
    stateRef.current.active = true;
    stateRef.current.trail = [];

    // 初始化:把 24 段都堆到入场点附近,这样首帧不会出现"龙从原点(0,0)伸出"
    const headInit = pathRef.current.at(0);
    const initSegs = stateRef.current.segs;
    for (let i = 0; i < SEG_COUNT; i++) {
      initSegs[i] = {
        x: headInit.x - i * SEG_LEN * Math.cos(headInit.angle),
        y: headInit.y - i * SEG_LEN * Math.sin(headInit.angle),
        angle: headInit.angle,
      };
    }
    forceRender((n) => n + 1);

    const path = pathRef.current;
    const dur = path.durationSec * 1000;

    const loop = (now: number) => {
      if (document.hidden) {
        // 隐藏时不耗 CPU,但也不前进时间 — 切回来继续
        startTimeRef.current = now - (stateRef.current.segs[0]?.x ?? 0);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / dur);

      // —— 头位置
      const head = path.at(t);
      const segs = stateRef.current.segs;
      segs[0] = { x: head.x, y: head.y, angle: head.angle };

      // —— 后续段 follow-the-leader
      for (let i = 1; i < SEG_COUNT; i++) {
        const prev = segs[i - 1]!;
        const cur = segs[i]!;
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        const d = Math.hypot(dx, dy);
        const newAngle = Math.atan2(prev.y - cur.y, prev.x - cur.x);
        if (d > SEG_LEN) {
          const ratio = (d - SEG_LEN) / d;
          cur.x -= dx * ratio;
          cur.y -= dy * ratio;
        }
        cur.angle = newAngle;
      }

      // —— 拖尾粒子(从头位置采样)
      stateRef.current.trail.push({
        x: head.x,
        y: head.y,
        t: now,
        r: 4 + Math.random() * 3,
      });
      // 过期 700ms 的粒子丢
      stateRef.current.trail = stateRef.current.trail.filter(
        (p) => now - p.t < 700,
      );
      if (stateRef.current.trail.length > TRAIL_LEN) {
        stateRef.current.trail.splice(0, stateRef.current.trail.length - TRAIL_LEN);
      }

      // 直接 DOM 操作(比 setState 快几个数量级)
      commitToDom(containerRef.current, stateRef.current, now);

      if (t >= 1) {
        stateRef.current.active = false;
        rafRef.current = null;
        onFlightDone?.();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      stateRef.current.active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightKey, width, height, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <svg
      ref={containerRef}
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
        {/* 金色流转渐变 — 5 段,stop-offset 用 SMIL 循环 */}
        <linearGradient id="gd-body" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7a4a06">
            <animate attributeName="offset" values="0%;30%;0%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="25%" stopColor="#d49b1a">
            <animate attributeName="offset" values="25%;55%;25%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="50%" stopColor="#fff5c2">
            <animate attributeName="offset" values="50%;80%;50%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="75%" stopColor="#d49b1a">
            <animate attributeName="offset" values="75%;100%;75%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="#7a4a06" />
        </linearGradient>
        <radialGradient id="gd-particle" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff5c2" stopOpacity="1" />
          <stop offset="50%" stopColor="#ffd75a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a87209" stopOpacity="0" />
        </radialGradient>
        <filter id="gd-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur1" />
          <feGaussianBlur stdDeviation="8" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* —— 拖尾粒子层 */}
      <g data-role="trail" filter="url(#gd-glow)" />

      {/* —— 龙身段 + 鳞甲 */}
      <g data-role="body" filter="url(#gd-glow)">
        {Array.from({ length: SEG_COUNT }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 段数固定
          <g key={i} data-seg={i}>
            <ellipse rx={segRadius(i)} ry={segRadius(i) * 0.78} fill="url(#gd-body)" />
            {/* 鳞片亮线 — 每段一条对角斜线模拟鳞甲反光 */}
            <ellipse
              rx={segRadius(i) * 0.45}
              ry={segRadius(i) * 0.32}
              fill="#fff5c2"
              opacity="0.45"
              transform={`translate(0, ${-segRadius(i) * 0.25})`}
            />
          </g>
        ))}
      </g>

      {/* —— 龙鬃 / 背鳍 — 沿身体上方画 5 簇火焰状渐变三角 */}
      <g data-role="fins" filter="url(#gd-glow)" />

      {/* —— 龙头(独立组,跟随 segs[0] 的 angle 旋转) */}
      <g data-role="head" filter="url(#gd-glow)">
        <DragonHead />
      </g>
    </svg>
  );
};

// ──────────────────────────────────────────────────────────────
// 龙头 — 手工 SVG path,中国龙特征:角、鬃、须、睛、牙、张嘴
// ──────────────────────────────────────────────────────────────

const DragonHead: React.FC = () => (
  <>
    {/* 鬃毛 — 3 簇从脑后飘出 */}
    <path
      d="M -12,-12 Q -25,-26 -42,-24 Q -52,-18 -55,-8"
      stroke="#d49b1a"
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -8,-16 Q -20,-30 -38,-32"
      stroke="#fff5c2"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
      opacity="0.85"
    />
    <path
      d="M -10,10 Q -22,22 -40,22"
      stroke="#d49b1a"
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -8,14 Q -18,26 -32,30"
      stroke="#a87209"
      strokeWidth="1.8"
      strokeLinecap="round"
      fill="none"
    />

    {/* 角 — 2 根鹿角状,从额头后扫 */}
    <path
      d="M -10,-10 Q -22,-22 -28,-32 Q -30,-36 -34,-34"
      stroke="#7a4a06"
      strokeWidth="2.6"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -28,-32 Q -32,-34 -36,-30"
      stroke="#7a4a06"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -6,-13 Q -16,-26 -22,-34 Q -24,-37 -28,-35"
      stroke="#a87209"
      strokeWidth="2.2"
      strokeLinecap="round"
      fill="none"
    />

    {/* 头部主轮廓 — 龙首微张口 */}
    <path
      d="
        M 28,2
        C 26,-8 18,-14 8,-14
        C -8,-14 -16,-8 -16,0
        C -16,8 -8,14 8,14
        C 16,13 24,9 28,4
        L 24,2
        Z
      "
      fill="url(#gd-body)"
      stroke="#7a4a06"
      strokeWidth="0.8"
    />

    {/* 龙须 — 两道长须从上颌飘出 */}
    <path
      d="M 22,-2 Q 0,-12 -28,-14 Q -42,-12 -55,-6"
      stroke="#fff5c2"
      strokeWidth="1.3"
      strokeLinecap="round"
      fill="none"
      opacity="0.92"
    />
    <path
      d="M 22,4 Q 0,16 -28,18 Q -42,18 -55,12"
      stroke="#fff5c2"
      strokeWidth="1.3"
      strokeLinecap="round"
      fill="none"
      opacity="0.92"
    />

    {/* 眼睛 */}
    <circle cx="10" cy="-4" r="3" fill="#fff" />
    <circle cx="11.5" cy="-3.5" r="1.8" fill="#1a0d00" />
    <circle cx="12" cy="-4.2" r="0.6" fill="#fff" />

    {/* 牙 / 上下颚之间的牙齿 */}
    <path d="M 26,3 L 24,7 L 22,3 Z" fill="#fff" />
    <path d="M 23,3 L 21,6 L 19,3 Z" fill="#fff" />

    {/* 鼻孔 */}
    <ellipse cx="24" cy="-3" rx="1.4" ry="0.8" fill="#3a1d00" />
  </>
);

// ──────────────────────────────────────────────────────────────
// DOM commit — rAF 60fps 频率太高,绕过 React,直接读 ref + setAttribute
// ──────────────────────────────────────────────────────────────

function commitToDom(
  svg: SVGSVGElement | null,
  state: DragonState,
  now: number,
): void {
  if (!svg) return;

  // —— 龙身段
  const bodyGroup = svg.querySelector<SVGGElement>('g[data-role="body"]');
  if (bodyGroup) {
    const children = bodyGroup.children;
    for (let i = 0; i < state.segs.length && i < children.length; i++) {
      const seg = state.segs[i];
      const g = children[i] as SVGGElement | undefined;
      if (!seg || !g) continue;
      g.setAttribute(
        'transform',
        `translate(${seg.x.toFixed(1)} ${seg.y.toFixed(1)}) rotate(${((seg.angle * 180) / Math.PI).toFixed(1)})`,
      );
    }
  }

  // —— 龙头(段 0 的位置 + 切线角)
  const headGroup = svg.querySelector<SVGGElement>('g[data-role="head"]');
  const head = state.segs[0];
  if (headGroup && head) {
    headGroup.setAttribute(
      'transform',
      `translate(${head.x.toFixed(1)} ${head.y.toFixed(1)}) rotate(${((head.angle * 180) / Math.PI).toFixed(1)})`,
    );
  }

  // —— 拖尾粒子(动态重建 — 数量少,12 个左右)
  const trailGroup = svg.querySelector<SVGGElement>('g[data-role="trail"]');
  if (trailGroup) {
    while (trailGroup.firstChild) trailGroup.removeChild(trailGroup.firstChild);
    for (const p of state.trail) {
      const age = (now - p.t) / 700; // 0..1
      const op = (1 - age) * 0.85;
      const r = p.r * (1 + age * 1.2);
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', p.x.toFixed(1));
      c.setAttribute('cy', p.y.toFixed(1));
      c.setAttribute('r', r.toFixed(1));
      c.setAttribute('fill', 'url(#gd-particle)');
      c.setAttribute('opacity', op.toFixed(2));
      trailGroup.appendChild(c);
    }
  }

  // —— 背鳍(沿前 14 段画三角)
  const finsGroup = svg.querySelector<SVGGElement>('g[data-role="fins"]');
  if (finsGroup) {
    while (finsGroup.firstChild) finsGroup.removeChild(finsGroup.firstChild);
    for (let i = 1; i < 14; i++) {
      const seg = state.segs[i];
      if (!seg) continue;
      const r = segRadius(i);
      // 背鳍朝身体"上方"(垂直于切线)
      const perpX = -Math.sin(seg.angle);
      const perpY = Math.cos(seg.angle);
      const tipX = seg.x + perpX * (r + 8);
      const tipY = seg.y + perpY * (r + 8);
      const baseLX = seg.x + Math.cos(seg.angle) * r * 0.6 + perpX * r * 0.4;
      const baseLY = seg.y + Math.sin(seg.angle) * r * 0.6 + perpY * r * 0.4;
      const baseRX = seg.x - Math.cos(seg.angle) * r * 0.6 + perpX * r * 0.4;
      const baseRY = seg.y - Math.sin(seg.angle) * r * 0.6 + perpY * r * 0.4;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute(
        'd',
        `M ${baseLX.toFixed(1)},${baseLY.toFixed(1)} L ${tipX.toFixed(1)},${tipY.toFixed(1)} L ${baseRX.toFixed(1)},${baseRY.toFixed(1)} Z`,
      );
      p.setAttribute('fill', 'url(#gd-body)');
      p.setAttribute('opacity', '0.85');
      finsGroup.appendChild(p);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 媒体查询 hook
// ──────────────────────────────────────────────────────────────

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
