import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'

const Login = lazy(() => import('./pages/Login'))
const Sales = lazy(() => import('./pages/Sales'))
const Leads = lazy(() => import('./pages/Leads'))
const CTA = lazy(() => import('./pages/CTA'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))
const PartnerDashboard = lazy(() => import('./pages/PartnerDashboard'))
const PartnerProfile = lazy(() => import('./pages/PartnerProfile'))
const Partners = lazy(() => import('./pages/Partners'))
const SalesExec = lazy(() => import('./pages/SalesExec'))

const PageLoader = () => (
  <div className="dashboard-page flex min-h-[50vh] w-full items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent"></div>
  </div>
)

const withSuspense = (Component) => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
)

export const router = createBrowserRouter([
  {
    path: '/login',
    element: withSuspense(Login),
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'sales']}>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/admin/overview" replace />,
      },
      {
        path: 'overview',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Sales)}</ProtectedRoute>,
      },
      {
        path: 'sales',
        element: withSuspense(Leads),
      },
      {
        path: 'cta',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(CTA)}</ProtectedRoute>,
      },
      {
        path: 'partners',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Partners)}</ProtectedRoute>,
      },
      {
        path: 'sales-exec',
        element: <ProtectedRoute requiredRole="admin">{withSuspense(SalesExec)}</ProtectedRoute>,
      },
      {
        path: 'audit-logs',
        element: <ProtectedRoute requiredRole="admin">{withSuspense(AuditLogs)}</ProtectedRoute>,
      },
    ],
  },
  {
    path: '/partner',
    element: (
      <ProtectedRoute requiredRole="partner">
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/partner/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: withSuspense(PartnerDashboard),
      },
      {
        path: 'profile',
        element: withSuspense(PartnerProfile),
      },
    ],
  },
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
], {
  basename: '/sunny',
})
