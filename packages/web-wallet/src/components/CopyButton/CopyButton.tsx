import React, { useState } from 'react';

interface CopyButtonProps {
  textToCopy: string;
  label?: string;
}

const HIDE_IN_SECONDS = 1800;

const CopyButton: React.FC<CopyButtonProps> = ({
  textToCopy,
  label = 'Copy',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), HIDE_IN_SECONDS);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="font-mono text-[11px] uppercase tracking-[0.15em] text-ycash hover:text-ycash-hover transition-colors px-2 py-1 rounded"
    >
      {copied ? 'Copied' : label}
    </button>
  );
};

export default CopyButton;
