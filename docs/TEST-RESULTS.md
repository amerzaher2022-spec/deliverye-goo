# Test results

Run on 2026-10-13 in the cloud build environment (Node 22, PostgreSQL 16, Chromium 1194 with a software GPU).

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **pass** |
| API, rules and geometry | `npm test` | **29 / 29 passed** |
| Production build | `npm run build` | **pass** |
| Browser end-to-end | `npm run test:e2e` | **4 / 4 passed** |

## Covered by the API tests (`tests/api.test.ts`, `tests/geo.test.ts`)

- The seeded fictional dataset loads: at least 5 restaurants/cafés, 3 retail shops, 2 factories, 2 warehouses and an office. Packages, logos, and expired or scheduled sponsorships behave as expected.
- Admin routes refuse requests with no session, a wrong password, a missing anti-CSRF header, a foreign Origin, or a player cookie.
- Creating a business keeps the Arabic and English names; location, entrance and pickup persist separately; the business appears in `/api/world` and the world version is bumped.
- Locations outside the district and missing names are rejected.
- Logo upload and replacement work, and the old file is deleted. SVG, a fake PNG and oversized files are rejected.
- Edit, move (missions follow the new pickup point), disable (gone from the world and from missions; record kept), archive and restore all work, and each action is in the audit log.
- Categories can be added without code changes; duplicate slugs are refused.
- The mission lifecycle in order. Collecting or delivering from the wrong place, delivering before collecting, and impossible speed are all refused. The reward is paid once; a second claim returns 409. Three concurrent deliver requests pay once.
- Only one active mission per player; cancellation works. One player cannot touch another's run.
- Analytics records accepts and completions; demo events are labelled and can be excluded.
- Package edits reach the game. Category eligibility and location limits are enforced. Expiring a sponsorship never deletes the business.
- Demo reset requires `RESET` and `DEMO_MODE=true`, and restores the seed.
- Daily challenge rewards are paid once.
- The coordinate transform round-trips; local distances match great-circle distances (under 0.2 %); the road network is connected; routes follow streets.

## Covered by the browser tests (`e2e/`)

1. **Investor demo, end to end (desktop, Arabic):**
   - Sign in, then search "الستين" on the map.
   - Add a restaurant by clicking the map, with names, a logo upload and a menu item.
   - Create a mission to Abu Ali.
   - Open the game at the new business: its card shows the saved name and logo, and its 3D building exists.
   - Accept, collect at the pickup, deliver at Abu Ali, and receive 77 coins.
   - Rename and re-upload the logo in the dashboard; the running game picks up the new name.
   - Add a warehouse; it appears in the game as a warehouse.
   - Edit a package price.
   - Analytics shows real (non-demo) accepts and completions.
   - Disable the warehouse; it leaves the game.
   - Reset the demo.
2. **English interface:** the language switch flips the page to LTR. An anonymous admin write is refused (401).
3. **Phone (iPhone 13 emulation):** menu, tutorial, touch pedals, holding the throttle raises the speed, job board, no horizontal overflow.
4. **Dashboard on a phone:** sign in, map and editor visible, no horizontal overflow.

Notes on method:
- Driving across the district is replaced by the debug teleport (`?debug=1`): the software GPU renders a few frames per second. The server still checks that the player stands inside each pickup and drop-off zone.
- The game pages in the browser tests run at low graphics quality for the same reason.

## Visual review

Screenshots were taken and reviewed at 1280×720, 1366×820 and 1440×860 (desktop), iPhone 13 portrait and landscape, Pixel 7 portrait and Galaxy S9+ landscape, in both Arabic and English. Overlaps found during the redesign were fixed:
- AC units that covered the sign text
- a rotation hint that sat behind the nearby-business button
- a mobile menu button that showed on desktop

## Not tested

- Real iPhone and Android hardware (touch feel, GPU performance, Safari quirks)
- The public deployment, since none exists yet
- OpenStreetMap tile loading and Nominatim search, which were blocked in the build environment
