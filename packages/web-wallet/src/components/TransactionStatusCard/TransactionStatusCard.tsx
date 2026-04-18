import React from 'react';

type Tone = 'accent' | 'ycash' | 'danger' | 'info';

interface TransactionStatusCardProps {
  icon: React.JSX.Element;
  headText: string;
  statusMessage?: string;
  tone?: Tone;
  children?: React.ReactNode;
}

const toneToRingClass: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  ycash: 'bg-ycash-soft text-ycash',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

function TransactionStatusCard({
  icon,
  headText,
  statusMessage,
  tone = 'accent',
  ...props
}: TransactionStatusCardProps): React.JSX.Element {
  const ring = toneToRingClass[tone];
  return (
    <div className="w-full flex justify-center mt-10">
      <div className="card-surface max-w-[560px] w-full p-8 md:p-10 flex flex-col items-center gap-6">
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center ${ring}`}
        >
          <div className="w-8 h-8 flex items-center justify-center">
            {icon}
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-text">
            {headText}
          </h2>
          {statusMessage && (
            <p className="text-sm text-text-muted leading-relaxed max-w-[42ch]">
              {statusMessage}
            </p>
          )}
        </div>
        {props.children && (
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {props.children}
          </div>
        )}
      </div>
    </div>
  );
}

export default TransactionStatusCard;
