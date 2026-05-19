/**
 * 龙的飞行路径生成器 — 一次飞行就是一条参数曲线 (t∈[0,1] → [x,y])。
 *
 * 设计要点
 * --------
 * 1. 入场:从屏幕外的左下/左上随机一边滑入,避免每次都从同一位置出来。
 * 2. 主轨迹:由 5~7 个航点 Catmull-Rom 插值,自带平滑切线,头不会"啪"地拐
 *    死弯。航点 y 用两个不同周期的 sin 叠加(避免规律的正弦看起来呆板)。
 * 3. 盘旋:中段一定概率插入一个紧螺旋(0.5~1.5 圈),做成"龙在屏幕中央盘了
 *    一下又游走"的效果 — 这是用户原话"盘旋游动"的核心动作。
 * 4. 出场:沿主方向继续延伸到屏幕外,头的切线方向保持连贯。
 *
 * 不依赖具体视口尺寸,生成时传入 (vw, vh),内部归一化。
 */

export interface FlightPath {
  /** 计算时刻 t∈[0,1] 时头的位置和切线方向(弧度)。 */
  at(t: number): { x: number; y: number; angle: number };
  /** 一次飞行的视觉时长(秒),路径越曲折越长。 */
  durationSec: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Catmull-Rom 插值 — 4 个控制点之间用 t∈[0,1] 平滑插值。 */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 给路径采样并预算长度,便于 t 重映射成等速运动(避免速度忽快忽慢)。 */
function buildArcLengthTable(
  sampler: (t: number) => Pt,
  steps: number,
): { table: number[]; totalLength: number } {
  const table = [0];
  let prev = sampler(0);
  let total = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = sampler(t);
    total += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    table.push(total);
    prev = cur;
  }
  return { table, totalLength: total };
}

/** 二分查 arc-length 反向映射:给定走过的弧长比例,返回原 t。 */
function arcToT(table: number[], totalLength: number, s: number): number {
  const target = s * totalLength;
  let lo = 0;
  let hi = table.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // table 由 buildArcLengthTable 生成,长度固定 = steps+1,索引一定有值
    if ((table[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  // 线性插值到段内
  if (lo === 0) return 0;
  const a = table[lo - 1] as number;
  const b = table[lo] as number;
  const u = b - a > 0 ? (target - a) / (b - a) : 0;
  return (lo - 1 + u) / (table.length - 1);
}

/**
 * 生成一条"穿越式 + 中段盘旋"的飞行路径。
 *
 * @param vw 视口宽
 * @param vh 视口高
 */
export function makeFlightPath(vw: number, vh: number): FlightPath {
  // —— 1. 主航点(屏幕坐标系,原点左上)
  const enterFromTop = Math.random() < 0.4;
  const start: Pt = enterFromTop
    ? { x: -200, y: rand(60, vh * 0.35) }
    : { x: -200, y: rand(vh * 0.5, vh * 0.85) };
  const end: Pt = { x: vw + 200, y: rand(60, vh * 0.45) };

  // 中段 3~4 个航点,y 沿正弦叠加
  const midCount = Math.floor(rand(3, 5));
  const mids: Pt[] = [];
  for (let i = 1; i <= midCount; i++) {
    const u = i / (midCount + 1);
    const x = start.x + (end.x - start.x) * u;
    const baseY = start.y + (end.y - start.y) * u;
    const wave = Math.sin(u * Math.PI * rand(1.4, 2.6)) * vh * rand(0.12, 0.22);
    const wave2 = Math.cos(u * Math.PI * rand(2.0, 3.4)) * vh * 0.06;
    mids.push({ x, y: baseY + wave + wave2 });
  }

  // 盘旋(50% 概率)— 在第二个航点附近插入一个螺旋段
  const coil = Math.random() < 0.55;
  const midIdx = Math.floor(midCount / 2);
  const midPt = mids[midIdx] ?? mids[0] ?? { x: vw / 2, y: vh / 2 };
  const coilCenter: Pt | null = coil ? { x: midPt.x, y: midPt.y } : null;
  const coilTurns = coil ? rand(0.8, 1.6) : 0;
  const coilRadius = coil ? rand(70, 140) : 0;

  // —— 2. Catmull-Rom 主曲线(无盘旋部分)
  const allPts: Pt[] = [start, ...mids, end];
  // 首尾各加一个延伸虚拟点,避免端点切线偏
  const phantomStart: Pt = { x: start.x - 100, y: start.y };
  const phantomEnd: Pt = { x: end.x + 100, y: end.y };
  const cps: Pt[] = [phantomStart, ...allPts, phantomEnd];

  // 主曲线采样函数:t∈[0,1] 映射到 Catmull-Rom 总参数空间
  const segCount = cps.length - 3;
  const mainAt = (t: number): Pt => {
    const u = Math.max(0, Math.min(0.9999, t)) * segCount;
    const idx = Math.floor(u);
    const local = u - idx;
    // idx 取值范围保证 idx, idx+1, idx+2, idx+3 都在 cps 范围内
    return catmullRom(
      cps[idx] as Pt,
      cps[idx + 1] as Pt,
      cps[idx + 2] as Pt,
      cps[idx + 3] as Pt,
      local,
    );
  };

  // —— 3. 盘旋叠加:在 t∈[coilT0, coilT1] 区段把主轨迹平滑替换为螺旋绕 center
  // 实现:在该区间把 main 位置和螺旋位置按 ease in-out 加权混合,避免突然抖动
  const coilT0 = 0.38;
  const coilT1 = 0.62;
  const sampler = (t: number): Pt => {
    const main = mainAt(t);
    if (!coil || !coilCenter || t < coilT0 || t > coilT1) return main;
    const u = (t - coilT0) / (coilT1 - coilT0); // 0..1 段内
    // ease in-out:进入慢慢混入螺旋,中段全螺旋,退出再混回主轨
    const w =
      u < 0.5
        ? 4 * u * u * u
        : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const angle = u * Math.PI * 2 * coilTurns;
    const r = coilRadius * (1 - 0.4 * Math.abs(u - 0.5) * 2);
    const sx = coilCenter.x + Math.cos(angle) * r;
    const sy = coilCenter.y + Math.sin(angle) * r * 0.85; // 略压扁,视觉更像"在空中盘旋"
    return {
      x: main.x * (1 - w) + sx * w,
      y: main.y * (1 - w) + sy * w,
    };
  };

  // —— 4. 等速重参数化
  const { table, totalLength } = buildArcLengthTable(sampler, 200);
  // 把弧长除速度算出时长 — 屏幕越大、路径越绕,飞越久
  const speed = rand(380, 520); // px/sec
  const durationSec = Math.max(7, Math.min(14, totalLength / speed));

  // —— 5. 暴露 at()
  return {
    durationSec,
    at(t: number) {
      const tt = arcToT(table, totalLength, Math.max(0, Math.min(1, t)));
      const p = sampler(tt);
      // 切线方向用前后差分
      const eps = 0.003;
      const a = sampler(Math.max(0, tt - eps));
      const b = sampler(Math.min(1, tt + eps));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      return { x: p.x, y: p.y, angle };
    },
  };
}
