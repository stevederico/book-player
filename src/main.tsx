import './assets/styles.css';
import { Outlet } from 'react-router';
import { createSkateboardApp } from '@stevederico/skateboard-ui/App';
import type { AppRoute } from '@stevederico/skateboard-ui/App';
// noLogin is true while developing (see todo.md "Current Development Priorities")
import constants from './constants.json';
import LibraryView from './components/LibraryView';
import PlayerView from './components/PlayerView';
import { Toaster } from './toast';

/**
 * Minimal app layout: a single routed outlet plus the global toast stack.
 * Replaces the default skateboard-ui chrome for the player experience.
 *
 * @returns Routed outlet with toaster overlay.
 */
function MinimalLayout() {
  return (
    <>
      <main id="main"><Outlet /></main>
      <Toaster />
    </>
  );
}

/**
 * Application route configuration.
 * Paths are relative to root (no leading slash); the shell registers them.
 */
const appRoutes: AppRoute[] = [
  { path: 'home', element: <LibraryView /> },
  { path: ':slug', element: <PlayerView /> },
];

createSkateboardApp({
  constants,
  appRoutes,
  overrides: { layout: MinimalLayout },
});
