import React, { useEffect, useRef, useState } from 'react';
import cn from 'classnames';
import { ChevronSVG } from '../../assets';
import ErrorMessage from '../ErrorMessage/ErrorMessage';

interface Option {
  value: string;
  label: string;
}

interface OptionWithBalance extends Option {
  balance: number;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Option[] | OptionWithBalance[];
  containerClassName?: string;
  labelClassName?: string;
  dropdownClassName?: string;
  defaultOption?: Option | OptionWithBalance;
  handleChange: (option: string) => void;
  selectedSuffix?: string | React.ReactNode;
  suffixOptions?: { label: string; value: string | React.JSX.Element }[];
}

interface DropdownOptionProps {
  option: Option;
  handleSelectOption: (option: Option) => void;
  suffixOptions?: { label: string; value: string | React.JSX.Element }[];
}

const useOutsideClick = (
  ref: React.RefObject<HTMLDivElement | null>,
  callback: () => void,
) => {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref && ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, callback]);
};

const DropdownOption: React.FC<DropdownOptionProps> = ({
  option,
  handleSelectOption,
  suffixOptions,
}) => (
  <div
    className="px-4 py-2.5 hover:bg-card-hover cursor-pointer flex justify-between items-center text-sm text-text"
    onClick={() => handleSelectOption(option)}
  >
    <span>{option.label}</span>
    {suffixOptions && (
      <div className="ml-2 font-mono text-xs text-text-muted">
        {suffixOptions.map(({ label, value }) => {
          if (label === option.value) return <div key={label}>{value}</div>;
        })}
      </div>
    )}
  </div>
);

const Select: React.FC<SelectProps> = ({
  label,
  error,
  options,
  defaultOption,
  containerClassName = '',
  labelClassName = '',
  dropdownClassName = '',
  selectedSuffix = '',
  suffixOptions,
  handleChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Option | null>(
    defaultOption || null,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  useOutsideClick(containerRef, () => setIsOpen(false));

  const handleSelectOption = (option: Option) => {
    handleChange(option.value);
    setSelected(option);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative flex flex-col w-full gap-2', containerClassName)}
    >
      {label && (
        <label
          className={cn(
            'font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim',
            labelClassName,
          )}
        >
          {label}
        </label>
      )}
      <div
        className={cn(
          'relative flex items-center bg-card border rounded-md px-4 py-3 cursor-pointer transition-colors',
          isOpen ? 'border-accent' : 'border-border hover:border-border-strong',
          error && 'border-danger/60',
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="grow text-sm text-text">
          {selected ? (
            selected.label
          ) : (
            <span className="text-text-dim">— Select —</span>
          )}
        </span>

        <div className="ml-2 flex items-center justify-center gap-2">
          {selectedSuffix && <div>{selectedSuffix}</div>}
          <ChevronSVG
            className={cn(
              'w-4 h-4 text-text-muted transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </div>

        {isOpen && (
          <div
            className={cn(
              'absolute top-full left-0 right-0 mt-1 bg-card border border-border-strong rounded-md overflow-hidden z-20 shadow-lg shadow-black/40',
              dropdownClassName,
            )}
          >
            {options.map((option) => (
              <DropdownOption
                key={option.value}
                option={option}
                handleSelectOption={handleSelectOption}
                suffixOptions={suffixOptions}
              />
            ))}
          </div>
        )}
      </div>
      <ErrorMessage text={error} />
    </div>
  );
};

export default Select;
