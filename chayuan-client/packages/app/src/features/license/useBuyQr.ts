import { licenseBuyUrl } from '@chayuan/api';
import QRCode from 'qrcode';
import * as React from 'react';

/**
 * 取购买链接(后端把本机指纹 + app 拼进 URL)并本地生成二维码 dataURL。
 * 供首页内联购买码复用,逻辑与 LicenseDialog 的「扫码购买」一致(不含 share 分支)。
 */
export function useBuyQr(app: string): { qrDataUrl: string; buyUrl: string } {
  const [buyUrl, setBuyUrl] = React.useState('');
  const [qrDataUrl, setQrDataUrl] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    licenseBuyUrl(app)
      .then((r) => { if (alive) setBuyUrl(r.url); })
      .catch(() => { if (alive) setBuyUrl(''); });
    return () => { alive = false; };
  }, [app]);

  React.useEffect(() => {
    if (!buyUrl) { setQrDataUrl(''); return; }
    let alive = true;
    QRCode.toDataURL(buyUrl, { margin: 1, width: 220 })
      .then((d) => { if (alive) setQrDataUrl(d); })
      .catch(() => { if (alive) setQrDataUrl(''); });
    return () => { alive = false; };
  }, [buyUrl]);

  return { qrDataUrl, buyUrl };
}
