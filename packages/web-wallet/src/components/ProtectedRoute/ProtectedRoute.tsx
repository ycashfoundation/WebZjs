import { Navigate, Outlet } from 'react-router-dom';
import React from 'react';
import { useSession } from '../../context/SessionContext';
import Loader from '../Loader/Loader';

/**
 * Gates the dashboard routes on an unlocked session. While the session probe
 * is still resolving we render a loader rather than bouncing the user, so a
 * page refresh on /dashboard doesn't briefly flash the onboarding screen.
 */
const ProtectedRoute: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const { status } = useSession();

  if (status === 'unknown') {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader />
      </div>
    );
  }
  if (status === 'no-vault') return <Navigate to="/" replace />;
  if (status === 'locked') return <Navigate to="/unlock" replace />;

  return children ? <>{children}</> : <Outlet />;
};

export default ProtectedRoute;
