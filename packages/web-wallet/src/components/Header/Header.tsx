import React from 'react';
import { Link } from 'react-router-dom';
import { LogoPNG } from '../../assets';

const Header = (): React.JSX.Element => {
  return (
    <header className="font-inter h-[60px] w-full px-16 flex items-center justify-between bg-transparent py-3 border-b border-neutral-200">
      <Link to={'/'}>
        <div className="flex items-center">
          <img
            src={LogoPNG}
            className="w-[25px] h-[25px] mr-3"
            alt="Ycash logo"
          />
          <span className="text-lg font-semibold">Ycash Web Wallet</span>
        </div>
      </Link>
    </header>
  );
};

export default Header;

