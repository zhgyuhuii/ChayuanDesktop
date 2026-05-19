/**
 * 主页特效层 — 浮在内容之上、不挡点击的 overlay。
 *
 * 全屏定位 (2026-05-20)
 * --------------------
 * 关键改动:用 ``createPortal`` 把整层挂到 ``document.body``,自身
 * ``position: fixed; inset: 0`` 全视口铺开。
 *
 * 为什么不再嵌进 HomePage section
 * --------------------------------
 * HomePage 容器 ``max-w-5xl mx-auto`` 居中,宽度被夹到 ~1024px;
 * 嵌进去的 HomeFxLayer 只能在这个窄列里飞,龙跟凤凰看起来"困在罐子里"。
 * 走 Portal + fixed 之后,坐标系直接是 viewport,龙能横穿整个屏幕 —
 * 包括 sidebar 和 header 之上 (mix-blend-mode:screen 让金光跟下方
 * 内容自然融合,没遮挡)。
 *
 * Portal 还顺手解决了 stacking context 的隐患 — HomePage 任何祖先
 * 套上 ``transform`` / ``filter`` / ``will-change`` 都不会再把 fixed
 * "拉回"到祖先空间。
 *
 * 装载内容
 * -------
 * 1. **AuspiciousClouds**:祥云 3 朵漂移
 * 2. **AmbientParticles**:背景金粒缓升 12 颗
 * 3. **LightSweep**:斜光带 38s 周期
 * 4. **MagpieFlock**:喜鹊 V 字编队 30~50s 一次
 * 5. **GoldDragon**:中国龙穿屏盘旋 60~110s 一次
 * 6. **Phoenix**:智灵鸟高位滑翔 90~150s 一次
 *
 * 性能
 * ----
 * - 龙/凤凰的 rAF 只在 active 时启动;document.hidden 暂停
 * - prefers-reduced-motion 关全部
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { GoldDragon } from './GoldDragon';
import { MagpieFlock } from './MagpieFlock';
import { Phoenix } from './Phoenix';
import { AuspiciousClouds } from './AuspiciousClouds';

export const HomeFxLayer: React.FC = () => {
  const [size, setSize] = React.useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  const [dragonKey, setDragonKey] = React.useState(0);
  const [phoenixKey, setPhoenixKey] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);

  // —— 仅在浏览器侧 mount 后启用 Portal (SSR 安全)
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // —— 视口尺寸:用 window 而非 ResizeObserver,确保跟 fixed inset:0 一致
  React.useEffect(() => {
    const onResize = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

  if (!mounted) return null;

  const overlay = (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        // 在 sidebar(z 一般 30)/ 内容之上,modal/dialog(50+)之下
        zIndex: 40,
      }}
    >
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

  return createPortal(overlay, document.body);
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
    <style>{LIGHT_SWEEP_KEYFRAMES}</style>
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
// 背景金色微粒 — 12 颗,从屏幕底部缓缓上升
// ──────────────────────────────────────────────────────────────

const AmbientParticles: React.FC = React.memo(() => {
  const particles = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        left: `${5 + ((i * 8.3) % 90)}%`,
        size: 3 + (i % 3) * 1.5,
        delay: `${i * 1.6}s`,
        duration: `${22 + (i % 4) * 4}s`,
      })),
    [],
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
