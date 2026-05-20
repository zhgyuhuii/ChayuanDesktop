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

// 段半径渐变:头(单独 SVG 渲染不计入 outline)→ 蛇颈细 → 主体丰满 → 尾尖
// "蛇项":首 6 段紧缩到 10~13 模拟细长蛇颈,跟头部巨大反差
function segRadius(i: number): number {
  if (i === 0) return HEAD_WIDTH; // 仅给 head 自身参考,outline 跳过
  // 1~6 段蛇颈:13 → 11(略递减) — 跟头部 (~50px wide) 形成显著对比
  if (i <= 6) return 13 - (i - 1) * 0.4;
  // 7~14 颈到身的过渡:11 → 20(快速增粗,模拟肩部)
  if (i <= 14) return 11 + (i - 6) * 1.2;
  // 15~24 主体段:20 → 17(平缓收)
  if (i <= 24) return 20 - (i - 14) * 0.3;
  // 25~30 后段渐细:17 → 11
  if (i <= 30) return 17 - (i - 24) * 1.0;
  // 31~35 尾尖:11 → 3
  return Math.max(2, 11 - (i - 30) * 1.8);
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

      {/* —— 鳞片层(每段一簇 3 片菱形鳞)
           各段初始 transform 挪屏外,首飞 commit 才正位 */}
      <g data-role="scales" filter="url(#gd-glow)">
        {Array.from({ length: SEG_COUNT }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 段数固定
          <g key={i} data-scale={i} transform="translate(-9999 -9999)">
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

      {/* —— 龙头 — 初始挪到屏外,首飞 rAF 第一帧才正位 */}
      <g data-role="head" transform="translate(-9999 -9999)" filter="url(#gd-glow)">
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

/**
 * 龙头 — 按"鹿角、驼头、兔眼、牛耳、狮鼻、虎口、蛇项、鲤须" 9 似复刻,
 * 加用户附加要求:额心大菱形鳞、骨棱粗眉、深口至眼后、上下交错獠牙、
 * 颊须长扫、鬃发如刺、肌颈连身。
 *
 * 头部坐标系
 * ----------
 * 原点 (0,0) = 颈接合点(头颅根部内侧);+X = 朝向运动方向(吻部前方)
 *
 *     -X (颈/后脑) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ → +X (吻部)
 *
 *     -Y (顶)
 *           ╱╲    ╱╲    鹿角
 *           ╲╱    ╲╱
 *           牛耳
 *      ┌─鬃刺─頭顶─驼峰─┐
 *      │              额心菱形       眉骨
 *      │      鬃刺      ┃         ◉ 兔眼  狮鼻
 *      │      鬃刺      ┃                 ╱
 *      │            ━━ 虎口张 ━━━━━━━━━━╲╲╲ 獠牙
 *      │            鲤须 ─ ─ ─ ─ ─ ─ ─ ─ ─→
 *      └──颔下──颊须──┘
 *     +Y (颌下)
 *
 * 渲染顺序(由后到前):
 *   1. 头后/颊须放射刺(鬃毛如针)
 *   2. 鹿角(粗壮多枝杈)
 *   3. 牛耳(小三角)
 *   4. 下颚(独立闭合)
 *   5. 口腔深暗
 *   6. 喉内能量球
 *   7. 上头颅主轮廓
 *   8. 骨棱眉骨
 *   9. 额心菱形大鳞
 *   10. 狮鼻 + 鼻孔 + 喷火
 *   11. 兔眼(凸圆 + 竖瞳)
 *   12. 交错獠牙(上下)
 *   13. 鲤须(2 长 + 2 副,最上层)
 */
const DragonHead: React.FC = () => (
  <>
    {/* ═══ 1. 鬃发如针 — 头颅周围 10 簇放射状尖刺(类似"爆炸针") ═══ */}
    <g data-part="mane-spikes">
      {/* 顶冠 4 簇朝后上 */}
      <path d="M -2,-30 L -26,-58 L -14,-32 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M 6,-34 L -8,-62 L 4,-36 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M 14,-36 L 4,-66 L 18,-38 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M -8,-22 L -38,-44 L -22,-22 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      {/* 后脑 3 簇朝后 */}
      <path d="M -10,-12 L -50,-22 L -22,-8 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M -10,-2 L -52,2 L -22,4 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M -8,10 L -48,18 L -20,16 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      {/* 颌下髯 3 簇朝下后 */}
      <path d="M -2,20 L -30,38 L -18,22 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M 10,26 L -8,44 L 0,26 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
      <path d="M 22,28 L 4,48 L 14,28 Z" fill="url(#gd-scale)" stroke="#3a1f00" strokeWidth="0.5" />
    </g>

    {/* ═══ 2. 鹿角 — 2 根多枝杈,粗壮虬曲 ═══ */}
    <g data-part="antlers">
      {/* 前角:主干 + 2 分枝 */}
      <path
        d="M 8,-32 Q -6,-52 -24,-62 M -10,-50 Q -18,-58 -26,-56 M -2,-44 Q -10,-52 -16,-50"
        stroke="#3a1f00"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 8,-32 Q -6,-52 -24,-62"
        stroke="#d4a72c"
        strokeWidth="1.5"
        fill="none"
        opacity="0.7"
      />
      {/* 后角:主干 + 2 分枝(略小、相位差) */}
      <path
        d="M 18,-32 Q 7,-50 -10,-58 M 2,-48 Q -4,-54 -12,-52 M 12,-42 Q 6,-50 -2,-48"
        stroke="#5a3306"
        strokeWidth="3.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 18,-32 Q 7,-50 -10,-58"
        stroke="#ffd75a"
        strokeWidth="1.2"
        fill="none"
        opacity="0.65"
      />
    </g>

    {/* ═══ 3. 牛耳 — 2 片小尖三角,藏在角根 ═══ */}
    <g data-part="ears">
      <path d="M 6,-28 L -6,-32 L 0,-22 Z" fill="url(#gd-body)" stroke="#3a1f00" strokeWidth="0.8" />
      <path d="M 4,-26 L -2,-30 L 0,-23 Z" fill="#5a3306" opacity="0.55" />
      <path d="M 16,-26 L 4,-30 L 10,-20 Z" fill="url(#gd-body)" stroke="#3a1f00" strokeWidth="0.8" />
    </g>

    {/* ═══ 4. 下颚 — 独立闭合形,先画(主头会盖颌根) ═══ */}
    <path
      d="
        M 30,14
        L 86,12
        Q 90,10 89,7
        Q 90,16 84,20
        Q 70,24 56,26
        Q 35,30 12,28
        Q -8,24 -10,16
        Q -4,11 8,11
        L 30,14 Z
      "
      fill="url(#gd-body)"
      stroke="#3a1f00"
      strokeWidth="1.3"
    />

    {/* ═══ 5. 口腔深暗 — 上下颚之间的阴影,显出"嘴张到眼后"的纵深 ═══ */}
    <path
      d="
        M 28,8
        L 84,5
        Q 88,8 84,12
        L 30,14
        Q 22,12 24,8
        Z
      "
      fill="#0a0500"
      opacity="0.92"
    />

    {/* ═══ 6. 喉内能量球 ═══ */}
    <circle cx="20" cy="14" r="6.5" fill="url(#gd-orb)">
      <animate attributeName="r" values="5.5;8;5.5" dur="1.6s" repeatCount="indefinite" />
    </circle>
    <circle cx="20" cy="14" r="11" fill="url(#gd-orb)" opacity="0.4">
      <animate attributeName="opacity" values="0.3;0.75;0.3" dur="1.6s" repeatCount="indefinite" />
    </circle>

    {/* ═══ 7. 上头颅主轮廓 — "驼峰额"+"狮鼻吻"+张口至眼后的虎口 ═══ */}
    <path
      d="
        M -8,-30
        Q 5,-38 22,-39
        Q 38,-40 50,-37
        Q 60,-33 62,-26
        Q 64,-20 64,-16
        Q 70,-12 80,-8
        Q 88,-4 90,0
        Q 91,4 88,6
        L 84,6
        L 28,8
        Q 22,6 24,1
        Q 22,-8 16,-14
        Q 6,-22 -4,-25
        Q -10,-26 -8,-30 Z
      "
      fill="url(#gd-body)"
      stroke="#3a1f00"
      strokeWidth="1.4"
    />

    {/* ═══ 8. 骨棱眉骨 — 重压感,眼眶上方一道凸起 ═══ */}
    <path
      d="M 38,-26 Q 50,-32 64,-26 L 60,-22 Q 50,-26 42,-22 Z"
      fill="#3a1f00"
      opacity="0.92"
    />
    <path
      d="M 40,-25 Q 50,-30 62,-25"
      stroke="#d4a72c"
      strokeWidth="0.8"
      fill="none"
      opacity="0.55"
    />

    {/* ═══ 9. 额心菱形大鳞 — 中央点睛(用户原话"大菱形中央鳞") ═══ */}
    <g transform="translate(34 -32)">
      <path
        d="M 0,-9 L 10,0 L 0,9 L -10,0 Z"
        fill="url(#gd-scale)"
        stroke="#3a1f00"
        strokeWidth="0.9"
      />
      {/* 菱形内 facet 高光层 */}
      <path d="M 0,-5 L 5,0 L 0,5 L -5,0 Z" fill="#fff8d0" opacity="0.7" />
      <path d="M 0,-2 L 2,0 L 0,2 L -2,0 Z" fill="#ffffff" opacity="0.9" />
    </g>

    {/* ═══ 10. 狮鼻 — 阔球 + 双鼻孔 + 喷火 ═══ */}
    <g data-part="nose">
      {/* 鼻球底色 */}
      <ellipse cx="83" cy="-1" rx="9" ry="6" fill="url(#gd-body)" stroke="#3a1f00" strokeWidth="0.9" />
      {/* 鼻翼阴影 */}
      <path d="M 75,-2 Q 78,-7 86,-7 Q 88,-4 86,-2 Z" fill="#7a4a06" opacity="0.55" />
      {/* 鼻孔(双) */}
      <ellipse cx="80" cy="-1" rx="2.6" ry="1.7" fill="#0a0500" />
      <ellipse cx="80" cy="-2" rx="1.1" ry="0.7" fill="#fff8d0" opacity="0.55" />
      {/* 喷火 — SMIL 透明度脉动 */}
      <path d="M 78,-2 Q 72,-6 67,-3 Q 72,-1 78,-1 Z" fill="url(#gd-orb)" opacity="0.7">
        <animate attributeName="opacity" values="0.35;0.95;0.35" dur="0.7s" repeatCount="indefinite" />
      </path>
      <path d="M 75,1 Q 70,4 66,1" stroke="#ff6a1a" strokeWidth="0.8" fill="none" opacity="0.5">
        <animate attributeName="opacity" values="0;0.6;0" dur="0.7s" repeatCount="indefinite" />
      </path>
    </g>

    {/* ═══ 11. 兔眼 — 大凸圆 + 竖瞳 + 眼骨凹 ═══ */}
    <g data-part="eye">
      {/* 眼眶凹陷阴影(让眼"凸"出来) */}
      <ellipse cx="50" cy="-17" rx="10" ry="8" fill="#1a0d00" opacity="0.95" />
      {/* 眼球白底(凸起,稍偏上) */}
      <ellipse cx="51" cy="-18" rx="7.5" ry="6" fill="#fff8d0" />
      {/* 虹膜金 */}
      <circle cx="52" cy="-17" r="5" fill="#ffaa3a">
        <animate attributeName="r" values="4.5;5.3;4.5" dur="2.4s" repeatCount="indefinite" />
      </circle>
      {/* 虹膜外环深色 */}
      <circle cx="52" cy="-17" r="5" fill="none" stroke="#7a4a06" strokeWidth="0.6" opacity="0.7" />
      <circle cx="52" cy="-17" r="3.6" fill="none" stroke="#ff6a1a" strokeWidth="0.45" opacity="0.6" />
      {/* 竖瞳 */}
      <ellipse cx="52" cy="-17" rx="0.9" ry="4.5" fill="#0a0500" />
      {/* 眼球高光(单大点 + 小点) */}
      <ellipse cx="53.6" cy="-19.2" rx="1.6" ry="1.1" fill="#ffffff" />
      <circle cx="50.5" cy="-15" r="0.5" fill="#fff" opacity="0.7" />
    </g>

    {/* ═══ 12. 交错獠牙 — 上颚 5 颗 + 下颚 4 颗,X-Y 错位形成"interlocking"咬合感 ═══ */}
    <g data-part="fangs">
      {/* 上獠 — 从上颚下垂,大小递减 */}
      <path d="M 78,6 L 75,15 L 72,6 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 68,6 L 64,16 L 60,6 Z" fill="#ffffff" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 56,6 L 53,13 L 50,6 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 46,7 L 43,12 L 40,7 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 36,7 L 33,11 L 30,7 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
      {/* 下獠 — 从下颚上挺,在上獠之间交错 */}
      <path d="M 76,14 L 73,6 L 70,14 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 64,14 L 61,5 L 58,14 Z" fill="#ffffff" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 52,14 L 49,7 L 46,14 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
      <path d="M 42,13 L 39,8 L 36,13 Z" fill="#fff8d0" stroke="#3a1f00" strokeWidth="0.35" />
    </g>

    {/* ═══ 13. 鲤须 — 2 长(主鬚,颊后扫向身后)+ 2 副(短伴鬚) ═══ */}
    <g data-part="whiskers">
      {/* 主鬚 1:上唇后颊出,长扫到颈侧 */}
      <path
        d="M 26,4 Q -2,2 -28,8 Q -56,18 -82,18"
        stroke="#fff8d0"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.96"
      />
      {/* 主鬚 2:下唇后颊出,长扫到颈下 */}
      <path
        d="M 26,14 Q 2,22 -22,28 Q -50,34 -78,30"
        stroke="#fff8d0"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.96"
      />
      {/* 副鬚 1+2:短伴鬚,跟主鬚同向但更短更细 */}
      <path
        d="M 24,6 Q 6,10 -14,16"
        stroke="#ffd75a"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
        opacity="0.82"
      />
      <path
        d="M 24,12 Q 4,20 -14,24"
        stroke="#ffd75a"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
        opacity="0.82"
      />
    </g>
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
  // **跳过 segs[0]** — 头部用独立 SVG 渲染,outline 从颈部 segs[1] 开始
  // 否则巨大头部会跟连续 outline 撞色 + 形状对不上
  const topPts: Array<[number, number]> = [];
  const botPts: Array<[number, number]> = [];
  for (let i = 1; i < N; i++) {
    const s = segs[i]!;
    const r = segRadius(i);
    const perpX = -Math.sin(s.angle);
    const perpY = Math.cos(s.angle);
    topPts.push([s.x + perpX * r, s.y + perpY * r]);
    botPts.push([s.x - perpX * r, s.y - perpY * r]);
  }

  const outline = svg.querySelector<SVGPathElement>('path[data-role="body-outline"]');
  if (outline && topPts.length >= 2) {
    // topPts / botPts 长度 = N-1(对应 segs[1..N-1])
    const M = topPts.length;
    let d = '';
    // 上边:沿 topPts 头→尾
    d += `M ${topPts[0]![0].toFixed(1)},${topPts[0]![1].toFixed(1)}`;
    for (let i = 1; i < M; i++) {
      const a = topPts[i - 1]!;
      const b = topPts[i]!;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      d += ` Q ${a[0].toFixed(1)},${a[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    // 尾部 — 收尖
    const tailTop = topPts[M - 1]!;
    const tailBot = botPts[M - 1]!;
    const tailMid: [number, number] = [(tailTop[0] + tailBot[0]) / 2, (tailTop[1] + tailBot[1]) / 2];
    // 尾鳍:从尾收尖向外延伸一个小三角(火苗状)
    const tailAngle = segs[N - 1]!.angle + Math.PI;
    const tailExtX = tailMid[0] + Math.cos(tailAngle) * 14;
    const tailExtY = tailMid[1] + Math.sin(tailAngle) * 14;
    d += ` L ${tailExtX.toFixed(1)},${tailExtY.toFixed(1)}`;
    // 下边:沿 botPts 尾→头
    for (let i = M - 1; i >= 1; i--) {
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
