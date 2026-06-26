"""按文件 RAPTOR 层次摘要(Tier 3:海量文档)。

对单个文件的全部 chunk 文本做"嵌入→语义聚类→逐簇归纳→递归→根摘要"。
与整库 RAPTOR(file_rag/raptor/builder.build_raptor_for_kb)的区别:
  - 粒度=单文件(只喂该文件 chunk),不跨库;
  - 纯内存,只返回根摘要文本,**不写回 KB 检索向量库**(避免污染检索);
  - embed/cluster/summarize 三类能力全部注入式 → 无 langchain/sklearn 依赖,可单测。

极限摘要本身有损(海量文档→一段摘要),逐簇按上界截断成员是可接受的取舍。
"""
from __future__ import annotations

from typing import Callable, List, Optional, Tuple

# 单簇拼接的成员上界(对齐整库 RAPTOR builder 的经验值,防单次 prompt 过大)
_MEMBER_CHAR_CAP = 1500
_MEMBERS_PER_CLUSTER_CAP = 12


def summarize_file_hierarchical(
    texts: List[str],
    *,
    embed_fn: Callable[[List[str]], List],
    cluster_fn: Callable[..., Tuple[List[int], int]],
    summarize_fn: Callable[[str], str],
    target_cluster_size: int = 5,
    max_levels: int = 3,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> str:
    """对单文件全部 chunk 文本做层次聚类摘要,返回整篇(根)摘要。

    - ``embed_fn(texts) -> vectors``:把一组文本向量化。
    - ``cluster_fn(vectors, target_cluster_size=...) -> (labels, n_clusters)``:语义软聚类。
    - ``summarize_fn(joined_text) -> summary``:对一段拼接文本归纳。
    - ``progress_cb(done, total)``:每完成一次簇摘要回调(done 累计调用数,total 粗估)。
    空输入返回 ""。单条直接摘要。"""
    current = [t for t in (texts or []) if t and t.strip()]
    if not current:
        return ""
    if len(current) == 1:
        return (summarize_fn(current[0]) or "").strip()

    done = 0
    total_est = len(current)  # 粗估:最坏每条一次,够前端进度条用

    for _level in range(1, int(max_levels) + 1):
        vectors = embed_fn(current)
        labels, n_clusters = cluster_fn(vectors, target_cluster_size=int(target_cluster_size))
        if n_clusters <= 1 or len(current) <= int(target_cluster_size):
            break  # 收敛 → 走最终 reduce
        next_level: List[str] = []
        for cid in sorted(set(labels)):
            members = [current[i] for i, lb in enumerate(labels) if lb == cid]
            if not members:
                continue
            joined = "\n\n".join(
                (m or "")[:_MEMBER_CHAR_CAP] for m in members[:_MEMBERS_PER_CLUSTER_CAP]
            )
            s = (summarize_fn(joined) or "").strip()
            done += 1
            if progress_cb:
                progress_cb(done, total_est)
            if s:
                next_level.append(s)
        if not next_level:
            break
        current = next_level
        if len(current) == 1:
            return current[0]

    if len(current) == 1:
        return current[0]
    joined = "\n\n".join(current)
    root = (summarize_fn(joined) or "").strip()
    done += 1
    if progress_cb:
        progress_cb(done, total_est)
    return root
