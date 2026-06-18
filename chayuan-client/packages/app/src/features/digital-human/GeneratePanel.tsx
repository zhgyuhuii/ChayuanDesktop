import * as React from 'react';
import { copyText } from '@chayuan/platform-shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, Play, Square } from 'lucide-react';
import { digitalHuman, models, knowledgeUniverse, videoGeneration, vgBgmFileUrl } from '@chayuan/api';
import type { DigitalHumanPreset, RawModelItem, KuItem, DhScriptSource, ProductLayer, VgBgmItem } from '@chayuan/api';
import type { ModalityCapability } from '@chayuan/transport';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Dialog, DialogContent, DialogTitle } from '@chayuan/ui';
import { reportError, notifySuccess, notifyInfo } from '../../store/errorDialog';
import { isSingleMachineMode } from '../first-run/useSingleMachineMode';
import { promptDialog } from '../../store/promptDialog';
import { confirmDialog } from '../../store/confirmDialog';
import { useUsageGate, UsageGateDialogs } from '../license';
import { ModelMenuList, displayLabel } from '../composer/ModelMenuList';
import { CHAT_CAPABILITIES, inferCapability } from '../composer/modelCapabilityChip';
import { useResolveLogo } from '../catalog/useLogos';
import { KnowledgePickerPill } from '../composer/KnowledgePickerPill';
import { KbResultsView } from '../kb/components/KbResultsView';
import { DhProgressCard } from './DhProgressCard';
import { BindingHint, bindingStateOf, normKuIds, dhSourcesToRetrieval } from './dhBinding';
import { estimateDurationMs, fmtSec } from './estimateDuration';
import {
  effectiveModel,
  effectiveKuIds,
  showModelPicker,
  showKbPicker,
} from './usePresetBinding';

type EngineId = 'wav2lip' | 'sadtalker' | 'musetalk';

const DEFAULT_ENGINES: Array<{ id: EngineId; label: string; kind: 'cpu' | 'gpu'; installed: boolean }> = [
  { id: 'wav2lip', label: 'Wav2Lip', kind: 'cpu', installed: true },
];

/** 脚本模型存为 `platform_name::id`(无 platform 退化成裸 id),与后端路由一致。 */
function encodeModel(m: RawModelItem): string {
  return m.platform_name ? `${m.platform_name}::${m.id}` : m.id;
}
function decodeModel(v: string | null): { platform?: string; id: string } {
  if (!v) return { id: '' };
  const i = v.indexOf('::');
  return i >= 0 ? { platform: v.slice(0, i), id: v.slice(i + 2) } : { id: v };
}

