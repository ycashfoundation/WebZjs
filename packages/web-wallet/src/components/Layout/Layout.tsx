import React from 'react';
import Header from '../Header/Header';
import Footer from '../Footer/Footer';
import { Outlet } from 'react-router-dom';

const Layout = ({ children }: React.PropsWithChildren): React.JSX.Element => {
  return (
    <div className="flex flex-col min-h-screen w-full">
      <Header />
      <main className="grow w-full max-w-6xl mx-auto px-6 md:px-10 py-8">
        {children ? children : <Outlet />}
      </main>
      <Footer />
    </div>
  );
};

export default Layout;
