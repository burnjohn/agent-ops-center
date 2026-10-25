import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AppHeader } from './AppHeader';
import { ConnectionBanner } from './ConnectionBanner';
import { PageNotFound } from './EntityNotFound';
import { Loading } from './ScreenFrame';
import { BOARD_PATH, MISSION_CONTROL_PATH, USAGE_PATH } from './routeInfo';
import styles from './Layout.module.css';

// Each screen task (T51–T56) overwrites its own `index.tsx`; this file never changes for them.
const Board = lazy(() => import('../features/board'));
const Ticket = lazy(() => import('../features/ticket'));
const MissionControl = lazy(() => import('../features/mission-control'));
const Agent = lazy(() => import('../features/agent'));
const Usage = lazy(() => import('../features/usage'));
const SessionLog = lazy(() => import('../features/session-log'));

function Layout() {
  return (
    <div className={styles.layout}>
      <AppHeader />
      <ConnectionBanner />
      <main className={styles.main}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

/** Route table of SPEC-web-ui. Must render inside a Router and `HistoryProvider`. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={BOARD_PATH} replace />} />
        <Route path={BOARD_PATH} element={<Board />} />
        <Route path="/tickets/:ticketId" element={<Ticket />} />
        <Route path={MISSION_CONTROL_PATH} element={<MissionControl />} />
        <Route path="/agents/:agentId" element={<Agent />} />
        <Route path={USAGE_PATH} element={<Usage />} />
        <Route path="/sessions/:sessionId" element={<SessionLog />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
}
