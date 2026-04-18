import React from 'react';
import cn from 'classnames';

interface TabProps {
  tabName: string;
  label: string;
  isActive: boolean;
  onClick: (key: string) => void;
}

const Tab: React.FC<TabProps> = ({ tabName, label, isActive, onClick }) => {
  return (
    <button
      type="button"
      onClick={() => onClick(tabName)}
      className={cn(
        'relative px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer',
        isActive
          ? 'text-text bg-card'
          : 'text-text-muted hover:text-text hover:bg-surface',
      )}
    >
      {label}
      {isActive && (
        <span className="absolute -bottom-[1px] left-3 right-3 h-[2px] bg-accent rounded-full" />
      )}
    </button>
  );
};

export default Tab;
