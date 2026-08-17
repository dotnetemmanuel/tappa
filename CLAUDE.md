# Täppa

A browser-based garden and property planner. Plan-accurate, not photo-collage.
One document model, two synchronised views: a scaled 2D plan and a 3D scene.
Fully client-side, self-hosted, offline-first, no accounts, no paid APIs, no CDN.

Default locale is Sweden: metric, latitude 59.4 N, Swedish plus botanical plant
names with English fallback.

## Stack

Fixed. Ask before adding anything not on this list.

| Concern | Choice |
| --- | --- |
| App | SvelteKit 2 + Svelte 5 runes, `adapter-static`, TypeScript strict |
| Build | Vite |
| 3D | `three`, plus `three/examples/jsm` for MapControls, TransformControls, Sky |
| 2D | Plain Canvas2D with our own scene graph. No Konva, Fabric or PixiJS |
| Styling | Tailwind v4 |
| Geometry | `polygon-clipping` for booleans, `earcut` for triangulation |
| Solar | `suncalc` |
| Storage | IndexedDB via `idb`, images as ref-counted blobs |
| Project file | `.tappa` = zip via `fflate`, holding `project.json` and `/assets/*` |
| Tests | Vitest for core, Playwright for one smoke flow |
| License | MIT |

No state management library. Svelte 5 runes in plain classes are enough.

## Architecture

```
src/lib/
  core/       pure TypeScript, zero Svelte, zero DOM, unit-tested
    doc/      document model, entity types, schema and migrations
    geom/     vec2, polygon ops, offsetting, snapping, hit testing
    building/ wall graph to footprint solids, roof generator, openings
    plants/   species catalog, growth model, seasonal state, seeded RNG
    sun/      solar position, shadow accumulation grid
    cmd/      command pattern, undo stack, transactions
  render2d/   canvas painter, layer order, hit map, dimension drawing
  render3d/   three scene graph, procedural builders, materials, sun rig
  io/         import and export, image ingest, EXIF, calibration
  ui/         Svelte components
routes/
```

The rule that matters: `core` knows nothing about rendering. Both renderers are
pure functions of the document plus a view state. A change emits a `Patch` and
renderers rebuild only what it names.

## Units and axes

Metres throughout. Right-handed 2D with `x` east and `y` north. Map to three.js
as `x` and `-z`. Angles in radians in core, degrees only at the UI edge.

Geometry is polyline-only by decision. A curved bed is many short segments
written at draw time. See `docs/decisions.md`.

## Working agreement

- TypeScript strict. No `any`. No non-null `!` without a one-line reason.
- Pure geometry and model code has tests. Rendering does not need them.
- Run `npm run check`, `npm run lint` and `npm test` before calling a phase done.
  Report failures rather than papering over them.
- No barrel files. No `utils.ts` dumping ground. Modules named for what they do.
- Comments explain why, never what. One line each. No commented-out code, no
  leftover TODOs.
- Prefer a complete file rewrite over sprinkled patches when a file changes a lot.
- Commit per logical unit with a real message. Never "wip".
- Where a design decision has two defensible answers, pick one, write two lines
  in `docs/decisions.md`, and move on.

## Writing rules

No em dashes anywhere, in prose, comments, commit messages or docs. Use a comma,
a colon, parentheses, or rewrite the sentence.

No apostrophes in commit message content.

## Visual direction

Dark nursery-blackboard chrome, so every saturated colour on screen belongs to a
plant. Tokens live in `src/app.css`.

```
ink    #14211c  app background
bark   #1b2b25  panels
line   #2f473d  borders
chalk  #e9efe6  primary text
sage   #93a89b  secondary text
seed   #dfa53c  single accent, actions and selection only
paper  #eceee2  the plan canvas, light like drafting stock
grid   #d3d9c4 metre, #bcc4a9 five metre
```

Fraunces for the wordmark and panel headings only, Archivo for UI, IBM Plex Mono
for every number, dimension and coordinate. Sentence case, plain verbs, no
exclamation marks. An empty plan says what to do first, not "Welcome".

Quality floor, unannounced: keyboard operable, visible focus rings,
`prefers-reduced-motion` respected, pointer events so touch and pen work, panels
collapse to sheets below 860 px.

## Build order

Each phase ends runnable and committed. Phases 1 to 9 are in; what is listed as
missing under each one below is the honest remainder.

1. Skeleton and core. Document model, geometry, command stack, Vitest green.
2. Plan editor. Pan, zoom, grid, rectangle, polygon, path, the snapping engine,
   the length and angle HUD with numeric entry, selection, move, vertex editing.
3. Dimensions and annotation. Attached anchors, witness lines, readouts, labels.
4. House. Wall graph, thickness, openings, roof generator, 3D extrusion.
5. 3D scene. Renderer, camera modes, sun rig, shadows, surfaces, structures.
6. Plants. Catalog, archetype builders, growth model, seasons, instancing.
7. Images. Underlay and calibration, textures, cutout billboards, asset store.
8. Analysis and export. Shadow study, spacing and sun checks, planting list.
9. Polish. Touch, shortcuts sheet, autosave, project browser, empty states.
10. Terrain. Height points, levelled areas, the house in the slope, the ground in
    every view, sun on real ground, and the side view from each direction.

## Known remainder

- No project browser yet: the app reopens the last project, and `.tappa` files
  cover everything else.
- A house has one storey definition: the suterrang storey is the wall skirting
  down to the ground, not a separately drawn lower floor with its own outline.
- Terrain shading in the sun study is a coarse march along the sun, so a small
  mound reads as no obstacle at all.
- The side view draws silhouettes rather than a true section, and carries no
  dimensions of its own.
- The ground grid rebuilds on every document revision, so dragging the ground on a
  100 by 100 m plot costs about 40 ms a frame and the line lags the pointer. The
  knob is `MAX_CELLS` in `core/terrain/field.ts`.
- A pin dropped beside a drag takes its height from the baked grid rather than the
  fit, so it can freeze the ground a centimetre or two off.
- Before a plot boundary is drawn, the side view takes its section from the median
  depth of the height points, so marking more levels off that line than on it moves
  the line and hides the handles. Drawing the boundary settles it.
- The far end of a tilt drifts a few centimetres when a height point sits inside it,
  because the pivot snaps to that point and the ground past it keeps following the
  ramp.
- Props are not occluders in the sun study, and a pitched roof is approximated
  there by one flat box at 55 percent of the eave to ridge rise.
- Openings are placed by a slider in the inspector, not by clicking the wall.
- Textures and cutout billboards are modelled and stored but have no UI yet.
- Touch and pinch are untested on real hardware.
- The 3D view PNG re-renders at export resolution, so a very large scale on a
  weak card can stall for a moment.
