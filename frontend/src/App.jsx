import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import WorkflowNew from './pages/WorkflowNew.jsx';
import Ingest from './pages/Ingest.jsx';
import Mapping from './pages/Mapping.jsx';
import Preview from './pages/Preview.jsx';
import RunPage from './pages/RunPage.jsx';
import Breaks from './pages/Breaks.jsx';
import Reports from './pages/Reports.jsx';
import Analytics from './pages/Analytics.jsx';
import Audit from './pages/Audit.jsx';
import History from './pages/History.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import { useAuth } from './store/useAuth';

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Register />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/history" element={<History />} />
        <Route path="/workflows/new" element={<WorkflowNew />} />
        <Route path="/workflows/:id/ingest" element={<Ingest />} />
        <Route path="/workflows/:id/mapping" element={<Mapping />} />
        <Route path="/workflows/:id/preview" element={<Preview />} />
        <Route path="/workflows/:id/run" element={<RunPage />} />
        <Route path="/workflows/:id/breaks" element={<Breaks />} />
        <Route path="/workflows/:id/reports" element={<Reports />} />
        <Route path="/workflows/:id/analytics" element={<Analytics />} />
        <Route path="/workflows/:id/audit" element={<Audit />} />
        <Route path="/admin/users" element={<AdminOnly><AdminUsers /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}