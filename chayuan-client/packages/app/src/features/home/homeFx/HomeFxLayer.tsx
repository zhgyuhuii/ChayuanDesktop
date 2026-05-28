/**
 * 主页特效层 — 全屏游动,但**叠在内容之下**不遮按钮。
 *
 * z 分层 (2026-05-20)
 * -------------------
 * 用户要求:特效全屏可见 + 不能盖住可点击的卡片/按钮。
 *
 * 实现:特效层**内嵌**在 HomePage 容器里(不 Portal),自身 ``position: fixed
 * inset:0`` 覆盖整个 viewport(摆脱 max-w-5xl 宽度夹持),但 ``z-index: 0``;
 * HomePage 容器加 Tailwind ``isolate`` 强制创建 stacking context — 这样:
 *   - 卡片/按钮 ``relative z-10`` 永远在 fx 上方 → 不被覆盖
 *   - fx 自身仍能横穿整个屏幕(fixed 定位逃出 max-w-5xl)
 *
 * 卡片本身有不透明背景,所以龙游过卡片下方时被"挡住"是预期效果 —
 * 用户在卡片间的空隙、页面边距、底部空白处看到龙金光闪过。
 *
 * 装载内容
 * -------
 * 1. AuspiciousClouds:祥云漂移
 * 2. AmbientParticles:背景金粒缓升
 * 3. LightSweep:斜光带 38s 周期
 * 4. MagpieFlock:喜鹊 V 字编队
 * 5. GoldDragon:中国龙穿屏盘旋
 * 6. Phoenix:凤凰螺旋上升
 *
 * 性能
 * ----
 * - 龙/凤凰的 rAF 只在 active 时启动;document.hidden 暂停
 * - prefers-reduced-motion 关全部
 */

import * as React from 'react';
import { GoldDragon } from './GoldDragon';
import { MagpieFlock } from './MagpieFlock';
import { Phoenix } from './Phoenix';
import { AuspiciousClouds } from './AuspiciousClouds';
import { StarrySky } from './StarrySky';
import { Keyframes } from './Keyframes';

