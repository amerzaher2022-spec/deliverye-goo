# Design system

## What made the first version feel childish, and what replaced it

| Before | After |
|---|---|
| Emoji as icons (📋 🎥 ⏸ 🪙 🏅) | One SVG line-icon set (`web/src/icons.tsx`), 1.75 stroke, `currentColor` |
| Gradient title text with drop shadow, glowing yellow "Start" | Flat warm-white type; a single solid amber primary button |
| Cairo display font | IBM Plex Sans Arabic (UI, signs and brand assets) |
| Pastel green/red pedals with ▲ ■ glyphs | Charcoal translucent pads; amber press state; chevrons |
| Cartoon manager avatar | Dispatch panel with a headset icon |
| Box-and-sphere vehicles and riders | Extruded hatchback, 125cc scooter and bicycle; capsule-limbed riders; PBR materials with image-based lighting |
| Candy-striped chimney, floating yellow gem | Concrete chimney with a brand band; logo "map pin" for sponsored businesses |
| Large window grid stretched over boxes | Facades tiled per bay and storey; ground-floor shopfronts; rooftop tanks; curbs; median; zebra crossings; parked cars |
| Initials-on-gradient logos | Fictional brand marks with Arabic wordmarks (`scripts/render-brand-assets.mjs`) |
| Top-tab dashboard with emoji labels | Sidebar SaaS layout, page headers, card/table views, status dots, empty and loading states |

## Tokens

| Token | Value | Use |
|---|---|---|
| Charcoal | `#0e0f11` | App background, dark surfaces |
| Graphite | `#16181b` / `#1f2226` / `#2a2e33` | Game panels and sheets |
| Warm white | `#f3efe8` | Primary text on dark |
| Amber | `#e38b1d` (game) / `#c7740f` (dashboard) | Primary action, route, active state, sponsorship |
| Dashboard background | `#f5f4f1` | Neutral warm surface |
| Status | green `#1f8a5b`, amber `#a8650a`, red `#c2412d` | Always with a dot and a label |

Radius 10–16 px, 8-point spacing, a single shadow style per surface, glass blur only on HUD panels over the 3D scene.

## Layout rules

- Thumb controls are pinned to physical left and right in both RTL and LTR. Text and panels follow the reading direction.
- The HUD keeps the road clear: status top-start, actions top-end, mission card top-centre, minimap below the actions, speed bottom-centre.
- Safe-area insets are applied on every edge. The phone breakpoints (≤760 px wide, ≤480 px tall) re-stack the HUD and menu.
- Charts use the validated categorical palette in fixed order, with a legend, hover values and a table view.
