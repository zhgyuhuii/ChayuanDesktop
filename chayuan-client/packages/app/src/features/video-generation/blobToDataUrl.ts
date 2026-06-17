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
