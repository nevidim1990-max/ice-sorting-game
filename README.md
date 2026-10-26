# Ледяная Сортировка

The playable static SPA starts at the repository-root `index.html`. The legacy prototype in `engine/index.html` is not part of the release build.

## Build

Run `npm install`, then `npm run build`. Vite writes the deployable site to `dist/`.

The built `dist/index.html` can be opened directly or uploaded to a static host; gameplay does not need a server or backend. `npm run dev` is only for local development.

## Tests and QA status

Run `npm run test:campaign` to simulate the movement and ice rules and verify that each of the 12 runtime boards has a solution within its move limit. Invalid source layouts are normalized by the game at runtime; the test applies the same repair rules.

The current build reports `QA_PASS`: all 12 runtime layouts pass the solver, and all 12 levels were completed in a browser at desktop size. The first level, touch controls, undo, pause, and save migration were also checked at desktop and mobile sizes. See `dist/build_status.json` after building.
