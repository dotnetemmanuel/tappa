# Täppa

**[Open it](https://dotnetemmanuel.github.io/tappa/)**

A browser-based garden and property planner. Plan-accurate rather than
photo-collage: you draw your plot to real dimensions, and the same document is
rendered two ways.

- **Plan** is a scaled 2D drafting surface. You draw a direction, type `4.25`,
  press Enter, and the segment is exactly 4,25 m long.
- **Scene** is the same document as geometry, with real sun, real shadows,
  seasons, and plants that grow over thirty years.

Everything runs in the browser. No accounts, no server, no paid APIs, no CDN.
Projects live in IndexedDB and in a `.tappa` file you can move around. Fonts are
vendored, so it works on a plane.

Defaults are Swedish: metric, latitude 59,4 N, Swedish and botanical plant names.

## Running it

```sh
npm install
npm run dev
```

`npm run build` produces a static site in `build/` that can be served from any
web server. Asset urls are relative, so it runs from a subpath without extra
configuration, which is how the GitHub Pages deployment works. Every push to
`main` runs the checks and publishes.

Your projects live in the browser, tied to the origin serving the app, so a
project drawn on the published site will not appear in a local build. Move work
between them with a `.tappa` file.

| Script          | What it does                      |
| --------------- | --------------------------------- |
| `npm run dev`   | Development server                |
| `npm run build` | Static production build           |
| `npm run check` | Svelte and TypeScript diagnostics |
| `npm run lint`  | ESLint                            |
| `npm test`      | Vitest over the pure core         |

## Features

Everything below is built. A tick means it has been driven in a browser and
seen to work; a dash means the code is there and typechecks but nobody has
clicked it yet.

**Drawing and measuring**

- [x] Plot boundary, drawn as a proper dash-dot property line
- [x] Type an exact length while drawing: draw a direction, type `4.25`, Enter
- [x] Length and angle HUD, `Tab` between them, `Shift` for orthogonal
- [x] Snapping to vertices, endpoints, midpoints, centres, perpendiculars,
      tangents, extensions, intersections, 15 degree angle lock and a 0,1 m grid,
      each toggleable
- [x] Rectangle, polygon, freehand with simplification, and paths with a width
- [x] Fences and hedges in 8 styles with height
- [x] Live area and perimeter while drawing
- [x] Dimensions that attach to geometry and follow it when it moves
- [x] Text labels
- [x] Select, move, marquee, vertex dragging, arrow key nudge
- [x] Undo and redo, with a drag folded into a single step
- [x] Five layers, each with show and lock

**House**

- [x] Walls as a shared-corner node graph, mitred, with thickness and height
- [x] Closing a wall run back on its first corner forms a real footprint
- [x] Doors and windows cut as actual holes in the wall face
- [x] Gable roof over a footprint, including an L-shape
- [ ] Hipped, mono and flat roofs
- [ ] Openings dragged along the wall rather than set by a slider

**Planting**

- [x] 129 species for Swedish zones, searchable in Swedish, English or Latin,
      with mature size, growth rate, seasonal colour, bloom and fruit months
- [x] 44 garden objects, most with adjustable sizes
- [x] Growth over 0 to 30 years at species-correct rates
- [x] Plan symbols generated from the same parameters as the 3D form
- [x] Spacing warnings when canopies grow into each other
- [ ] Light warnings against a sun study (the code runs, the case is unseen)

**Views**

- [x] Plan, split and 3D
- [x] Orbit camera, and a walk mode at 1,7 m eye height
- [ ] WASD movement in walk mode
- [x] Real sun position, shadows and sky for any date and time at the
      document latitude
- [x] Sun hours per day as a heatmap over the plan
- [ ] Hiding a layer also hiding it in 3D

**Images**

- [x] Drop or paste a map screenshot or aerial photo as a locked underlay
- [x] Calibrate it against a known length, exact to the millimetre
- [ ] The two-click calibration interaction (only its maths is verified)
- [x] Reselect a locked underlay with the image tool
- [ ] Photo textures on surfaces, and cutout PNG plants, are modelled and
      stored but have no UI

**Saving and exporting**

- [x] Autosave to IndexedDB, reopening where you left off
- [x] Dimensioned plan PNG with title block, scale bar, north arrow and legend
- [x] 3D view PNG, re-rendered at export resolution
- [x] PDF sheet with a planting list
- [x] Planting list and quantity takeoff as CSV
- [x] `.tappa` project file carrying its images inside it
- [ ] Opening a `.tappa` file through the button
- [ ] A project browser

## Keyboard

Press `?` in the app for the full sheet.

| Key         | Tool                       |
| ----------- | -------------------------- |
| `V` `H`     | Select, pan                |
| `B`         | Plot boundary              |
| `R` `A` `F` | Rectangle, area, freehand  |
| `G` `S` `W` | Path, fence or hedge, wall |
| `P` `O` `I` | Plant, object, image       |
| `M` `T`     | Dimension, text            |

While drawing: type a number for an exact length, `Tab` to switch to the angle,
`Shift` to lock orthogonal, `Enter` to finish, `Backspace` to undo a point.

## Layout

```
src/lib/
  core/       pure TypeScript, no Svelte, no DOM
    doc/      document model, entities, schema, dimensions
    geom/     vectors, polygons, snapping, hit testing
    building/ wall graph, openings, roof generator
    plants/   species catalog, growth model, form archetypes
    props/    garden object catalog and builders
    sun/      solar position, shadow accumulation
    analysis/ spacing and light checks
    cmd/      commands, undo stack, transactions
  render2d/   canvas painter, hatches, view transform
  render3d/   three scene, sun rig, sky, builders
  io/         storage, project file, images, exports
  ui/         Svelte components
```

The rule that matters: `core` knows nothing about rendering, and both renderers
read the same document. A plant's plan symbol and its 3D form come from one set
of parameters, so they cannot drift apart.

Design decisions and their reasoning are in `docs/decisions.md`. The working
agreement is in `CLAUDE.md`.

## Stack

SvelteKit 2 and Svelte 5 runes, TypeScript strict, Tailwind v4, Canvas2D for the
plan, three.js for the scene, `polygon-clipping` and `earcut` for geometry,
`suncalc` for the sun, `idb` for storage, `fflate` for the project file,
`pdf-lib` for the PDF.

## Status

All nine build phases are in. Known gaps are listed under "Known remainder" in
`CLAUDE.md`: there is no project browser yet, openings move by a slider rather
than by dragging along the wall, props cast no shadow in the sun study, photo
textures and cutout plants are stored but have no UI, and touch has not been
tested on real hardware.

## Licence

MIT. Vendored fonts (Fraunces, Archivo, IBM Plex Mono) are SIL Open Font
License 1.1, see `static/fonts/LICENSE.txt`.
