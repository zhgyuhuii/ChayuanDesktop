/**
 * 主页特效层 — 浮在内容之上、不挡点击的 overlay。
 *
 * 当前装载
 * --------
 * 1. **GoldDragon**:金龙穿屏盘旋,首次延迟 4s,之后每 60~110s 触发一次。
 * 2. **LightSweep**:斜向光带 30~50s 扫过 hero 区一次。
 * 3. **AmbientParticles**:背景常驻金色微粒缓缓上升(数量克制,12 颗)。
 *
 * 为什么不直接挂全屏 fixed
 * ------------------------
 * 主页有 sidebar、tab 栏,fixed 会盖到这些区域显得很乱。改用 absolute inset:0
 * 嵌进父容器(HomePage section),父容器加 position:relative 即可。
 *
 * 性能
 * ----
 * - 龙静默期(60~110s)无 rAF,无 setTimeout。
 * - prefers-reduced-motion 关全部动画。
 * - document.hidden 时已在 GoldDragon 内 pause。
 */

import * as React from 'react';
import { GoldDragon } from './GoldDragon';
import { MagpieFlock } from './MagpieFlock';
import { Phoenix } from './Phoenix';

export const HomeFxLayer: React.FC = () => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [dragonKey, setDragonKey] = React.useState(0);
  const [phoenixKey, setPhoenixKey] = React.useState(0);

  // —— 尺寸监听
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // —— 龙首飞 4s + 凤凰首飞 28s(错峰,避免开场两个主秀同时入场)
  React.useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    const t1 = setTimeout(() => setDragonKey((n) => n + 1), 4000);
    const t2 = setTimeout(() => setPhoenixKey((n) => n + 1), 28000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // 尺寸刚有时触发,后续重排由 onFlightDone 自驱
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w > 0 && size.h > 0]);

  const onDragonDone = React.useCallback(() => {
    // 龙:60~110s 后再来
    const next = 60_000 + Math.random() * 50_000;
    setTimeout(() => setDragonKey((n) => n + 1), next);
  }, []);

  const onPhoenixDone = React.useCallback(() => {
    // 凤凰:90~150s 后再来,跟龙错相位
    const next = 90_000 + Math.random() * 60_000;
    setTimeout(() => setPhoenixKey((n) => n + 1), next);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 1,
      }}
    >
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
  // 用 useMemo 固定每颗粒的属性,避免 re-render 重置动画
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
