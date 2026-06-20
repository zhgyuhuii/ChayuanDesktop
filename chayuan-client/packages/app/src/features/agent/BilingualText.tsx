import React from 'react';

export const BilingualText: React.FC<{ original: string; translated?: string }> = ({
  original,
  translated,
}) => {
  const [showOrig, setShowOrig] = React.useState(false);
  if (!translated || translated === original) return <span>{original}</span>;
  return (
    <button
      type="button"
      className="cursor-pointer text-left"
      title="点击切换原文/译文"
      onClick={() => setShowOrig((v) => !v)}
    >
      {showOrig ? original : translated}
      <sup className="ml-1 text-[10px] text-slate-400">机翻</sup>
    </button>
  );
};
