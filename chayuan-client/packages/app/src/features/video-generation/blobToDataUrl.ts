/**
 * 把音频 Blob 转成 data: URL(base64 内联)再喂 <audio>。
 *
 * ⚠ Tauri WKWebView(macOS)**不支持** blob: URL 作 <audio> 媒体源,
 * `audio.play()` 会抛 `NotSupportedError: The operation is not supported`。
 * 试听一律走这个 helper,避免各处重复实现 + 漏改。
 */
export function blobToAudioDataUrl(blob: Blob): Promise<string> {
  const wav = blob.type ? blob : new Blob([blob], { type: 'audio/wav' });
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('读取音频失败'));
    fr.readAsDataURL(wav);
  });
}


/**
 * 把 TTS 音频 Blob 喂进 <audio> 并播放 —— blob: URL 优先,data: URL 回退。
 *
 * 两端 webview 对 <audio> 媒体源支持正好相反:
 *  - Windows WebView2(Chromium):**data: URL 作媒体源整段失效**(2026-06-20 实测
 *    piper/edge/sherpa 全部 `Failed to load because no supported source was found`),
 *    而 blob: URL 正常(聊天语音消息一直用 blob: 能播)。
 *  - macOS WKWebView:历史上**不支持 blob:** 作媒体源(故旧实现统一走 data:)。
 * blob-first + data-fallback 同时覆盖两端。返回 blob: 路径的 object URL(data 路径返
 * null),由 caller 在卸载/下次播放时 revoke。
 */
export async function playAudioBlob(audio: HTMLAudioElement, blob: Blob): Promise<string | null> {
  const wav = blob.type ? blob : new Blob([blob], { type: 'audio/wav' });
  let objUrl: string | null = null;
  try {
    objUrl = URL.createObjectURL(wav);
    audio.src = objUrl;
    await audio.play();
    return objUrl;
  } catch {
    if (objUrl) {
      try { URL.revokeObjectURL(objUrl); } catch { /* ignore */ }
    }
  }
  audio.src = await blobToAudioDataUrl(wav);
  await audio.play();
  return null;
}
