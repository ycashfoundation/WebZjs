import QRCode from 'react-qr-code';
import CopyButton from '../../components/CopyButton/CopyButton';

interface QrCodeProps {
  address: string;
}

function truncateMiddle(s: string, left = 12, right = 10): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function QrCode({ address }: QrCodeProps) {
  if (!address) return null;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-[420px]">
      <div className="p-4 rounded-lg bg-white border border-border">
        <QRCode value={address} size={224} bgColor="#ffffff" fgColor="#000000" />
      </div>

      <div className="w-full flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
            Address
          </span>
          <CopyButton textToCopy={address} />
        </div>
        <div className="bg-surface border border-border rounded-md px-3 py-2.5 font-mono text-xs text-text-muted break-all leading-relaxed">
          {address}
        </div>
        <span className="font-mono text-[10px] text-text-dim">
          {truncateMiddle(address)} · {address.length} chars
        </span>
      </div>
    </div>
  );
}
export default QrCode;
