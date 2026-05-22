import './assets/styles.css';
import './assets/pg.css';
import { Outlet } from 'react-router-dom';
import { createSkateboardApp } from '@stevederico/skateboard-ui/App';
import constants from './constants.json';
import LibraryView from './components/LibraryView.jsx';
import PlayerView from './components/PlayerView.jsx';

function MinimalLayout() {
  return <main id="main"><Outlet /></main>;
}

const appRoutes = [
  { path: 'player/:slug', element: <PlayerView /> },
  { path: 'player', element: <PlayerView /> },
];

createSkateboardApp({
  constants,
  appRoutes,
  defaultRoute: 'player',
  landingPage: <LibraryView />,
  overrides: { layout: MinimalLayout },
});