export const HomeFxLayer: React.FC = () => {
  // 自身 ref,ResizeObserver 监听容器实际可用尺寸 — 让 fx 严格限定在
  // HomePage isolate 范围内,不越界穿到 sidebar 区域(原 fixed inset:0 +
  // window.innerWidth 会让 dragon/phoenix 的飞行轨道按视口宽算,sidebar
  // 切换时主页内容右侧出现"被遮"假象)。
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [dragonKey, setDragonKey] = React.useState(0);
  const [phoenixKey, setPhoenixKey] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    const el = containerRef.current;
    // 初值
    setSize({ w: el.clientWidth, h: el.clientHeight });
    // ResizeObserver 跟父容器实际宽高(包含 sidebar 折叠/展开 grid 重新分配)
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // —— 龙首飞 4s + 凤凰首飞 28s
  React.useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    const t1 = setTimeout(() => setDragonKey((n) => n + 1), 4000);
    const t2 = setTimeout(() => setPhoenixKey((n) => n + 1), 28000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w > 0 && size.h > 0]);

  const onDragonDone = React.useCallback(() => {
    const next = 60_000 + Math.random() * 50_000;
    setTimeout(() => setDragonKey((n) => n + 1), next);
  }, []);

  const onPhoenixDone = React.useCallback(() => {
    const next = 90_000 + Math.random() * 60_000;
    setTimeout(() => setPhoenixKey((n) => n + 1), next);
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={{
        // absolute 锚到 HomePage isolate 容器(它 position:relative);
        // 不再 fixed 到 viewport — 避免 sidebar 区域被 fx 覆盖、内容右
        // 侧出现"被遮"错觉。
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      {/* 星空在最底层 — 满屏 4 角星 + 银河斜带,作"宇宙背景" */}
      <StarrySky />
      <AuspiciousClouds />
      <AmbientParticles />
      <LightSweep />
      <MagpieFlock />
      {size.w > 0 && size.h > 0 && (
        <>
          <GoldDragon
            flightKey={dragonKey}
            width={size.w}
            height={size.h}
            onFlightDone={onDragonDone}
          />
          <Phoenix
            flightKey={phoenixKey}
            width={size.w}
            height={size.h}
            onFlightDone={onPhoenixDone}
          />
        </>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// 光影 sweep — 一道斜光带 30~50s 扫过一次,4s 全程
// ──────────────────────────────────────────────────────────────

const LightSweep: React.FC = () => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: '-20%',
        left: '-30%',
        width: '40%',
        height: '160%',
        background:
          'linear-gradient(115deg, transparent 0%, rgba(255, 215, 90, 0.06) 35%, rgba(255, 235, 160, 0.18) 50%, rgba(255, 215, 90, 0.06) 65%, transparent 100%)',
        transform: 'rotate(15deg)',
        filter: 'blur(2px)',
        animation: 'cy-light-sweep 38s ease-in-out infinite',
        mixBlendMode: 'screen',
      }}
    />
    {/* @keyframes 走 CSSOM 注册(CSP 安全),不用运行时 <style> 元素。 */}
    <Keyframes cssText={LIGHT_SWEEP_KEYFRAMES} dedupeKey="cy-light-sweep" />
  </div>
);

const LIGHT_SWEEP_KEYFRAMES = `
@keyframes cy-light-sweep {
  0%, 88% { transform: translateX(-30%) rotate(15deg); opacity: 0; }
  90% { opacity: 1; }
  94% { transform: translateX(280%) rotate(15deg); opacity: 1; }
  96%, 100% { transform: translateX(330%) rotate(15deg); opacity: 0; }
}
@keyframes cy-particle-float {
  0% { transform: translateY(0) scale(1); opacity: 0; }
  20% { opacity: 0.8; }
  80% { opacity: 0.8; }
  100% { transform: translateY(-130vh) scale(0.4); opacity: 0; }
}
`;

// ──────────────────────────────────────────────────────────────
// 背景金色微粒 — 数量随视口宽度伸缩(每 ~140px 屏宽一颗,夹在 [10, 36]),
// 4K 屏不会显得稀疏,小窗也不会过密。屏宽变化时 100ms debounce 重算。
// ──────────────────────────────────────────────────────────────

function computeParticleCount(): number {
  if (typeof window === 'undefined') return 12;
  return Math.max(10, Math.min(36, Math.round(window.innerWidth / 140)));
}

const AmbientParticles: React.FC = React.memo(() => {
  const [count, setCount] = React.useState<number>(() => computeParticleCount());
  React.useEffect(() => {
    let t: number | null = null;
    const onResize = () => {
      if (t != null) window.clearTimeout(t);
      t = window.setTimeout(() => setCount(computeParticleCount()), 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (t != null) window.clearTimeout(t);
    };
  }, []);

  const particles = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        // 均匀铺满 5%~95% 屏宽,而非按 mod 8.3% 重复落点 — 宽屏更分散
        left: `${5 + (i / Math.max(count - 1, 1)) * 90}%`,
        size: 3 + (i % 3) * 1.5,
        delay: `${(i * 1.6) % 18}s`,
        duration: `${22 + (i % 4) * 4}s`,
      })),
    [count],
  );

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {particles.map((p, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 数量固定
          key={i}
          style={{
            position: 'absolute',
            bottom: 0,
            left: p.left,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #fff5c2 0%, #ffd75a 50%, transparent 80%)',
            filter: 'blur(0.6px)',
            animation: `cy-particle-float ${p.duration} ${p.delay} linear infinite`,
            mixBlendMode: 'screen',
          }}
        />
      ))}
    </div>
  );
});
AmbientParticles.displayName = 'AmbientParticles';
