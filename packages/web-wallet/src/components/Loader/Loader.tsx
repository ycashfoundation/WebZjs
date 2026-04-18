import React from 'react';

const Loader: React.FC = () => {
  return (
    <div className="flex justify-center items-center">
      <div className="w-8 h-8 rounded-full border-2 border-border border-t-accent animate-spin" />
    </div>
  );
};

export default Loader;
