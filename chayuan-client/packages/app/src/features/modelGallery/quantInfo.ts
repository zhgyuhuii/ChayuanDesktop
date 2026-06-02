/**
 * GGUF 量化档识别 + 设备适配建议(纯函数,便于测试 / 复用)。
 *
 * 评审「能用→好用」:多档 .gguf 平铺时,新手很难判断「选哪个 / 我的机器跑得动吗」。
 * 本模块从文件名抠出量化档(Q2_K / Q4_K_M / Q5_K_M / Q8_0 …),给出:
 *   - quant:           识别到的量化档标签(抠不出为 null);
 *   - approxRamBytes:  约需内存估算 = 文件大小 × 1.2(权重常驻 + KV cache / 运行时开销的
 *                      粗略经验系数;给「这台机器够不够」的量级判断,不追求精确);
 *   - recommended:     是否为推荐档。Q4_K_M(质量/体积平衡,社区默认首选)优先;
 *                      仓库没有 Q4_K_M 时,在已识别量化档里挑「最接近均衡」的一档兜底。
 *
 * 量化档正则:``Q\d(_K(_[MSL])?|_0|_1)?``,大小写不敏感,匹配如
 * Q2_K / Q3_K_S / Q3_K_M / Q3_K_L / Q4_0 / Q4_1 / Q4_K_M / Q5_K_M / Q6_K / Q8_0。
 */

/** 约需内存 ≈ 文件大小 × 1.2 的经验系数。 */
export const RAM_OVERHEAD_FACTOR = 1.2;

/** 「均衡」首选量化档(质量/体积平衡,新手默认)。 */
export const PREFERRED_QUANT = 'Q4_K_M';

const QUANT_RE = /Q\d(?:_K(?:_[MSL])?|_0|_1)?/i;

/** 单个文件的量化信息。 */
export interface QuantInfo {
  /** 识别到的量化档(规范化为大写,如 ``"Q4_K_M"``);抠不出为 null。 */
  quant: string | null;
  /** 约需内存(字节)= 文件大小 × 1.2;无大小为 null。 */
  approxRamBytes: number | null;
  /** 是否推荐档(由 ``markRecommended`` 在一组文件内决定;单文件查询默认 false)。 */
  recommended: boolean;
}

/**
 * 从单个文件名抠量化档 + 估内存。``recommended`` 需在一组文件里横向比较才能定,
 * 单文件粒度这里恒为 false;批量场景用 {@link annotateQuants}。
 */
export function quantInfo(filename: string, sizeBytes: number | null): QuantInfo {
  const m = filename.match(QUANT_RE);
  const quant = m ? m[0].toUpperCase() : null;
  const approxRamBytes =
    sizeBytes != null && sizeBytes > 0
      ? Math.round(sizeBytes * RAM_OVERHEAD_FACTOR)
      : null;
  return { quant, approxRamBytes, recommended: false };
}

/**
 * 排序优先级:量化档「档位」近似数值(从小到大),便于把 Q2_K…Q8_0 平铺时
 * 按体积/质量梯度排列。无法识别的(quant=null)排到最后。
 */
function quantRank(quant: string | null): number {
  if (!quant) return Number.POSITIVE_INFINITY;
  const digit = Number(quant[1]); // Q[N]_... 的 N
  // _K_S < _K_M < _K_L;_0/_1 视为该位的基础档。给同位档一个小的次序偏移。
  const sub = /_K_S/i.test(quant) ? 0.1 : /_K_M/i.test(quant) ? 0.2 : /_K_L/i.test(quant) ? 0.3 : 0;
  return (Number.isFinite(digit) ? digit : 99) + sub;
}

export interface QuantAnnotated<T> {
  file: T;
  info: QuantInfo;
}

/**
 * 给一组文件批量标注量化信息,并决定推荐档 + 排序。
 *
 * @param files     原始文件数组。
 * @param getName   取文件名。
 * @param getSize   取文件大小(字节,可为 null)。
 * @returns 标注后的数组,已按量化档「从小到大」排序;recommended 标在一档上:
 *          优先精确匹配 {@link PREFERRED_QUANT}(Q4_K_M),没有则取已识别量化档里
 *          quantRank 最接近 Q4_K_M(=4.2)的那档;一档量化都识别不出时不标推荐。
 */
export function annotateQuants<T>(
  files: readonly T[],
  getName: (f: T) => string,
  getSize: (f: T) => number | null,
): QuantAnnotated<T>[] {
  const annotated: QuantAnnotated<T>[] = files.map((file) => ({
    file,
    info: quantInfo(getName(file), getSize(file)),
  }));

  // 排序:量化档从小到大;无量化档的排最后,组内按文件名稳定。
  annotated.sort((a, b) => {
    const ra = quantRank(a.info.quant);
    const rb = quantRank(b.info.quant);
    if (ra !== rb) return ra - rb;
    return getName(a.file).localeCompare(getName(b.file));
  });

  // 推荐档:精确 Q4_K_M 优先;否则在已识别量化档里挑 rank 最接近 4.2 的一档。
  const PREFERRED_RANK = quantRank(PREFERRED_QUANT); // 4.2
  let recIdx = annotated.findIndex((a) => a.info.quant === PREFERRED_QUANT);
  if (recIdx < 0) {
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    annotated.forEach((a, i) => {
      if (!a.info.quant) return;
      const dist = Math.abs(quantRank(a.info.quant) - PREFERRED_RANK);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    recIdx = best;
  }
  const rec = recIdx >= 0 ? annotated[recIdx] : undefined;
  if (rec) {
    rec.info = { ...rec.info, recommended: true };
  }

  return annotated;
}
