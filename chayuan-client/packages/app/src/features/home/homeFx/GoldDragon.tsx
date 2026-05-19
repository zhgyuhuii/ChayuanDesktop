/**
 * 金龙 — 全屏盘旋游动动画(写实级升级版,2026-05-20)。
 *
 * 升级要点
 * --------
 * 旧版:24 段离散椭圆,看起来像"串珠"。新版:
 *   1. **连续 body outline 路径**:36 段位置驱动 Catmull-Rom 平滑曲线,
 *      用 quadratic bezier 串成一条带 taper(头粗尾细)的封闭路径,无段感
 *   2. **金属鳞片簇**:每段贴 3 小片菱形鳞,头部密尾部稀,SVG `path` 模拟
 *      鎏金鳞甲反光
 *   3. **4 爪开张**:5、12、22、29 段挂腿,每爪 5 指(钩状)+ 关节,跟着身体
 *      扭动同步偏移
 *   4. **怒目张嘴**:DragonHead 重画,张嘴露獠牙,喉内能量光球(动态发光)
 *   5. **多束鬃毛 + 长须**:头后 5 缕鬃 + 6 根背鳍片状鬃毛(沿前 14 段),
 *      龙须 2 长 + 4 短
 *   6. **三层金色金属渐变**:深古铜 → 亮金 → 白金 高光,SMIL 流转 2.4s
 *      一圈,带"高光带"扫过整条龙的效果
 *   7. **辉光**:三层 feGaussianBlur(2/4/9 stdDev)叠加 → 龙身泛金雾 +
 *      外圈金红 halo
 *
 * follow-the-leader 物理引擎不变,只换渲染层。
 */

import * as React from 'react';
import { makeFlightPath, type FlightPath } from './dragonPath';

const SEG_COUNT = 36;
const SEG_LEN = 10; // 段间距 px;36×10 = 总长 ~360px(舒展) / 紧密盘旋时 ~280
const HEAD_WIDTH = 26;
const TRAIL_LEN = 16;
// 飞行结束后再拖 1.6s,让头沿出场方向匀速跑出屏外,身体节节跟着出去 —
// 否则 t=1 时头在屏边界、尾还在屏中,直接停掉会"残留半截龙"。
const EXIT_EXTENSION_MS = 1600;
const EXIT_VELOCITY_PXPS = 480;
// 四足挂点 — 段编号。1/6, 1/3, 5/8, 3/4 沿体长
const LIMB_ANCHORS: ReadonlyArray<{ idx: number; side: 1 | -1 }> = [
  { idx: 5, side: 1 },   // 右前足
  { idx: 5, side: -1 },  // 左前足
  { idx: 22, side: 1 },  // 右后足
  { idx: 22, side: -1 }, // 左后足
];

// 段半径渐变:头 22 → 中段最粗 16 → 尾 3
function segRadius(i: number): number {
  if (i === 0) return HEAD_WIDTH;
  const u = i / (SEG_COUNT - 1);
  // 改进抛物线:1 段 18,中段 14,尾段 3 — 更细更优雅
  if (u < 0.15) return 18 - u * 13; // 1~5 段从 18 渐到 16
  if (u < 0.75) return 16 - (u - 0.15) * 6; // 中段从 16 到 ~12
  // 尾部加速变细
  return Math.max(2, 12 - (u - 0.75) * 36);
}

interface SegPt {
  x: number;
  y: number;
  angle: number;
}

interface DragonState {
  segs: SegPt[];
  trail: Array<{ x: number; y: number; t: number; r: number }>;
  active: boolean;
}

export interface GoldDragonProps {
  flightKey: number;
  width: number;
  height: number;
  onFlightDone?: () => void;
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

  const [, forceRender] = React.useState(0);

