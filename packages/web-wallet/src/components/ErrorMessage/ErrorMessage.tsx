import React from 'react';

interface ErrorMessageProps {
  text?: string;
}

function ErrorMessage({ text }: ErrorMessageProps): React.JSX.Element {
  if (!text) return <></>;
  return (
    <span className="font-mono text-xs text-danger" role="alert">
      {text}
    </span>
  );
}

export default ErrorMessage;
