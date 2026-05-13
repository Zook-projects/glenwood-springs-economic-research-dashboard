// Router — single source of route configuration. App is the layout route
// (TopBar + Outlet); each child route mounts its own view inside the
// outlet. The :subject param on /map/:subject is validated inside
// MapStubView; unknown values redirect to /dashboard. Workforce uses its
// own route element so the existing CommuteView mounts directly without
// going through the stub validator.

import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from './App';
import { DashboardView } from './views/DashboardView';
import { WorkforceMapView } from './views/maps/WorkforceMapView';
import { ActivityMapView } from './views/maps/ActivityMapView';
import { DemographicsMapView } from './views/maps/DemographicsMapView';
import { HousingMapView } from './views/maps/HousingMapView';
import { CommerceMapView } from './views/maps/CommerceMapView';
import { MapStubView } from './views/maps/MapStubView';

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardView /> },
      { path: 'map/workforce', element: <WorkforceMapView /> },
      { path: 'map/activity', element: <ActivityMapView /> },
      { path: 'map/demographics', element: <DemographicsMapView /> },
      { path: 'map/housing', element: <HousingMapView /> },
      { path: 'map/commerce', element: <CommerceMapView /> },
      { path: 'map/:subject', element: <MapStubView /> },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);
