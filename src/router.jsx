import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import RouteErrorBoundary from './components/RouteErrorBoundary'

const Login = lazy(() => import('./pages/Login'))
const Sales = lazy(() => import('./pages/Sales'))
const Leads = lazy(() => import('./pages/Leads'))
const CTA = lazy(() => import('./pages/CTA'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))
const PartnerDashboard = lazy(() => import('./pages/PartnerDashboard'))
const Partners = lazy(() => import('./pages/Partners'))
const SalesExec = lazy(() => import('./pages/SalesExec'))
const Team = lazy(() => import('./pages/Team'))
const Profile = lazy(() => import('./pages/Profile'))
const ChangeRequests = lazy(() => import('./pages/ChangeRequests'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const OverviewPartners   = lazy(() => import('./pages/admin/OverviewPartners'))
const OverviewAssigned   = lazy(() => import('./pages/admin/OverviewAssigned'))
const OverviewSold       = lazy(() => import('./pages/admin/OverviewSold'))
const OverviewAttributed = lazy(() => import('./pages/admin/OverviewAttributed'))
const PartnerProfile     = lazy(() => import('./pages/admin/PartnerProfile'))
const AgentProfile       = lazy(() => import('./pages/admin/AgentProfilePage'))
const VariantDetail      = lazy(() => import('./pages/admin/VariantDetail'))

const PageLoader = () => (
  <div className="dashboard-page flex min-h-[50vh] w-full items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent"></div>
  </div>
)

const withSuspense = (Component) => (
  <RouteErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  </RouteErrorBoundary>
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
        path: 'overview/partners',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(OverviewPartners)}</ProtectedRoute>,
      },
      {
        path: 'overview/assigned',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(OverviewAssigned)}</ProtectedRoute>,
      },
      {
        path: 'overview/sold',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(OverviewSold)}</ProtectedRoute>,
      },
      {
        path: 'overview/attributed',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(OverviewAttributed)}</ProtectedRoute>,
      },
      {
        path: 'overview/variant/:variantName',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(VariantDetail)}</ProtectedRoute>,
      },
      {
        path: 'partner/:id',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(PartnerProfile)}</ProtectedRoute>,
      },
      {
        path: 'agent/:id',
        element: <ProtectedRoute requiredRole="admin">{withSuspense(AgentProfile)}</ProtectedRoute>,
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
        path: 'team',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Team)}</ProtectedRoute>,
      },
      {
        // Legacy redirect: old /admin/partners → /admin/team
        path: 'partners',
        element: <Navigate to="/admin/team" replace />,
      },
      {
        // Legacy redirect: old /admin/sales-exec → /admin/team?view=agents
        path: 'sales-exec',
        element: <Navigate to="/admin/team?view=agents" replace />,
      },
      {
        path: 'onboarding',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Onboarding)}</ProtectedRoute>,
      },
      {
        // Admin manages ALL requests; sales sees only partner requests
        // (RLS scopes the rows). One component, role-aware labelling.
        path: 'change-requests',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(ChangeRequests)}</ProtectedRoute>,
      },
      {
        path: 'profile',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Profile)}</ProtectedRoute>,
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
        element: withSuspense(Profile),
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
  basename: '/dashboard',
})