  React.useEffect(() => {
    if (reducedMotion) return;
    if (flightKey <= 0) return;
    if (width <= 0 || height <= 0) return;

    pathRef.current = makeFlightPath(width, height);
    startTimeRef.current = performance.now();
    stateRef.current.active = true;
    stateRef.current.trail = [];

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
    // 缓存出场参数,避免 extension 阶段每帧重新算 path.at(1)
    const exitState = path.at(1);

    const loop = (now: number) => {
      if (document.hidden) {
        startTimeRef.current = now - (stateRef.current.segs[0]?.x ?? 0);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const elapsed = now - startTimeRef.current;
      const segs = stateRef.current.segs;

      let headX: number;
      let headY: number;
      let headAngle: number;

      if (elapsed < dur) {
        // 正常飞行段:沿 path 走
        const t = elapsed / dur;
        const head = path.at(t);
        headX = head.x;
        headY = head.y;
        headAngle = head.angle;
      } else {
        // 离场延长段:头继续沿出场方向匀速,身体 follow-the-leader 跟着出
        const extElapsed = elapsed - dur;
        if (extElapsed >= EXIT_EXTENSION_MS) {
          // 整条龙都飞出去了,彻底清掉
          clearDragonFromDom(containerRef.current);
          stateRef.current.active = false;
          rafRef.current = null;
          onFlightDone?.();
          return;
        }
        const extSec = extElapsed / 1000;
        headX = exitState.x + Math.cos(exitState.angle) * EXIT_VELOCITY_PXPS * extSec;
        headY = exitState.y + Math.sin(exitState.angle) * EXIT_VELOCITY_PXPS * extSec;
        headAngle = exitState.angle;
      }

      segs[0] = { x: headX, y: headY, angle: headAngle };

      // follow-the-leader 算后续段
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

      stateRef.current.trail.push({
        x: headX,
        y: headY,
        t: now,
        r: 4 + Math.random() * 3,
      });
      stateRef.current.trail = stateRef.current.trail.filter(
        (p) => now - p.t < 700,
      );
      if (stateRef.current.trail.length > TRAIL_LEN) {
        stateRef.current.trail.splice(0, stateRef.current.trail.length - TRAIL_LEN);
      }

      commitToDom(containerRef.current, stateRef.current, now);
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
        {/* 主金属金渐变 — 5 段,SMIL 流转产生"高光带" */}
        <linearGradient id="gd-body" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5a3306">
            <animate attributeName="offset" values="0%;30%;0%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="22%" stopColor="#d4a72c">
            <animate attributeName="offset" values="22%;55%;22%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="50%" stopColor="#fff8d0">
            <animate attributeName="offset" values="50%;82%;50%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="78%" stopColor="#d4a72c">
            <animate attributeName="offset" values="78%;100%;78%" dur="2.4s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="#5a3306" />
        </linearGradient>
        {/* 鳞片专用渐变 — 更亮的金,反光强 */}
        <linearGradient id="gd-scale" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fff8d0" />
          <stop offset="55%" stopColor="#ffd75a" />
          <stop offset="100%" stopColor="#8a5a0a" />
        </linearGradient>
        {/* 龙腹色 — 更亮 */}
        <linearGradient id="gd-belly" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffd75a" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fff8d0" stopOpacity="0.95" />
        </linearGradient>
        {/* 喉内能量球 — 红橙发光 */}
        <radialGradient id="gd-orb" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#ffec80" />
          <stop offset="70%" stopColor="#ff6a1a" />
          <stop offset="100%" stopColor="#7a1208" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gd-particle" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff5c2" stopOpacity="1" />
          <stop offset="50%" stopColor="#ffd75a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a87209" stopOpacity="0" />
        </radialGradient>
        {/* 双层辉光 + 外圈金红 halo */}
        <filter id="gd-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b1" />
          <feGaussianBlur stdDeviation="5" result="b2" />
          <feGaussianBlur stdDeviation="11" result="b3" />
          <feMerge>
            <feMergeNode in="b3" />
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g data-role="trail" filter="url(#gd-glow)" />

      {/* —— 主体外轮廓 + 高光腹线(rAF 每帧重写 d) */}
      <g data-role="body-shell" filter="url(#gd-glow)">
        <path data-role="body-outline" fill="url(#gd-body)" stroke="#5a3306" strokeWidth="1" strokeOpacity="0.85" />
        <path data-role="belly-line" fill="none" stroke="url(#gd-belly)" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
        <path data-role="spine-highlight" fill="none" stroke="#fff8d0" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      </g>

      {/* —— 鳞片层(每段一簇 3 片菱形鳞) */}
      <g data-role="scales" filter="url(#gd-glow)">
        {Array.from({ length: SEG_COUNT }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 段数固定
          <g key={i} data-scale={i}>
            {i > 0 && i < SEG_COUNT - 2 && (
              <>
                <ScaleDiamond r={Math.max(2, segRadius(i) * 0.42)} dy={-segRadius(i) * 0.25} />
                <ScaleDiamond r={Math.max(2, segRadius(i) * 0.34)} dy={0} />
                <ScaleDiamond r={Math.max(2, segRadius(i) * 0.42)} dy={segRadius(i) * 0.25} />
              </>
            )}
          </g>
        ))}
      </g>

      {/* —— 4 爪(每帧重画,跟挂载段同步) */}
      <g data-role="limbs" filter="url(#gd-glow)" />

      {/* —— 背鳍 + 鬃毛(每帧重画,沿身体上方) */}
      <g data-role="fins" filter="url(#gd-glow)" />

      {/* —— 龙头 */}
      <g data-role="head" filter="url(#gd-glow)">
        <DragonHead />
      </g>
    </svg>
  );
};

// ──────────────────────────────────────────────────────────────
// 单片菱形鳞 — 金属反光,顶亮底暗
// ──────────────────────────────────────────────────────────────

const ScaleDiamond: React.FC<{ r: number; dy: number }> = ({ r, dy }) => (
  <path
    d={`M 0,${dy - r * 0.7} L ${r * 0.85},${dy} L 0,${dy + r * 0.6} L ${-r * 0.85},${dy} Z`}
    fill="url(#gd-scale)"
    stroke="#7a4a06"
    strokeWidth="0.4"
    opacity="0.92"
  />
);

// ──────────────────────────────────────────────────────────────
// 龙头 — 怒目张嘴 + 喉内能量球
// ──────────────────────────────────────────────────────────────

const DragonHead: React.FC = () => (
  <>
    {/* —— 鬃毛 5 簇:头后向上下散开,大簇 */}
    <path
      d="M -12,-14 Q -28,-30 -52,-30 Q -62,-22 -68,-10"
      stroke="#d4a72c"
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -10,-18 Q -24,-34 -46,-38 Q -54,-32 -56,-22"
      stroke="#fff8d0"
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.9"
    />
    <path
      d="M -8,-20 Q -18,-38 -32,-42"
      stroke="#ffd75a"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -10,14 Q -26,30 -48,34 Q -58,28 -62,18"
      stroke="#d4a72c"
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -8,18 Q -22,34 -38,38"
      stroke="#a87209"
      strokeWidth="2.2"
      strokeLinecap="round"
      fill="none"
    />

    {/* —— 双角:粗壮鹿角,带分叉 */}
    <path
      d="M -10,-12 Q -22,-26 -32,-38 Q -36,-44 -42,-42 M -32,-38 Q -38,-42 -42,-36"
      stroke="#5a3306"
      strokeWidth="3.2"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M -6,-15 Q -16,-30 -24,-42 Q -28,-48 -34,-44 M -24,-42 Q -30,-46 -34,-38"
      stroke="#7a4a06"
      strokeWidth="2.6"
      strokeLinecap="round"
      fill="none"
    />

    {/* —— 头部主轮廓(张开嘴,上下颚分离) */}
    {/* 上颚 */}
    <path
      d="
        M 34,-2
        C 32,-12 22,-18 8,-18
        C -10,-18 -20,-10 -20,-2
        C -20,2 -8,4 4,2
        C 14,2 24,0 30,-2
        L 34,-2 Z
      "
      fill="url(#gd-body)"
      stroke="#5a3306"
      strokeWidth="0.9"
    />
    {/* 下颚 */}
    <path
      d="
        M 32,4
        C 28,12 18,16 6,16
        C -6,16 -16,12 -18,6
        C -18,4 -10,4 0,5
        C 12,7 22,7 32,4 Z
      "
      fill="url(#gd-body)"
      stroke="#5a3306"
      strokeWidth="0.9"
    />

    {/* —— 喉内能量球(发光) */}
    <circle cx="6" cy="4" r="5.5" fill="url(#gd-orb)">
      <animate
        attributeName="r"
        values="5;7;5"
        dur="1.6s"
        repeatCount="indefinite"
      />
    </circle>
    {/* 能量球外层光晕 */}
    <circle cx="6" cy="4" r="9" fill="url(#gd-orb)" opacity="0.45">
      <animate
        attributeName="opacity"
        values="0.4;0.8;0.4"
        dur="1.6s"
        repeatCount="indefinite"
      />
    </circle>

    {/* —— 獠牙 上下两排 */}
    <path d="M 30,-1 L 27,5 L 24,-1 Z" fill="#fff8d0" />
    <path d="M 23,-1 L 20,4 L 17,-1 Z" fill="#fff8d0" />
    <path d="M 28,5 L 25,0 L 22,5 Z" fill="#fff8d0" />
    <path d="M 21,5 L 18,0 L 15,5 Z" fill="#fff8d0" />

    {/* —— 龙须 4 根:2 长(主)+ 2 短(副)*/}
    <path
      d="M 26,-3 Q 0,-16 -36,-22 Q -56,-22 -72,-14"
      stroke="#fff8d0"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.95"
    />
    <path
      d="M 26,7 Q 0,22 -36,28 Q -56,28 -72,20"
      stroke="#fff8d0"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.95"
    />
    <path
      d="M 22,-5 Q 0,-12 -22,-15"
      stroke="#ffd75a"
      strokeWidth="0.9"
      strokeLinecap="round"
      fill="none"
      opacity="0.75"
    />
    <path
      d="M 22,9 Q 0,18 -22,20"
      stroke="#ffd75a"
      strokeWidth="0.9"
      strokeLinecap="round"
      fill="none"
      opacity="0.75"
    />

    {/* —— 怒目:眼眶下压(三角斜眼),金光瞳孔 */}
    {/* 眉骨阴影 */}
    <path d="M 4,-12 L 18,-10 L 14,-6 Z" fill="#5a3306" opacity="0.85" />
    {/* 眼白 */}
    <ellipse cx="11" cy="-6" rx="3.5" ry="2.2" fill="#fff8d0" transform="rotate(-12 11 -6)" />
    {/* 金瞳孔 */}
    <ellipse cx="11.5" cy="-5.6" rx="1.8" ry="2" fill="#ffaa3a" transform="rotate(-12 11.5 -5.6)">
      <animate attributeName="rx" values="1.6;2.0;1.6" dur="2.4s" repeatCount="indefinite" />
    </ellipse>
    {/* 竖瞳 */}
    <ellipse cx="11.5" cy="-5.6" rx="0.45" ry="1.7" fill="#1a0d00" transform="rotate(-12 11.5 -5.6)" />
    {/* 眼内高光 */}
    <circle cx="12.3" cy="-6.2" r="0.6" fill="#fff" />

    {/* —— 鼻孔 — 火焰小喷流 */}
    <ellipse cx="28" cy="-5" rx="1.6" ry="0.9" fill="#3a1d00" />
    <path
      d="M 30,-4 Q 34,-6 36,-3 Q 33,-3 30,-3 Z"
      fill="url(#gd-orb)"
      opacity="0.65"
    >
      <animate
        attributeName="opacity"
        values="0.4;0.85;0.4"
        dur="0.9s"
        repeatCount="indefinite"
      />
    </path>
  </>
);

// ──────────────────────────────────────────────────────────────
// DOM commit — 每帧重画 outline path / 鳞片定位 / 4 爪 / 鬃毛 / 龙头
// ──────────────────────────────────────────────────────────────

function commitToDom(
  svg: SVGSVGElement | null,
  state: DragonState,
  now: number,
): void {
  if (!svg) return;

  const segs = state.segs;
  const N = segs.length;

  // —— 1. 主体外轮廓(taper polygon)
  // 上下边各计算 N 个点,前向 + 后向连接成闭合多边形
  const topPts: Array<[number, number]> = [];
  const botPts: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const s = segs[i]!;
    const r = segRadius(i);
    const perpX = -Math.sin(s.angle);
    const perpY = Math.cos(s.angle);
    topPts.push([s.x + perpX * r, s.y + perpY * r]);
    botPts.push([s.x - perpX * r, s.y - perpY * r]);
  }

  const outline = svg.querySelector<SVGPathElement>('path[data-role="body-outline"]');
  if (outline) {
    // 用 quadratic bezier 串平滑曲线 — 控制点 = 相邻两点中点
    let d = '';
    // 上边:沿 topPts 头→尾
    d += `M ${topPts[0]![0].toFixed(1)},${topPts[0]![1].toFixed(1)}`;
    for (let i = 1; i < N; i++) {
      const a = topPts[i - 1]!;
      const b = topPts[i]!;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      d += ` Q ${a[0].toFixed(1)},${a[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    // 尾部 — 收尖
    const tailTop = topPts[N - 1]!;
    const tailBot = botPts[N - 1]!;
    const tailMid: [number, number] = [(tailTop[0] + tailBot[0]) / 2, (tailTop[1] + tailBot[1]) / 2];
    // 尾鳍:从尾收尖向外延伸一个小三角(火苗状)
    const tailAngle = segs[N - 1]!.angle + Math.PI;
    const tailExtX = tailMid[0] + Math.cos(tailAngle) * 14;
    const tailExtY = tailMid[1] + Math.sin(tailAngle) * 14;
    d += ` L ${tailExtX.toFixed(1)},${tailExtY.toFixed(1)}`;
    // 下边:沿 botPts 尾→头
    for (let i = N - 1; i >= 1; i--) {
      const a = botPts[i]!;
      const b = botPts[i - 1]!;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      d += ` Q ${a[0].toFixed(1)},${a[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    d += ' Z';
    outline.setAttribute('d', d);
  }

  // —— 1.1 腹线高光(沿身体中线偏下,从头到尾)
  const belly = svg.querySelector<SVGPathElement>('path[data-role="belly-line"]');
  if (belly) {
    let d = '';
    for (let i = 1; i < N; i++) {
      const s = segs[i]!;
      const perpX = -Math.sin(s.angle);
      const perpY = Math.cos(s.angle);
      // 腹部偏下 — perp 反向 0.4r
      const bx = s.x - perpX * segRadius(i) * 0.4;
      const by = s.y - perpY * segRadius(i) * 0.4;
      d += i === 1 ? `M ${bx.toFixed(1)},${by.toFixed(1)}` : ` L ${bx.toFixed(1)},${by.toFixed(1)}`;
    }
    belly.setAttribute('d', d);
  }
  // 脊线高光(身体上方)
  const spine = svg.querySelector<SVGPathElement>('path[data-role="spine-highlight"]');
  if (spine) {
    let d = '';
    for (let i = 1; i < N - 2; i++) {
      const s = segs[i]!;
      const perpX = -Math.sin(s.angle);
      const perpY = Math.cos(s.angle);
      const sx = s.x + perpX * segRadius(i) * 0.55;
      const sy = s.y + perpY * segRadius(i) * 0.55;
      d += i === 1 ? `M ${sx.toFixed(1)},${sy.toFixed(1)}` : ` L ${sx.toFixed(1)},${sy.toFixed(1)}`;
    }
    spine.setAttribute('d', d);
  }

  // —— 2. 鳞片簇 — 每个 <g data-scale={i}> 跟随段位置 + 旋转
  const scalesGroup = svg.querySelector<SVGGElement>('g[data-role="scales"]');
  if (scalesGroup) {
    const children = scalesGroup.children;
    for (let i = 0; i < N && i < children.length; i++) {
      const seg = segs[i];
      const g = children[i] as SVGGElement | undefined;
      if (!seg || !g) continue;
      g.setAttribute(
        'transform',
        `translate(${seg.x.toFixed(1)} ${seg.y.toFixed(1)}) rotate(${((seg.angle * 180) / Math.PI).toFixed(1)})`,
      );
    }
  }

  // —— 3. 4 爪 — 每帧重画
  const limbsGroup = svg.querySelector<SVGGElement>('g[data-role="limbs"]');
  if (limbsGroup) {
    while (limbsGroup.firstChild) limbsGroup.removeChild(limbsGroup.firstChild);
    for (const anchor of LIMB_ANCHORS) {
      const seg = segs[anchor.idx];
      if (!seg) continue;
      drawLimb(limbsGroup, seg, anchor.side, anchor.idx);
    }
  }

  // —— 4. 背鳍 + 鬃毛(前 14 段)
  const fins = svg.querySelector<SVGGElement>('g[data-role="fins"]');
  if (fins) {
    while (fins.firstChild) fins.removeChild(fins.firstChild);
    for (let i = 1; i < 18; i++) {
      const s = segs[i];
      if (!s) continue;
      const r = segRadius(i);
      const perpX = -Math.sin(s.angle);
      const perpY = Math.cos(s.angle);
      const tipX = s.x + perpX * (r + 10);
      const tipY = s.y + perpY * (r + 10);
      const baseLX = s.x + Math.cos(s.angle) * r * 0.5 + perpX * r * 0.4;
      const baseLY = s.y + Math.sin(s.angle) * r * 0.5 + perpY * r * 0.4;
      const baseRX = s.x - Math.cos(s.angle) * r * 0.5 + perpX * r * 0.4;
      const baseRY = s.y - Math.sin(s.angle) * r * 0.5 + perpY * r * 0.4;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // 前几段背鳍更高更尖,模拟鬃毛;后段渐变成普通鳍
      const tall = i < 6 ? r * 0.6 : 0; // 前 6 段加高
      const finTipX = tipX + perpX * tall;
      const finTipY = tipY + perpY * tall;
      p.setAttribute(
        'd',
        `M ${baseLX.toFixed(1)},${baseLY.toFixed(1)} L ${finTipX.toFixed(1)},${finTipY.toFixed(1)} L ${baseRX.toFixed(1)},${baseRY.toFixed(1)} Z`,
      );
      p.setAttribute('fill', 'url(#gd-scale)');
      p.setAttribute('stroke', '#5a3306');
      p.setAttribute('stroke-width', '0.4');
      p.setAttribute('opacity', '0.92');
      fins.appendChild(p);
    }
  }

  // —— 5. 龙头
  const headGroup = svg.querySelector<SVGGElement>('g[data-role="head"]');
  const head = segs[0];
  if (headGroup && head) {
    headGroup.setAttribute(
      'transform',
      `translate(${head.x.toFixed(1)} ${head.y.toFixed(1)}) rotate(${((head.angle * 180) / Math.PI).toFixed(1)})`,
    );
  }

  // —— 6. 拖尾粒子
  const trail = svg.querySelector<SVGGElement>('g[data-role="trail"]');
  if (trail) {
    while (trail.firstChild) trail.removeChild(trail.firstChild);
    for (const p of state.trail) {
      const age = (now - p.t) / 700;
      const op = (1 - age) * 0.85;
      const r = p.r * (1 + age * 1.2);
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', p.x.toFixed(1));
      c.setAttribute('cy', p.y.toFixed(1));
      c.setAttribute('r', r.toFixed(1));
      c.setAttribute('fill', 'url(#gd-particle)');
      c.setAttribute('opacity', op.toFixed(2));
      trail.appendChild(c);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 一次飞行结束后清场 — 把 path d 清空 + 动态层全删,避免"半截龙残留"
// ──────────────────────────────────────────────────────────────

function clearDragonFromDom(svg: SVGSVGElement | null): void {
  if (!svg) return;
  // 主体三条 path:body-outline / belly-line / spine-highlight
  svg.querySelectorAll<SVGPathElement>('path[data-role]').forEach((p) => {
    p.setAttribute('d', '');
  });
  // 鳞片层每段往屏外挪 — 下次飞行 commitToDom 第一帧会重新就位
  const scales = svg.querySelector<SVGGElement>('g[data-role="scales"]');
  if (scales) {
    for (let i = 0; i < scales.children.length; i++) {
      (scales.children[i] as SVGGElement).setAttribute(
        'transform',
        'translate(-9999 -9999)',
      );
    }
  }
  // 头同样挪走
  const head = svg.querySelector<SVGGElement>('g[data-role="head"]');
  head?.setAttribute('transform', 'translate(-9999 -9999)');
  // limbs / fins / trail 是 commitToDom 每帧动态生成,直接全清
  ['limbs', 'fins', 'trail'].forEach((role) => {
    const g = svg.querySelector<SVGGElement>(`g[data-role="${role}"]`);
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
  });
}

// ──────────────────────────────────────────────────────────────
// 单条爪子 — 大腿 + 小腿 + 5 钩状指
// ──────────────────────────────────────────────────────────────

function drawLimb(
  group: SVGGElement,
  anchor: SegPt,
  side: 1 | -1,
  segIdx: number,
): void {
  // 跟身体的偏移角度 — 沿 perp,加上轻微往后甩(模拟扑爪)
  const perpX = -Math.sin(anchor.angle);
  const perpY = Math.cos(anchor.angle);
  // 大腿根部:身体外侧 0.7r
  const r = segRadius(segIdx);
  const hipX = anchor.x + perpX * side * r * 0.5;
  const hipY = anchor.y + perpY * side * r * 0.5;

  // 大腿外伸:朝身体外 + 轻微向后(沿 -tangent)
  const tangentX = Math.cos(anchor.angle);
  const tangentY = Math.sin(anchor.angle);
  const upperLen = 26;
  const kneeX = hipX + perpX * side * upperLen * 0.6 - tangentX * upperLen * 0.3;
  const kneeY = hipY + perpY * side * upperLen * 0.6 - tangentY * upperLen * 0.3;

  // 小腿:从膝向外向前甩(扑爪动作)
  const lowerLen = 22;
  const wristX = kneeX + perpX * side * lowerLen * 0.4 + tangentX * lowerLen * 0.5;
  const wristY = kneeY + perpY * side * lowerLen * 0.4 + tangentY * lowerLen * 0.5;

  // 大腿(粗 path,带渐变填充)
  const thigh = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  thigh.setAttribute(
    'd',
    `M ${hipX.toFixed(1)},${hipY.toFixed(1)} Q ${(hipX + kneeX) / 2 + perpX * side * 5},${(hipY + kneeY) / 2 + perpY * side * 5} ${kneeX.toFixed(1)},${kneeY.toFixed(1)}`,
  );
  thigh.setAttribute('stroke', 'url(#gd-scale)');
  thigh.setAttribute('stroke-width', '11');
  thigh.setAttribute('stroke-linecap', 'round');
  thigh.setAttribute('fill', 'none');
  group.appendChild(thigh);

  // 小腿
  const shin = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shin.setAttribute(
    'd',
    `M ${kneeX.toFixed(1)},${kneeY.toFixed(1)} Q ${(kneeX + wristX) / 2 + tangentX * 3},${(kneeY + wristY) / 2 + tangentY * 3} ${wristX.toFixed(1)},${wristY.toFixed(1)}`,
  );
  shin.setAttribute('stroke', 'url(#gd-scale)');
  shin.setAttribute('stroke-width', '8');
  shin.setAttribute('stroke-linecap', 'round');
  shin.setAttribute('fill', 'none');
  group.appendChild(shin);

  // 5 钩状指 — 从腕部向前扇形展开,每根弯钩
  const fanAngles = [-0.5, -0.25, 0, 0.25, 0.5];
  const fingerBaseAngle = anchor.angle; // 朝身体前方
  for (const fan of fanAngles) {
    const a = fingerBaseAngle + fan;
    const len = 13;
    const midX = wristX + Math.cos(a) * len * 0.55 + perpX * side * 2;
    const midY = wristY + Math.sin(a) * len * 0.55 + perpY * side * 2;
    // 指尖:再前移并下勾(钩状)
    const tipX = midX + Math.cos(a) * len * 0.55 + perpX * side * 2.5;
    const tipY = midY + Math.sin(a) * len * 0.55 + perpY * side * 2.5;
    const claw = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    claw.setAttribute(
      'd',
      `M ${wristX.toFixed(1)},${wristY.toFixed(1)} Q ${midX.toFixed(1)},${midY.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}`,
    );
    claw.setAttribute('stroke', '#fff8d0');
    claw.setAttribute('stroke-width', '2.6');
    claw.setAttribute('stroke-linecap', 'round');
    claw.setAttribute('fill', 'none');
    group.appendChild(claw);
    // 黑色钩尖
    const tipDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    tipDot.setAttribute('cx', tipX.toFixed(1));
    tipDot.setAttribute('cy', tipY.toFixed(1));
    tipDot.setAttribute('r', '1.2');
    tipDot.setAttribute('fill', '#1a0d00');
    group.appendChild(tipDot);
  }
}

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
