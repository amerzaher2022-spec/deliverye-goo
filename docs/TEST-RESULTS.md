# Test results

Last run on 2026-10-13 (after the fourth pass: original cast, cars and roads) in the cloud build environment (Node 22, PostgreSQL 16, Chromium 1194 with a software GPU).

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

## 3D models (vehicles and people, third pass)

Checked after replacing the scooter, bicycle, riders and people:
- typecheck, the 29 API tests, the build and the 4 browser tests all pass again (results above are from this run)
- in the browser (Chromium, software GPU):
  - the GLB files load
  - the menu shows the yellow scooter and the bicycle, each with its rider
  - the chase view shows the rider from behind
  - the rider view shows the hands on the grips, the mirrors and the headlight
  - restaurant staff with foil trays and a "!" wait at the pickup
  - pedestrians stand outside businesses at medium and high quality
  - the dispatcher portrait appears in the dispatch dialog
- a security-policy bug found during this check was fixed: `connect-src` lacked `blob:`, which three.js needs to decode the textures inside the GLB files
- Blender (Cycles) previews of every model were reviewed for fit, clipping and texture errors. Fixed along the way:
  - logos left on the shirts
  - socks showing through the tight jeans
  - waistbands showing through two of the tops
  - hair showing through the cap
  - wheel origins
  - shared materials that mixed up skin and hair textures

![Generated models](img-models.jpg)

## Fourth pass (original cast, cars, roads)

- typecheck, the 29 API tests, the build and the 4 browser tests pass (results above are from this run)
- The first browser run failed: the English-interface test timed out because the menu took about 96 s to load at medium quality. The cause was the parked cars. Each car type was instanced over every parking slot, with the other types' slots scaled to zero, so the scene drew about 1.4 million triangles. Parked cars are now instanced per type and per 160 m map cell, so each car is drawn once and off-screen streets are skipped.
- Menu load and frame time in the test browser (software GPU, 1366×820), before and after the fix:

| Quality | Before: load | Before: 2 frames | After: load | After: 2 frames | Previous release: load | Previous release: 2 frames |
|---|---|---|---|---|---|---|
| low | 9 s | 0.5 s | 10 s | 0.5 s | not measured | not measured |
| medium | 96 s | 8 s | 14 s | 1.3 s | 14 s | 1.4 s |
| high | over 150 s (menu never appeared) | not measured | 26 s | 2.9 s | not measured | not measured |

  These timings come from a CPU renderer, so they only show relative cost, not real-device frame rate.

## Not tested

- Real iPhone and Android hardware (touch feel, GPU performance, Safari quirks), including frame rate with the new models and the pavement crowd
- The public deployment, since none exists yet
- OpenStreetMap tile loading and Nominatim search, which were blocked in the build environment