/** 按中文/英文句末标点和换行切句,去掉空白片段(标点保留在句尾)。 */
function splitSentences(s: string): string[] {
  return (s || '')
    .split(/(?<=[。！？!?\n])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 与后端 _split_string_by_punctuations 对齐:按中英文标点切句(标点不保留),
    用于「播放顺序预览」让所见即所得。coframe 后端按此切句再交织。 */
function splitByPunct(s: string): string[] {
  if (!s) return [];
  return s
    .split(/[?,.、;:!…？，。；：！]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export type PreviewItem = { roleName: string; text: string };
/** 算最终播放顺序(只读预览):
    - coframe:各角色框各自按句切分,再按句序在角色间交织(甲1,乙1,甲2,乙2,…),与后端 plan 一致。
    - sequential:已拼的段序(按段轮流,跳过空段),与 doGen role_segments 顺序一致。 */
export function previewOrder(
  mode: string,
  coframeScripts: string[],
  seqSegments: string[][],
  roleNames: string[],
): PreviewItem[] {
  const out: PreviewItem[] = [];
  const nm = (i: number) => roleNames[i] || ('角色' + (i + 1));
  if (mode === 'coframe') {
    const per = roleNames.map((_, i) => splitByPunct(coframeScripts[i] ?? ''));
    const maxk = per.reduce((m, p) => Math.max(m, p.length), 0);
    for (let k = 0; k < maxk; k++) {
      for (let i = 0; i < per.length; i++) {
        const seg = per[i]?.[k];
        if (seg !== undefined) out.push({ roleName: nm(i), text: seg });
      }
    }
  } else if (mode === 'sequential') {
    const maxLen = seqSegments.reduce((m, a) => Math.max(m, a.length), 0);
    for (let k = 0; k < maxLen; k++) {
      for (let i = 0; i < seqSegments.length; i++) {
        const t = (seqSegments[i]?.[k] ?? '').trim();
        if (t) out.push({ roleName: nm(i), text: t });
      }
    }
  }
  return out;
}

export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[]; initialPresetId?: string; onPresetChange?: (pid: string) => void; embedded?: boolean; onPublished?: () => void; onBeforeGenerate?: () => Promise<void> | void; onGenerated?: (taskId: string) => void; selectedProductRef?: string | null; onSelectProduct?: (ref: string | null) => void }> = ({ presets, initialPresetId, onPresetChange, embedded, onPublished, onBeforeGenerate, onGenerated, selectedProductRef, onSelectProduct }) => {
  const [pid, setPid] = React.useState(initialPresetId ?? '');
  const qc = useQueryClient();
  const [text, setText] = React.useState('');
  // coframe(#6):每角色一串文案,index 对应角色
  const [coframeScripts, setCoframeScripts] = React.useState<string[]>([]);
  // sequential(#7):外层 index=角色,内层=该角色的多个段
  const [seqSegments, setSeqSegments] = React.useState<string[][]>([]);
  // 多角色 AI 生成产出的有序对话(role_index 标定说话角色,顺序即对话顺序);
  // 非空时多角色生成统一以此为真源提交(coframe/sequential 都发 role_segments)。
  const [roleSegments, setRoleSegments] = React.useState<Array<{ role_index: number; text: string }>>([]);
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // engine state
  const [engine, setEngine] = React.useState<EngineId>('wav2lip');

  // 多商品图层(可上传多个图/视频);从 preset.products 同步,上传追加。
  const [products, setProducts] = React.useState<ProductLayer[]>([]);
  // VLM 文案/兼容生成用的主商品:优先首个图片,否则第一个。
  const primaryProductRef = products.find((p) => p.kind === 'image')?.ref ?? products[0]?.ref ?? null;
  const [uploadingProduct, setUploadingProduct] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // 商品搜索 + 添加/编辑模态(图/名/价/链接/简介全部可空)
  const [productSearch, setProductSearch] = React.useState('');
  const [pmOpen, setPmOpen] = React.useState(false);
  const [pmUploading, setPmUploading] = React.useState(false);
  const pmFileRef = React.useRef<HTMLInputElement>(null);
  const [pmDraft, setPmDraft] = React.useState<{ ref?: string; kind?: 'image' | 'video'; title: string; price: string; link: string; desc: string; previewUrl?: string }>(
    { title: '', price: '', link: '', desc: '' });

  // 文案生成模型选择(挂商品图时收窄到 VLM)
  const [scriptModel, setScriptModel] = React.useState<string | null>(null);
  // 文案生成知识库选择(受控);选预设时预填预设 ku_ids
  const [scriptKuIds, setScriptKuIds] = React.useState<string[]>([]);
  // 文案「依据来源」——AI 生成 / 参考视频后从后端 sources 填充
  const [scriptSources, setScriptSources] = React.useState<DhScriptSource[]>([]);
  // 选了知识库但本次未命中(kb_used===false)
  const [kbMissed, setKbMissed] = React.useState(false);
  const [pickOpen, setPickOpen] = React.useState(false);
  const resolveLogo = useResolveLogo();
  const modelsQ = useQuery({
    queryKey: ['v1.models'],
    queryFn: () => models.list(),
    staleTime: 5 * 60 * 1000,
  });
  // 失效绑定检测用:列当前可用知识库
  const kbsQ = useQuery({
    queryKey: ['v1.knowledgeUniverse.list'],
    queryFn: () => knowledgeUniverse.list(),
    staleTime: 5 * 60 * 1000,
  });


  // matte (green-screen keying) — only relevant when productRef is set
  const [matte, setMatte] = React.useState(false);
  // 抠图相似度:越大抠越狠(背景去得干净但易伤形象),越小越保守(留更多)。默认 0.15;0=后端按背景自适应。
  const [matteSim, setMatteSim] = React.useState(0.15);
  // 速度档:静态形象生成帧率。25=标准,18=快速,12=极速(降 fps=减帧=等比提速,时长不变、口型刷新率略降)。
  const [genFps, setGenFps] = React.useState<number>(25);
  // 背景音乐(复用 VG 内置 29 首 + 用户上传):none=无 / random=随机 / file=指定。混进成片旁白下。
  const [bgmType, setBgmType] = React.useState<'none' | 'random' | 'file'>('none');
  const [bgmFile, setBgmFile] = React.useState('');
  const [bgmVolume, setBgmVolume] = React.useState(0.2);
  const bgmQ = useQuery({ queryKey: ['vg.bgm'], queryFn: () => videoGeneration.listBgm(), staleTime: 5 * 60 * 1000 });
  const bgmItems: VgBgmItem[] = bgmQ.data?.items ?? [];
  const [bgmPlaying, setBgmPlaying] = React.useState(false);
  const bgmAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const bgmFileRef = React.useRef<HTMLInputElement | null>(null);
  const [bgmUploading, setBgmUploading] = React.useState(false);
  const handleBgmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBgmUploading(true);
    try {
      const r = await videoGeneration.uploadBgm(file);
      await qc.invalidateQueries({ queryKey: ['vg.bgm'] });
      setBgmType('file');
      setBgmFile(r.path);   // 选中刚上传的
    } catch (err) {
      reportError(err as Error, '背景音乐上传失败');
    } finally {
      setBgmUploading(false);
    }
  };

  // 按次门控（avatar: 数字人合成）
  const gate = useUsageGate('avatar');

  const navigate = useNavigate();
  const [scripting, setScripting] = React.useState(false);
  // 分段轮流:按「段」(key=`角色:段`)记录谁在生成 → 只禁用正在生成的那一段,其余段可点、可并行。
  const [scriptingSegs, setScriptingSegs] = React.useState<Set<string>>(new Set());
  const setSegBusy = (key: string, busy: boolean) => setScriptingSegs((prev) => {
    const n = new Set(prev);
    if (busy) n.add(key); else n.delete(key);
    return n;
  });
  const refVideoRef = React.useRef<HTMLInputElement>(null);
  // AI 生成/参考视频得到整篇文案后,按当前合成模式分发:
  // single 写全局 text;coframe 把整篇按句切分后【均分成 N 段连续块】,角色 i 拿第 i 段连贯段落
  //   (后端 plan 仍按句交织作单一真源,角色框是连贯段落使交织结果可预期 / 所见即所得);
  // sequential 仍按段序轮流进各角色段(分段轮流本就交替)。
  // 覆盖前若各角色框已有非空内容,先确认,避免冲掉用户手改。
  const distributeScript = async (script: string) => {
    setText(script);
    if (roleCount <= 0) return;
    // sequential 仍按角色分段;single / coframe 都用单一文案框(text),coframe 由后端按句轮流分给各角色。
    if (mode === 'sequential') {
      const hasManual = seqSegments.some((segs) => segs.some((t) => (t ?? '').trim()));
      if (hasManual) {
        const ok = await confirmDialog('AI 生成将覆盖各角色框已填内容,继续?');
        if (!ok) return;
      }
      const sents = splitSentences(script);
      const next = Array.from({ length: roleCount }, (_, i) => {
        const mine = sents.filter((_, k) => k % roleCount === i);
        return mine.length ? mine : [''];
      });
      setSeqSegments(next);
    }
    setRoleSegments([]);
  };
  // 多角色 AI 生成产出的有序 role_segments 回填到现有承载多角色台词的状态:
  // coframe -> 每角色一段(同角色多段按出现顺序拼接);
  // sequential -> 每角色按出现顺序收集为多段。两种模式都额外把原始有序段存 roleSegments,
  // 提交时直接发它(保留 AI 编排的交错顺序)。
  // 把某角色文稿写回承载状态(coframe=该角色一段;sequential=替换为单段)。
  const setRoleScript = (i: number, text: string) => {
    setRoleSegments([]);
    if (mode === 'sequential') {
      setSeqSegments((prev) => prev.map((segs, ri) => (ri === i ? [text] : segs)));
    } else {
      setCoframeScripts((prev) => { const n = [...prev]; n[i] = text; return n; });
    }
  };
  // 写某角色第 k 段台词(分段轮流每段独立 AI 生成/参考视频用)。
  const setSegText = (i: number, k: number, text: string) => {
    setRoleSegments([]);
    setSeqSegments((prev) => prev.map((segs, ri) => (ri === i ? segs.map((sv, sk) => (sk === k ? text : sv)) : segs)));
  };
  // 把角色名 + 人设揉进 subject,让单篇生成贴合该角色。
  const roleSubject = (i: number, subject: string) => {
    const r = roles[i];
    const nm = r?.name || ('角色' + (i + 1));
    const pa = r?.persona ? `(人设:${r.persona})` : '';
    return `为${nm}${pa}写一段口播台词。主题:${subject}`;
  };
  // 单个角色 AI 生成台词(多角色每框各自生成,取代旧的整篇交错生成)。
  const onAiScriptSeg = async (i: number, k: number) => {
    const subject = await promptDialog(`给「${roles[i]?.name || ('角色' + (i + 1))}」第 ${k + 1} 段 AI 生成台词的主题:`);
    if (!subject || !subject.trim()) return;
    const key = `${i}:${k}`;
    setSegBusy(key, true);
    try {
      const preset = presets.find((p) => p.id === pid);
      const r = await digitalHuman.generateScript(roleSubject(i, subject.trim()), {
        model: effectiveModel(preset, scriptModel ?? '') || undefined,
        productRef: primaryProductRef ?? undefined,
        kuIds: effectiveKuIds(preset, scriptKuIds),
      });
      setScriptSources(r.sources ?? []);
      setKbMissed(effectiveKuIds(preset, scriptKuIds).length > 0 && r.kb_used === false);
      if (r.script) setSegText(i, k, r.script);
    } catch (e) { reportError(e as Error, 'AI 生成台词失败'); }
    finally { setSegBusy(key, false); }
  };
  // 参考视频生成某段台词:记下目标段 {i,k},复用统一隐藏 file input(onRefVideo 按 pendingSeg 路由)。
  const pendingSegRef = React.useRef<{ i: number; k: number } | null>(null);
  const onRefVideoSeg = (i: number, k: number) => { pendingSegRef.current = { i, k }; refVideoRef.current?.click(); };

  // 单形象 AI 生成口播文案(多角色改为每角色各自生成,见 onAiScriptRole)。
  const onAiScript = async () => {
    const subject = await promptDialog('输入主题,AI 生成口播文案:');
    if (!subject || !subject.trim()) return;
    setScripting(true);
    try {
      const preset = presets.find((p) => p.id === pid);
      const r = await digitalHuman.generateScript(subject.trim(), {
        model: effectiveModel(preset, scriptModel ?? '') || undefined,
        productRef: primaryProductRef ?? undefined,
        kuIds: effectiveKuIds(preset, scriptKuIds),
      });
      setScriptSources(r.sources ?? []);
      setKbMissed(effectiveKuIds(preset, scriptKuIds).length > 0 && r.kb_used === false);
      if (r.script) await distributeScript(r.script);
    } catch (e) {
      reportError(
        e as Error,
        'AI 生成文案失败:请在上方选择一个对话模型,或去模型广场安装',
      );
    } finally { setScripting(false); }
  };
  const onRefVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    const seg = pendingSegRef.current; pendingSegRef.current = null;  // 段路由(null=单形象整篇)
    if (!f) return;
    const segKey = seg ? `${seg.i}:${seg.k}` : null;
    if (segKey) setSegBusy(segKey, true); else setScripting(true);
    try {
      const preset = presets.find((p) => p.id === pid);
      const r = await digitalHuman.scriptFromVideo(f, {
        model: effectiveModel(preset, scriptModel ?? '') || undefined,
        kuIds: effectiveKuIds(preset, scriptKuIds),
      });
      setScriptSources(r.sources ?? []);
      setKbMissed(effectiveKuIds(preset, scriptKuIds).length > 0 && r.kb_used === false);
      if (r.script) {
        if (seg) setSegText(seg.i, seg.k, r.script);
        else await distributeScript(r.script);
      }
    } catch (err) { reportError(err as Error, '参考视频生成文案失败'); }
    finally { if (segKey) setSegBusy(segKey, false); else setScripting(false); }
  };

  const enginesQ = useQuery({ queryKey: ['dh.engines'], queryFn: digitalHuman.listEngines });
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: digitalHuman.listTasks, refetchInterval: 3000 });
  const recentTasks = (tasksQ.data?.items ?? []).filter((t) => t.task_id !== taskId).slice(-8).reverse();
  const engines = enginesQ.data?.items ?? DEFAULT_ENGINES;

  const engineInstalled = engines.find((e) => e.id === engine)?.installed ?? (engine === 'wav2lip');

  const curPreset = presets.find((p) => p.id === pid);
  const mode = curPreset?.compose_mode ?? 'single';
  const roles = curPreset?.avatars ?? [];

  // 发布在线数字人:把当前 preset 快照发布,复制公开链接,切到「在线数字人」tab。
  const [publishing, setPublishing] = React.useState(false);
  const doPublish = async () => {
    if (!curPreset || publishing) return;
    // 单机版:在线数字人依赖服务端,发布不可用 → 提示并中止(与在线 tab 占位口径一致)
    if (isSingleMachineMode()) {
      notifyInfo('在线数字人仅在线版可用', '当前为免费单机版,发布在线数字人需切换到察元 AI 在线版 / 私有化部署版');
      return;
    }
    const pubName = await promptDialog('给这个在线数字人起个名称:', { defaultValue: curPreset.name || '' });
    if (pubName === null) return;   // 取消则不发布
    setPublishing(true);
    try {
      // 把工作台当前脚本存成 preset.idle_script → 在线页无人提问时循环播报这段(语音+口型)。
      // 仅当前有脚本且 preset 还没设过循环脚本时写,避免覆盖用户在「数字人设置」里专门配的。
      const loopScript = (text || '').trim();
      if (loopScript && !((curPreset.idle_script || '').trim())) {
        try { await digitalHuman.updatePreset(curPreset.id, { idle_script: loopScript }); } catch { /* 不致命 */ }
      }
      // new=true:每次发布新建一条 → 一个数字人可发布多个在线数字人(各自独立链接)。
      const rec = await digitalHuman.publish(curPreset.id, { new: true, name: pubName.trim() });
      try { await copyText(rec.url); } catch { /* 复制失败不致命 */ }
      notifySuccess('已发布在线数字人', `公开链接已复制:${rec.url}`);
      onPublished?.();
    } catch (e) {
      reportError(e as Error, '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  React.useEffect(() => { if (!pid && presets[0]) setPid(presets[0].id); }, [presets, pid]);
  React.useEffect(() => { if (pid) onPresetChange?.(pid); }, [pid, onPresetChange]);

  // 选/切预设时,用预设绑定预填文案生成模型与知识库
  React.useEffect(() => {
    const p = presets.find((x) => x.id === pid);
    setScriptModel(p?.model ?? null);
    setScriptKuIds(p?.ku_ids ?? []);
    setScriptSources([]);
    setKbMissed(false);
    setRoleSegments([]);
    // 仅在预设切换时预填,避免覆盖用户手动改动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // 商品列表从预设同步:否则左侧空态、右侧画布按 preset 显示残留 → 左右不一致。
  // 优先 preset.products(多商品);旧 preset 只有 product_ref 时迁移成一条。
  React.useEffect(() => {
    const p = presets.find((x) => x.id === pid);
    if (p?.products?.length) {
      setProducts(p.products);
    } else if (p?.product_ref) {
      setProducts([{ ref: p.product_ref, kind: p.product_kind === 'video' ? 'video' : 'image',
        x: p.product_x ?? 0.66, y: p.product_y ?? 0.6, scale: p.product_scale ?? 0.32,
        z: p.product_z, opacity: p.product_opacity }]);
    } else {
      setProducts([]);
    }
  }, [pid, presets]);

  const persistProducts = (arr: ProductLayer[]) => {
    setProducts(arr);
    if (pid) void digitalHuman.updatePreset(pid, { products: arr })
      .then(() => qc.invalidateQueries({ queryKey: ['dh.presets'] }));
  };

  // 角色数变化时对齐多角色脚本状态长度(coframe / sequential)
  const roleCount = roles.length;
  React.useEffect(() => {
    setCoframeScripts((prev) => {
      if (prev.length === roleCount) return prev;
      const next = prev.slice(0, roleCount);
      while (next.length < roleCount) next.push('');
      return next;
    });
    setSeqSegments((prev) => {
      if (prev.length === roleCount) return prev;
      const next = prev.slice(0, roleCount);
      while (next.length < roleCount) next.push(['']);
      return next;
    });
  }, [roleCount]);

  const handleProductFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';  // 允许再次选同一文件
    setUploadingProduct(true);
    try {
      const r = await digitalHuman.uploadProduct(file);
      // 追加到商品列表;各自略微错位避免完全重叠,用户可再拖拽。
      const n = products.length;
      const next: ProductLayer[] = [...products, {
        ref: r.ref, kind: r.kind === 'video' ? 'video' : 'image',
        x: Math.min(0.85, 0.6 + (n % 3) * 0.08), y: Math.min(0.8, 0.5 + (n % 3) * 0.08), scale: 0.32,
      }];
      persistProducts(next);
    } catch (err) {
      reportError(err as Error, '商品上传失败');
    } finally {
      setUploadingProduct(false);
    }
  };

  const removeProduct = (ref: string) => {
    const next = products.filter((p) => p.ref !== ref);
    if (!next.length) setMatte(false);
    persistProducts(next);
  };

  // 商品模态:新增 / 编辑 / 模态内上传 / 保存(全部字段可空,可不上传图)
  const openAddProduct = () => { setPmDraft({ title: '', price: '', link: '', desc: '' }); setPmOpen(true); };
  const openEditProduct = (p: ProductLayer) => {
    setPmDraft({ ref: p.ref, kind: p.kind, title: p.title ?? '', price: p.price ?? '', link: p.link ?? '', desc: p.desc ?? '',
      previewUrl: p.ref.startsWith('product:') ? digitalHuman.productFileUrl(p.ref) : undefined });
    setPmOpen(true);
  };
  const onPmFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    setPmUploading(true);
    try {
      const r = await digitalHuman.uploadProduct(file);
      setPmDraft((d) => ({ ...d, ref: r.ref, kind: r.kind === 'video' ? 'video' : 'image', previewUrl: digitalHuman.productFileUrl(r.ref) }));
    } catch (err) { reportError(err as Error, '商品上传失败'); }
    finally { setPmUploading(false); }
  };
  const saveProduct = () => {
    const d = pmDraft;
    const isEdit = !!d.ref && products.some((q) => q.ref === d.ref);
    // 无图也给个稳定 key(noimg:),后端/画布据前缀判断「无图、仅橱窗展示」
    const ref = d.ref || ('noimg:' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36));
    const fields = {
      kind: (d.kind === 'video' ? 'video' : 'image') as 'image' | 'video',
      title: d.title.trim() || undefined, price: d.price.trim() || undefined,
      link: d.link.trim() || undefined, desc: d.desc.trim() || undefined,
    };
    let next: ProductLayer[];
    if (isEdit) next = products.map((q) => (q.ref === d.ref ? { ...q, ...fields } : q));
    else { const n = products.length; next = [...products, { ref, ...fields, x: Math.min(0.85, 0.6 + (n % 3) * 0.08), y: Math.min(0.8, 0.5 + (n % 3) * 0.08), scale: 0.32 }]; }
    persistProducts(next); setPmOpen(false);
  };
  const sq = productSearch.trim().toLowerCase();
  const filteredProducts = sq
    ? products.filter((p) => (p.title || '').toLowerCase().includes(sq) || p.ref.toLowerCase().includes(sq))
    : products;

  // 实际生成逻辑（门控通过后执行）
  const doGen = async (vidName = '') => {
    setBusy(true);
    try {
      // 先把拖拽中待写的形象/商品位置/缩放/层级落库(等服务端写完),否则「拖完马上点生成」时
      // 防抖还没落库 → 后端读旧 preset.products → 商品跑右下角默认大小。
      try { await onBeforeGenerate?.(); } catch { /* 落库失败不阻断生成 */ }
      let modeFields: {
        script?: string;
        role_scripts?: string[];
        role_segments?: Array<{ role_index: number; text: string }>;
      };
      // effectiveText:发给后端的全局 text(过 max_length 校验 + 派生字幕/时间轴)。
      // 多角色模式 text 全局为空,这里按模式拼出有效文案。
      let effectiveText: string;
      if (mode !== 'single' && roleSegments.length > 0) {
        // 多角色 AI 生成产出的有序对话作真源,直接发 role_segments(保留交错顺序)。
        modeFields = { role_segments: roleSegments };
        effectiveText = roleSegments.map((s) => s.text).join('\n');
      } else if (mode === 'coframe') {
        // 单输入框:整段发 script,后端按句轮流分给各角色(句0→角色0,句1→角色1,…)。
        modeFields = { script: text };
        effectiveText = text;
      } else if (mode === 'sequential') {
        const maxLen = Math.max(0, ...seqSegments.map((a) => a.length));
        const segs: { role_index: number; text: string }[] = [];
        for (let k = 0; k < maxLen; k++) {
          for (let i = 0; i < seqSegments.length; i++) {
            const t = (seqSegments[i]?.[k] ?? '').trim();
            if (t) segs.push({ role_index: i, text: t });
          }
        }
        modeFields = { role_segments: segs };
        effectiveText = segs.map((s) => s.text).join('\n');
      } else {
        modeFields = { script: text };
        effectiveText = text;
      }
      const opts = {
        engine,
        ...(vidName.trim() ? { name: vidName.trim() } : {}),   // 用户给这条视频起的名字
        script_model: effectiveModel(curPreset, scriptModel ?? '') || undefined,
        ...(genFps && genFps < 25 ? { fps: genFps } : {}),  // 速度档:<25 才传(默认 25 不传)
        ...(bgmType !== 'none' ? { bgm_type: bgmType, bgm_file: bgmFile, bgm_volume: bgmVolume } : {}),
        ...(primaryProductRef ? { product_image: primaryProductRef, matte, ...(matte ? { matte_sim: matteSim } : {}) } : {}),
        ...modeFields,
      };
      const r = await digitalHuman.generate(pid, effectiveText, opts);
      setTaskId(r.task_id);
      onGenerated?.(r.task_id);   // 切到「数字人视频」tab 看这个正在执行的任务
    } catch (e) { reportError(e as Error, '数字人生成失败'); }
    finally { setBusy(false); }
  };

  // 带门控的生成入口
  const gen = async () => {
    // 生成前先填视频名称(放在 license 门控前,取消不浪费额度)。
    const vidName = await promptDialog('给这个视频起个名字:', { defaultValue: '' });
    if (vidName === null) return;   // 取消则不生成
    gate.guard(() => doGen(vidName));
  };

  // ── 文案生成模型选择 ─────────────────────────────────────────
  // 文案=文本脚本,模型放开为「对话 + 视觉」(chat+vl),不因挂商品图收窄成 VLM-only、
  // 也不阻断生成。选视觉模型 → 看图带货;选普通对话模型 → 后端忽略图片纯文字生成。
  const hasImage = products.some((p) => p.kind === 'image');
  const allModels: RawModelItem[] = React.useMemo(
    () => (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm'),
    [modelsQ.data],
  );
  const capFilter: ReadonlySet<ModalityCapability> = CHAT_CAPABILITIES;
  const curModel = decodeModel(scriptModel);
  const currentModel = allModels.find(
    (m) => m.id === curModel.id && (curModel.platform ? m.platform_name === curModel.platform : true),
  );
  const currentModelLabel = currentModel
    ? displayLabel(currentModel)
    : (curModel.id || (modelsQ.isLoading ? '加载中…' : '默认模型'));

  // ── 绑定来源标签 + 失效检测 ───────────────────────────────────
  // 模型失效:预设绑了 model,但在可用模型列表里找不到(被卸载)。
  const modelInvalid = React.useMemo(() => {
    const pm = curPreset?.model;
    if (!pm || modelsQ.isLoading) return false;
    const d = decodeModel(pm);
    return !allModels.some(
      (m) => m.id === d.id && (d.platform ? m.platform_name === d.platform : true),
    );
  }, [curPreset?.model, allModels, modelsQ.isLoading]);
  // 知识库失效:预设绑的 ku_id 在可用列表里缺失(被删)。
  const kbList: KuItem[] = kbsQ.data ?? [];
  const missingKuIds = React.useMemo(() => {
    const bound = curPreset?.ku_ids ?? [];
    if (!bound.length || kbsQ.isLoading) return [];
    const avail = new Set(kbList.map((k) => k.ku_id));
    return bound.filter((id) => !avail.has(id));
  }, [curPreset?.ku_ids, kbList, kbsQ.isLoading]);
  const kbBindState = bindingStateOf(
    normKuIds(curPreset?.ku_ids), normKuIds(scriptKuIds), missingKuIds.length > 0,
  );
  const kbLabel = (() => {
    if (!scriptKuIds.length) return '';
    const names = scriptKuIds.map((id) => kbList.find((k) => k.ku_id === id)?.display_name || kbList.find((k) => k.ku_id === id)?.name || id);
    return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${names.length} 个`;
  })();
  const retrievalSources = React.useMemo(() => dhSourcesToRetrieval(scriptSources), [scriptSources]);

  // 播放顺序预览(只读):反映最终合成后片段播放顺序,让用户「所见即所得」。
  const roleNames = roles.map((r, i) => r.name || ('角色' + (i + 1)));
  const orderPreview = React.useMemo(
    () => {
      // 多角色 AI 生成产出的有序 role_segments 是「即将提交」的真源:预览与
      // 时长直接基于它(保留 AI 编排的交错顺序/分段),避免 coframe 把有序段
      // 折叠成每角色一框后再按句 round-robin 重切导致顺序/分段/每段时长全错。
      // roleSegments 为空(手写台词)时仍按各角色框 round-robin 预览。
      if (mode !== 'single' && roleSegments.length > 0) {
        return roleSegments.map((s) => ({
          roleName: roleNames[s.role_index] ?? ('角色' + (s.role_index + 1)),
          text: s.text,
        }));
      }
      // coframe 单输入框:整段按句轮流分给各角色(与后端 plan 一致)。
      if (mode === 'coframe') {
        const n = Math.max(1, roleNames.length);
        return splitByPunct(text).map((s, k) => ({
          roleName: roleNames[k % n] ?? ('角色' + ((k % n) + 1)),
          text: s,
        }));
      }
      return previewOrder(mode, coframeScripts, seqSegments, roleNames);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, text, roleSegments, coframeScripts, seqSegments, roleNames.join('\u0001')],
  );
  // 每角色语速(用于时长估算);roleName -> voice_rate。
  const rateByRole = React.useMemo(() => {
    const m: Record<string, number> = {};
    roles.forEach((r, i) => { m[r.name || ('角色' + (i + 1))] = r.voice_rate ?? 1; });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles]);
  // 对话脚本时长:每段估时 + 每角色累计 + 总时长。
  const durationStats = React.useMemo(() => {
    const perItem = orderPreview.map((it) => estimateDurationMs(it.text, rateByRole[it.roleName] ?? 1));
    const perRole: Record<string, number> = {};
    let total = 0;
    orderPreview.forEach((it, i) => {
      const ms = perItem[i] ?? 0;
      perRole[it.roleName] = (perRole[it.roleName] ?? 0) + ms;
      total += ms;
    });
    return { perItem, perRole, total };
  }, [orderPreview, rateByRole]);

  // ── 编辑脚本(字幕清单):三模式统一。单形象=按行/标点切句;多角色=orderPreview(roleSegments 真源)。
  // 点开弹窗逐句编辑 → 保存写回(单形象=text;多角色=roleSegments)→ 生成按编辑后的脚本走。
  const [scriptOpen, setScriptOpen] = React.useState(false);
  const [editCues, setEditCues] = React.useState<PreviewItem[]>([]);
  const singleCues = React.useMemo<PreviewItem[]>(() => {
    const parts = text.includes('\n') ? text.split('\n').map((s) => s.trim()).filter(Boolean) : splitByPunct(text);
    const rn = roleNames[0] || '台词';
    return parts.map((t) => ({ roleName: rn, text: t }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, roleNames.join('')]);
  const scriptCues = mode === 'single' ? singleCues : orderPreview;
  const openScriptEditor = () => { setEditCues(scriptCues.map((c) => ({ ...c }))); setScriptOpen(true); };
  const saveScriptEditor = () => {
    const valid = editCues.map((c) => ({ roleName: c.roleName, text: c.text.trim() })).filter((c) => c.text);
    if (mode === 'single') {
      setText(valid.map((c) => c.text).join('\n'));
    } else {
      setRoleSegments(valid.map((c) => ({ role_index: Math.max(0, roleNames.indexOf(c.roleName)), text: c.text })));
    }
    setScriptOpen(false);
  };

  // 各 mode 是否有可生成内容(coframe 改单输入框 → 看 text;sequential 仍看各角色段)
  const canGenerate =
    mode === 'sequential'
      ? seqSegments.some((segs) => segs.some((t) => t.trim()))
      : text.trim().length > 0;

  if (presets.length === 0)
    return <div className="text-sm text-[var(--cy-text-tertiary)]">先到「我的数字人」新建一个数字人。</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      {/* 按次门控弹层 */}
      <UsageGateDialogs app="avatar" gate={gate} />

      {/* 画质引擎 · 数字人 · 对话模型 · 知识库 — 一行 */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} title="画质引擎"
          className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]">
          {engines.map((e) => <option key={e.id} value={e.id}>{e.label}{!e.installed ? ' · 未安装' : ''}</option>)}
        </select>
        <select value={genFps} onChange={(e) => setGenFps(Number(e.target.value))}
          title="速度档:降帧率=减帧=生成更快(时长不变,口型刷新率略降)"
          className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]">
          <option value={25}>标准 25fps</option>
          <option value={18}>快速 18fps</option>
          <option value={12}>极速 12fps</option>
        </select>
        <select value={pid} onChange={(e) => setPid(e.target.value)} title="数字人"
          className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]">
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {showModelPicker(curPreset) && (
          <DropdownMenu open={pickOpen} onOpenChange={setPickOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button"
                className="inline-flex h-8 min-w-[8em] items-center gap-1.5 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
                title="文案生成模型(对话或视觉模型均可)">
                <span className="max-w-[140px] truncate">{currentModelLabel}</span>
                <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12} className="z-[260] w-80 overflow-hidden p-0">
              <ModelMenuList
                models={allModels}
                currentId={curModel.id}
                currentPlatform={curModel.platform}
                allowCapabilities={capFilter}
                resolveLogo={resolveLogo}
                emptyLabel={modelsQ.isLoading ? '加载中…' : '无可用模型'}
                emptyAction={(
                  <button type="button" onClick={() => { setPickOpen(false); void navigate({ to: '/model-gallery' as never }); }}
                    className="text-[var(--cy-brand-500)] hover:underline">去模型广场安装</button>
                )}
                onPick={(m) => { if (m.available === false) return; setScriptModel(encodeModel(m)); setPickOpen(false); }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {showKbPicker(curPreset) && (
          <KnowledgePickerPill side="bottom" align="start" value={scriptKuIds} onChange={setScriptKuIds} />
        )}
        {showKbPicker(curPreset) && (curPreset?.ku_ids?.length || missingKuIds.length > 0) ? (
          <BindingHint state={kbBindState} label={kbLabel} noun="知识库" />
        ) : null}
      </div>
      {!engineInstalled && (
        <div className="text-sm text-[var(--cy-text-secondary)]">
          该 GPU 引擎随完整版自带、装好即用;若显示未就绪,请运行
          <code className="mx-1 rounded bg-[var(--cy-surface-2)] px-1 text-xs">python scripts/install-bundled-models.py</code>
          勾选「数字人」安装后重启。
        </div>
      )}

      {/* 全局文案框仅 single 模式显示。coframe/sequential 下用户敲的字不进 body
          (多角色发 role_scripts/role_segments),显示可编辑会误导,故隐藏;两个
          生成按钮的产物经 distributeScript 分发到各角色框。 */}
      {(mode === 'single' || mode === 'coframe') && (
        <div className="flex flex-col gap-1">
          {mode === 'coframe' && (
            <span className="text-[11px] text-[var(--cy-text-tertiary)]">同框:整段文案按句轮流分配给各角色(句1→角色1,句2→角色2,…循环)</span>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
            placeholder={mode === 'coframe' ? '输入整段对话文案,系统按句轮流分给各角色…' : '输入口播文案…'}
            className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)]" />
        </div>
      )}
      {/* 单形象/同框:整篇 AI 生成 / 参考视频生成稿(同框由后端按句分配)。 */}
      {(mode === 'single' || mode === 'coframe') && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={onAiScript} disabled={scripting}
            className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            {scripting ? '生成中…' : '✨ AI 生成文案'}
          </button>
          <button type="button" onClick={() => refVideoRef.current?.click()} disabled={scripting}
            className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            🎬 参考视频生成稿
          </button>
          <button type="button" onClick={openScriptEditor} disabled={scriptCues.length === 0}
            title={scriptCues.length === 0 ? '先生成或输入脚本' : '逐句编辑字幕清单'}
            className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            📝 编辑脚本{scriptCues.length > 0 ? `(${scriptCues.length})` : ''}
          </button>
        </div>
      )}
      {/* 隐藏 file input:单形象整篇 & 每角色参考视频共用,onRefVideo 按 pendingRole 路由。 */}
      <input ref={refVideoRef} type="file" accept="video/*,audio/*" className="hidden" onChange={onRefVideo} />
      {/* 失效绑定明确提示(模型被卸 / 知识库被删) */}
      {(modelInvalid || missingKuIds.length > 0) && (
        <div className="text-xs text-[var(--cy-danger-500)]">
          ⚠ 预设绑定的{[modelInvalid ? '模型' : '', missingKuIds.length > 0 ? '知识库' : ''].filter(Boolean).join(' / ')}已失效(被卸载或删除),请到「我的数字人」重新绑定。
        </div>
      )}
      {/* 文案「依据来源」——优先复用统一来源展示组件 KbResultsView */}
      {retrievalSources.length > 0 && (
        <KbResultsView sources={retrievalSources} title="依据来源" />
      )}
      {kbMissed && retrievalSources.length === 0 && (
        <div className="text-xs text-[var(--cy-text-tertiary)]">本次未命中知识库内容,文案由模型自由生成。</div>
      )}
      {hasImage && currentModel && inferCapability(currentModel) !== 'vl' && (
        <div className="text-xs text-[var(--cy-text-tertiary)]">
          当前为对话模型,不识别图片 —— 将忽略商品图,仅用文字生成文案。需看图带货请选视觉(VLM)模型。
        </div>
      )}


      {mode === 'sequential' && roles.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-[var(--cy-text-tertiary)]">分段台词(每角色可加多段,按段序在角色间轮流播放)</div>
          {roles.map((r, i) => (
            <div key={r.ref} className="flex flex-col gap-1 rounded-md border border-[var(--cy-border-subtle)] p-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[var(--cy-text-secondary)]">{r.name || ('角色' + (i + 1))}</div>
                <button type="button"
                  onClick={() => setSeqSegments((prev) => prev.map((segs, ri) => (ri === i ? [...segs, ''] : segs)))}
                  className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-0.5 text-xs text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)]">
                  + 添加一段
                </button>
              </div>
              {(seqSegments[i] ?? ['']).map((seg, k) => {
                const segKey = `${i}:${k}`;
                const segBusy = scriptingSegs.has(segKey);
                return (
                <div key={k} className="flex flex-col gap-1 rounded-md border border-[var(--cy-border-subtle)] p-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--cy-text-tertiary)]">第 {k + 1} 段</span>
                    {/* 每段独立:AI 生成 / 参考视频(只禁用本段,其他段可点、可并行) */}
                    <button type="button" onClick={() => void onAiScriptSeg(i, k)} disabled={segBusy}
                      className="rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
                      {segBusy ? '生成中…' : '✨ AI 生成'}
                    </button>
                    <button type="button" onClick={() => onRefVideoSeg(i, k)} disabled={segBusy}
                      className="rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
                      🎬 参考视频
                    </button>
                    {(seqSegments[i]?.length ?? 0) > 1 && (
                      <button type="button"
                        onClick={() => setSeqSegments((prev) => prev.map((segs, ri) => (
                          ri === i ? segs.filter((_, sk) => sk !== k) : segs
                        )))}
                        className="ml-auto rounded-md border border-[var(--cy-border-subtle)] px-2 py-0.5 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                        删
                      </button>
                    )}
                  </div>
                  <textarea value={seg} rows={2}
                    onChange={(e) => { setRoleSegments([]); setSeqSegments((prev) => prev.map((segs, ri) => (
                      ri === i ? segs.map((sv, sk) => (sk === k ? e.target.value : sv)) : segs
                    ))); }}
                    placeholder={`第 ${k + 1} 段台词`}
                    className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:outline-none" />
                </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* sequential: edit-script (subtitle list) button, unified with single/coframe */}
      {mode === 'sequential' && roles.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={openScriptEditor} disabled={scriptCues.length === 0}
            title={scriptCues.length === 0 ? '先填写或生成各角色台词' : '逐句编辑字幕清单'}
            className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            📝 编辑脚本{scriptCues.length > 0 ? `(${scriptCues.length})` : ''}
          </button>
          {scriptCues.length > 0 && (
            <span className="text-[var(--cy-text-tertiary)]">总时长 {fmtSec(durationStats.total)}</span>
          )}
        </div>
      )}

      {/* 背景音乐:复用 VG 内置 + 上传;无/随机/指定 + 音量。混进成片旁白下方。 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--cy-text-secondary)]">背景音乐</span>
        <select value={bgmType} onChange={(e) => setBgmType(e.target.value as 'none' | 'random' | 'file')}
          className="h-7 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 text-xs text-[var(--cy-text-primary)]">
          <option value="none">无</option>
          <option value="random">随机</option>
          <option value="file">指定</option>
        </select>
        {bgmType === 'file' && (
          <select value={bgmFile} onChange={(e) => setBgmFile(e.target.value)}
            className="h-7 min-w-[10rem] max-w-[16rem] rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 text-xs text-[var(--cy-text-primary)]">
            <option value="">（选择乐曲）</option>
            {bgmItems.map((b) => <option key={b.path} value={b.path}>{b.name}{b.source === 'upload' ? ' · 上传' : ''}</option>)}
          </select>
        )}
        {bgmType === 'file' && (
          <>
            <input ref={bgmFileRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" className="hidden"
              onChange={(e) => void handleBgmUpload(e)} />
            <button type="button" onClick={() => bgmFileRef.current?.click()} disabled={bgmUploading}
              className="h-7 rounded-md border border-[var(--cy-border-subtle)] px-2 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
              {bgmUploading ? '上传中…' : '上传'}
            </button>
          </>
        )}
        {bgmType !== 'none' && (
          <>
            <span className="text-[var(--cy-text-tertiary)]">音量</span>
            <input type="range" min={0} max={1} step={0.05} value={bgmVolume}
              onChange={(e) => setBgmVolume(Number(e.target.value))} className="w-20" />
            <span className="w-8 text-[var(--cy-text-tertiary)]">{bgmVolume.toFixed(2)}</span>
          </>
        )}
        {/* 试听:音量后一个播放/停止小按钮(选中乐曲后才显示) */}
        {bgmType === 'file' && bgmFile && (() => {
          const selBgm = bgmItems.find((b) => b.path === bgmFile);
          if (!selBgm) return null;
          return (
            <>
              <audio ref={bgmAudioRef} src={vgBgmFileUrl(selBgm.name)} preload="none"
                onEnded={() => setBgmPlaying(false)} className="hidden" />
              <button type="button" title={bgmPlaying ? '停止' : '试听'}
                onClick={() => {
                  const a = bgmAudioRef.current;
                  if (!a) return;
                  if (bgmPlaying) { a.pause(); a.currentTime = 0; setBgmPlaying(false); }
                  else { void a.play(); setBgmPlaying(true); }
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                {bgmPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            </>
          );
        })()}
      </div>

      {/* 商品:搜索 + 添加(右侧,弹模态表单);卡片展示名称/价格/图,字段全可空 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
            placeholder="搜索商品名称…"
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none" />
          <button type="button" onClick={openAddProduct}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--cy-brand-500)] px-3 text-sm font-medium text-white hover:opacity-90">
            + 添加商品
          </button>
        </div>
        {filteredProducts.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {filteredProducts.map((p) => {
              const sel = selectedProductRef === p.ref;
              const hasImg = p.ref.startsWith('product:');
              return (
                <div key={p.ref} onClick={() => onSelectProduct?.(sel ? null : p.ref)}
                  className={`relative flex cursor-pointer flex-col overflow-hidden rounded-lg border ${sel
                    ? 'border-[var(--cy-brand-500)] ring-1 ring-[var(--cy-brand-500)]'
                    : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-400)]'}`}>
                  {hasImg
                    ? (p.kind === 'video'
                      ? <video src={digitalHuman.productFileUrl(p.ref)} muted playsInline className="h-24 w-full bg-black object-cover" />
                      : <img src={digitalHuman.productFileUrl(p.ref)} alt="" className="h-24 w-full bg-[var(--cy-surface-2)] object-cover" />)
                    : <div className="flex h-24 w-full items-center justify-center bg-[var(--cy-surface-2)] text-2xl text-[var(--cy-text-tertiary)]">🏷️</div>}
                  <div className="flex flex-col gap-0.5 p-1.5">
                    <div className="truncate text-xs font-medium text-[var(--cy-text-primary)]">{p.title || '未命名商品'}</div>
                    {p.price ? <div className="text-xs font-bold text-[#ff5a5f]">{p.price}</div> : null}
                  </div>
                  <div className="absolute right-1 top-1 flex gap-1">
                    <button type="button" title="编辑" onClick={(e) => { e.stopPropagation(); openEditProduct(p); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-black/45 text-xs text-white hover:bg-black/70">✎</button>
                    <button type="button" title="移除" onClick={(e) => { e.stopPropagation(); removeProduct(p.ref); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-black/45 text-sm text-white hover:bg-[var(--cy-danger-500)]">×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!embedded && taskId && <DhProgressCard taskId={taskId} />}
      {!embedded && recentTasks.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[var(--cy-border-subtle)] pt-2">
          <div className="text-xs text-[var(--cy-text-tertiary)]">最近任务</div>
          {recentTasks.map((t) => (
            <DhProgressCard key={t.task_id} taskId={t.task_id} />
          ))}
        </div>
      )}
      </div>

      {/* 抠图参数:勾选「抠像」后显示,取消则隐藏。相似度越大抠越狠(易伤形象),越小越保守。 */}
      {products.length > 0 && matte && (
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--cy-border-subtle)] pt-2 text-xs">
          <span className="text-[var(--cy-text-secondary)]">抠图强度</span>
          <span className="text-[var(--cy-text-tertiary)]">保守</span>
          <input type="range" min={0.05} max={0.4} step={0.01} value={matteSim}
            onChange={(e) => setMatteSim(Number(e.target.value))} className="w-40 accent-[var(--cy-brand-500)]" />
          <span className="text-[var(--cy-text-tertiary)]">狠</span>
          <span className="w-9 text-[var(--cy-text-primary)]">{matteSim.toFixed(2)}</span>
          <span className="text-[var(--cy-text-tertiary)]">抠烂了调小、背景没抠净调大;绿/蓝幕可调大,白/浅底调小</span>
        </div>
      )}

      {/* 固定底栏:抠像 + 生成数字人视频 + 发布在线数字人,始终一排、不随上方滚动遮挡 */}
      <div className="mt-2 flex shrink-0 items-center gap-2 border-t border-[var(--cy-border-subtle)] pt-2">
        {products.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1" title="自动识别背景(绿/白/蓝等纯色底)抠出形象,仅留人像">
            <input type="checkbox" checked={matte} onChange={(e) => setMatte(e.target.checked)}
              className="h-4 w-4 accent-[var(--cy-brand-500)]" />
            <span className="text-sm text-[var(--cy-text-primary)]">抠像</span>
          </label>
        )}
        <button onClick={() => void gen()} disabled={!pid || !canGenerate || busy || !engineInstalled}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          生成数字人视频
        </button>
        {mode === 'single' && (
          <button type="button" onClick={() => void doPublish()} disabled={publishing || !curPreset}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-[var(--cy-brand-500)] px-3 text-sm text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            {publishing ? '发布中…' : '发布在线数字人'}
          </button>
        )}
      </div>

      {/* 编辑脚本弹窗:逐句编辑字幕清单(单形象=句;多角色=带角色)。保存写回 → 生成按此脚本走。 */}
      <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>编辑脚本（字幕清单）</DialogTitle>
          <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="flex flex-col gap-1.5">
              {editCues.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="mt-2 w-5 shrink-0 text-right text-xs text-[var(--cy-text-tertiary)]">{i + 1}</span>
                  {mode !== 'single' && roleNames.length > 0 && (
                    <select value={c.roleName}
                      onChange={(e) => setEditCues((prev) => prev.map((x, k) => (k === i ? { ...x, roleName: e.target.value } : x)))}
                      className="mt-1 h-8 w-20 shrink-0 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 text-xs text-[var(--cy-text-primary)]">
                      {roleNames.map((rn) => <option key={rn} value={rn}>{rn}</option>)}
                    </select>
                  )}
                  <textarea value={c.text} rows={1}
                    onChange={(e) => setEditCues((prev) => prev.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                    className="min-h-8 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-1.5 text-sm text-[var(--cy-text-primary)] focus-visible:outline-none" />
                  <span className="mt-2 shrink-0 text-[10px] text-[var(--cy-text-tertiary)]">{fmtSec(estimateDurationMs(c.text, rateByRole[c.roleName] ?? 1))}</span>
                  <button type="button" title="删除这句"
                    onClick={() => setEditCues((prev) => prev.filter((_, k) => k !== i))}
                    className="mt-1 shrink-0 rounded-md border border-[var(--cy-border-subtle)] px-1.5 py-0.5 text-xs text-[var(--cy-text-secondary)] hover:text-[var(--cy-danger-500)]">×</button>
                </div>
              ))}
              <button type="button"
                onClick={() => setEditCues((prev) => [...prev, { roleName: roleNames[0] || '台词', text: '' }])}
                className="mt-1 self-start rounded-md border border-dashed border-[var(--cy-border-subtle)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                + 添加一句
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--cy-border-subtle)] pt-2">
            <span className="text-xs text-[var(--cy-text-tertiary)]">
              共 {editCues.filter((c) => c.text.trim()).length} 句 · 总时长 {fmtSec(editCues.reduce((s, c) => s + estimateDurationMs(c.text, rateByRole[c.roleName] ?? 1), 0))}
            </span>
            <button type="button" onClick={() => setScriptOpen(false)}
              className="ml-auto h-8 rounded-md px-3 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">取消</button>
            <button type="button" onClick={saveScriptEditor}
              className="h-8 rounded-md bg-[var(--cy-brand-500)] px-4 text-sm text-white hover:bg-[var(--cy-brand-600)]">保存</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 添加/编辑商品:弹窗表单。图片/名称/价格/链接/简介全部可空。 */}
      <Dialog open={pmOpen} onOpenChange={setPmOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{pmDraft.ref && products.some((q) => q.ref === pmDraft.ref) ? '编辑商品' : '添加商品'}</DialogTitle>
          <div className="flex flex-col gap-2">
            <input ref={pmFileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => void onPmFile(e)} />
            <button type="button" onClick={() => pmFileRef.current?.click()} disabled={pmUploading}
              className="relative flex h-32 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
              {pmDraft.previewUrl
                ? (pmDraft.kind === 'video'
                  ? <video src={pmDraft.previewUrl} muted playsInline className="h-full w-full object-contain" />
                  : <img src={pmDraft.previewUrl} alt="" className="h-full w-full object-contain" />)
                : (pmUploading ? '上传中…' : '点击上传图片 / 视频(可不传)')}
            </button>
            <input type="text" value={pmDraft.title} onChange={(e) => setPmDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="商品名称(选填)"
              className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none" />
            <input type="text" value={pmDraft.price} onChange={(e) => setPmDraft((d) => ({ ...d, price: e.target.value }))}
              placeholder="价格(选填,如 ¥99)"
              className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none" />
            <input type="url" value={pmDraft.link} onChange={(e) => setPmDraft((d) => ({ ...d, link: e.target.value }))}
              placeholder="商品链接(选填,在线页点商品/橱窗跳转)"
              className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none" />
            <textarea value={pmDraft.desc} onChange={(e) => setPmDraft((d) => ({ ...d, desc: e.target.value }))}
              placeholder="简介(选填,橱窗展示)" rows={2}
              className="resize-none rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 py-1.5 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none" />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setPmOpen(false)}
                className="h-8 rounded-md border border-[var(--cy-border-subtle)] px-3 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">取消</button>
              <button type="button" onClick={saveProduct}
                className="h-8 rounded-md bg-[var(--cy-brand-500)] px-3 text-sm font-medium text-white hover:opacity-90">保存</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
