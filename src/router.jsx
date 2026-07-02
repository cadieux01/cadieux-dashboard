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
const PartnerRequests = lazy(() => import('./pages/PartnerRequests'))
const Partners = lazy(() => import('./pages/Partners'))
const SalesExec = lazy(() => import('./pages/SalesExec'))
const Team = lazy(() => import('./pages/Team'))
const Profile = lazy(() => import('./pages/Profile'))
const Requests = lazy(() => import('./pages/Requests'))
const Stock = lazy(() => import('./pages/Stock'))
const Units = lazy(() => import('./pages/Units'))
const Records = lazy(() => import('./pages/Records'))
const Payments = lazy(() => import('./pages/Payments'))
const Unsold = lazy(() => import('./pages/Unsold'))
const Reconcile = lazy(() => import('./pages/Reconcile'))
const SellForPartner = lazy(() => import('./pages/SellForPartner'))
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
        // Combined queue: partner stock requests + profile change approvals,
        // each in a tab. Replaces the two separate nav items.
        path: 'requests',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Requests)}</ProtectedRoute>,
      },
      {
        // Legacy redirects: the two queues merged into /admin/requests.
        path: 'change-requests',
        element: <Navigate to="/admin/requests" replace />,
      },
      {
        path: 'partner-requests',
        element: <Navigate to="/admin/requests" replace />,
      },
      {
        path: 'profile',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Profile)}</ProtectedRoute>,
      },
      {
        path: 'stock',
        element: <ProtectedRoute requiredRole="admin">{withSuspense(Stock)}</ProtectedRoute>,
      },
      {
        // Legacy redirects: Batches + Allot merged into /admin/stock.
        path: 'central-stock',
        element: <Navigate to="/admin/stock" replace />,
      },
      {
        path: 'allot',
        element: <Navigate to="/admin/stock?tab=allot" replace />,
      },
      {
        // Legacy redirect: Allotment folded into the single Stock page.
        path: 'allotment',
        element: <Navigate to="/admin/units" replace />,
      },
      {
        path: 'units',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Units)}</ProtectedRoute>,
      },
      {
        path: 'records',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Records)}</ProtectedRoute>,
      },
      {
        path: 'payments',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(Payments)}</ProtectedRoute>,
      },
      {
        path: 'unsold',
        element: <ProtectedRoute requiredRole="admin">{withSuspense(Unsold)}</ProtectedRoute>,
      },
      {
        path: 'reconcile',
        element: <ProtectedRoute requiredRole="admin">{withSuspense(Reconcile)}</ProtectedRoute>,
      },
      {
        // Phase 4 Change 4: agent/admin records a sale on behalf of a partner
        path: 'sell-for-partner',
        element: <ProtectedRoute allowedRoles={['admin', 'sales']}>{withSuspense(SellForPartner)}</ProtectedRoute>,
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
        path: 'requests',
        element: withSuspense(PartnerRequests),
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
