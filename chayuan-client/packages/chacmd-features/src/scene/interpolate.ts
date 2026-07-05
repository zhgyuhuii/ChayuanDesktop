/**
 * AI Town「当前值 + 历史缓冲 + 插值」平滑（§4，useHistoricalValue 手法）。
 * 后端按 tick 推离散事件；前端缓存近期 (时间戳, 值) 样本，在渲染时刻按周边样本插值，
 * 把跳变回放成连续动画——不每帧拉数据、不卡。为节点位置/指标平滑铺底。
 */

/** 时间戳样本。 */
export interface Sample {
  t: number;
  value: number;
}

/** 线性插值，t 自动 clamp 到 [0,1]。 */
export function lerp(a: number, b: number, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * c;
}

/**
 * 在时刻 now 采样历史缓冲（假定 buffer 按 t 升序）。
 * 空缓冲 → undefined；now 越界 → clamp 到首/末样本；区间内 → 线性插值。
 */
export function sampleHistorical(buffer: Sample[], now: number): number | undefined {
  const first = buffer[0];
  if (first === undefined) return undefined;
  if (now <= first.t) return first.value;
  const last = buffer[buffer.length - 1];
  if (last === undefined) return first.value;
  if (now >= last.t) return last.value;

  for (let i = 0; i < buffer.length - 1; i += 1) {
    const a = buffer[i];
    const b = buffer[i + 1];
    if (a === undefined || b === undefined) continue;
    if (now >= a.t && now <= b.t) {
      const span = b.t - a.t;
      const t = span === 0 ? 0 : (now - a.t) / span;
      return lerp(a.value, b.value, t);
    }
  }
  return last.value;
}
