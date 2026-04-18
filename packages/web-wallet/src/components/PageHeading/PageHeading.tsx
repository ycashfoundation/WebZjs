import React from 'react';

interface PageHeadingProps {
  title: string;
  eyebrow?: string;
  children?: React.ReactNode;
}

function PageHeading({ title, eyebrow, children }: PageHeadingProps) {
  return (
    <section className="pb-6 mb-8 border-b border-border">
      <div className="flex flex-wrap gap-4 justify-between items-end">
        <div className="flex flex-col gap-1">
          {eyebrow && (
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-dim">
              {eyebrow}
            </span>
          )}
          <h2 className="text-text text-3xl md:text-4xl font-semibold tracking-tight">
            {title}
          </h2>
        </div>
        {children && <div className="flex items-center">{children}</div>}
      </div>
    </section>
  );
}

export default PageHeading;
