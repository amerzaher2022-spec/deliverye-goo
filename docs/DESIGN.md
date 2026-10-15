# Design system

## What made the first version feel childish, and what replaced it

| Before | After |
|---|---|
| Emoji as icons (📋 🎥 ⏸ 🪙 🏅) | One SVG line-icon set (`web/src/icons.tsx`), 1.75 stroke, `currentColor` |
| Gradient title text with drop shadow, glowing yellow "Start" | Flat warm-white type; a single solid amber primary button |
| Cairo display font | IBM Plex Sans Arabic (UI, signs and brand assets) |
| Pastel green/red pedals with ▲ ■ glyphs | Charcoal translucent pads; amber press state; chevrons |
| Cartoon manager avatar | Dispatch panel with a headset icon |
| Box-and-sphere vehicles and riders | Generated models (see below); the hatchback stays an extruded model |
| Candy-striped chimney, floating yellow gem | Concrete chimney with a brand band; logo "map pin" for sponsored businesses |
| Large window grid stretched over boxes | Facades tiled per bay and storey; ground-floor shopfronts; rooftop tanks; curbs; median; zebra crossings; parked cars |
| Initials-on-gradient logos | Fictional brand marks with Arabic wordmarks (`scripts/render-brand-assets.mjs`) |
| Top-tab dashboard with emoji labels | Sidebar SaaS layout, page headers, card/table views, status dots, empty and loading states |

## Tokens

| Token | Value | Use |
|---|---|---|
| Ink | `#08100f` | App background |
| Deep teal glass | `#0c1817` / `#132321` / `#1c302e` | Game panels and sheets (HUD panels are 80 % opaque over the scene) |
| Cream | `#f6f1e6` / `#fff6e2` | Primary text on dark, headings |
| Teal | `#0b7a75`, light `#15a69e`, soft `#5fd0c6`, deep `#06423f` | Brand: logo, level badge, selected tab, section labels, icons, active touch pads, dashboard primary |
| Amber | `#f6a821` (game) / `#d98a0b` (dashboard) | The one thing to press (gradient button with a soft glow), coins and rewards, route line, sponsorship |
| Dashboard background | `#f5f4f1` | Neutral warm surface; dark teal sidebar |
| Status | green `#1f8a5b`, amber `#a8650a`, red `#c2412d` | Always with a dot and a label |

The colours come from the Sawa Erbil mark (`web/src/brand.ts`). Type is IBM Plex Sans Arabic (400–700), shipped with the app in `web/public/fonts` (SIL Open Font License) so it looks the same offline and on every phone.

Radius 10–16 px, 8-point spacing, a single shadow style per surface, glass blur only on HUD panels over the 3D scene.

## Layout rules

- Thumb controls are pinned to physical left and right in both RTL and LTR. Text and panels follow the reading direction.
- The HUD keeps the road clear: status top-start, actions top-end, mission card top-centre, minimap below the actions, speed bottom-centre.
- Safe-area insets are applied on every edge. The phone breakpoints (≤760 px wide, ≤480 px tall) re-stack the HUD and menu.
- In the rider's-eye view the speed readout moves under the minimap (the handlebar has its own dial) and the dispatcher's message sits under the mission card; on a phone held sideways the message briefly takes the card's place.
- On a phone held sideways the menu stays beside the rider and fits the screen without scrolling.
- Charts use the validated categorical palette in fixed order, with a legend, hover values and a table view.

## Vehicles and people (third pass)

The second-pass vehicles and capsule-limbed people were still too crude next to the reference screenshots. They were replaced by models generated offline with `tools/models/build_models.py`:

| Reference | Now in the game |
|---|---|
| Yellow vintage scooter ("Motobike") | Mustard-yellow classic scooter: rounded rear body with side vents and chrome trim, leg shield, front fender, round headlight on the handlebar, two round mirrors, two-tone seat, tail light, 10-inch wheels |
| Black city bicycle with a front basket | Black roadster: lugged frame, swept-back bar, sprung brown saddle, mudguards, chain guard, 32-spoke wheels, front rack with a wire basket, lamp and bell |
| Rider in a white T-shirt, jeans and a striped helmet | Seated rider with the same outfit. Hands sit on the grips and feet on the floorboard or pedals (two-bone IK). Gloss-black open-face helmet with a white and red centre stripe |
| First-person view with hands on the handlebar | Rider view from the eyes: the head is hidden, the arms, hands, mirrors and headlight stay in view, and the field of view is wider |
| Red-haired staff in a blue shirt holding foil trays, with a "!" overhead | Pickup person at restaurants: auburn hair, blue shirt, brown trousers, a stack of three foil trays, and a floating yellow "!" |
| Woman in pink carrying pizza boxes | Pickup person at pizza places |
| Man in a green cap and grey tank top; man in a grey jacket | Pedestrians on the pavements, along with a woman in a teal top and a worker in overalls (at factories and warehouses) |
| Manager with shemagh and high-visibility vest | Dispatcher portrait in the dispatch dialog |

People are static poses: there is no walking animation. Pedestrians have small collision boxes, so riders steer around them, as in the reference ("avoid them").

## Vehicles and people (fourth pass: original, made for this app)

The MakeHuman-based people were replaced by an original cast built from this project's own skeleton and anatomy (`tools/models`). No third-party data is used anywhere (see [CREDITS](CREDITS.md)).

- **Courier:** charcoal polo with an amber yoke and the app badge, amber open-face helmet with a charcoal stripe, insulated amber backpack printed "توصيل أربيل / ERBIL DELIVERY". Seated on the scooter or the bicycle, hands wrapped around the grips.
- **Townspeople:**
  - restaurant staff in a headscarf and apron with foil trays
  - pizza runner in a red polo and cap
  - older man in Kurdish *shal u shapik* with a striped sash and *jamana*
  - young man in a hoodie
  - woman in a long coat and headscarf
  - factory worker in a high-visibility vest and hard hat
- **Dispatcher portrait:** Kak Hama in the branded polo with a headset.
- **Cars:**
  - The player's courier hatchback is white with a charcoal roof, an amber shoulder stripe and the Sawa Erbil mark with «سوا اربيل» on the front doors (redrawn in the game from `web/src/brand.ts`). The scooter carries the courier box with the mark on a rear rack; the rider wears a full-face helmet with a dark visor.
  - Streets get saloons, large 4×4s and double-cab pickups, the cars most common in Erbil, in realistic colours.
  - The street cars show the same lamps, grilles, glass, wipers, panel lines and wheels as the full models: that detail is baked into a texture, so a whole street of cars stays cheap to draw. The paint is glossy, the chrome is metallic and the glass reflects, each from a mask in the texture.
- **Roads:**
  - worn asphalt with wheel tracks, cracks, tar seals, patches and chipped paint
  - paver pavements
  - concrete jersey barriers with yellow-and-black bands along the Sixty Meter median
  - planters with shrubs
