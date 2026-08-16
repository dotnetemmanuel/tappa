# Täppa

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
web server or opened from disk.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Static production build |
| `npm run check` | Svelte and TypeScript diagnostics |
| `npm run lint` | ESLint |
| `npm test` | Vitest over the pure core |

## What it does

**Survey.** Drop or paste a map screenshot, calibrate it against something whose
length you know, and trace your plot over it.

**Build.** Walls as a shared-corner graph, so dragging a corner moves both walls.
Thickness, height, doors and windows cut as real holes, and gable, hipped, mono
or flat roofs that work over an L-shaped footprint.

**Plant.** 129 species that grow in Swedish zones, with correct mature sizes,
growth rates, seasonal colour, bloom and fruit months. 44 garden objects from
pallkrage to badtunna.

**Measure.** Dimensions attach to the geometry rather than to coordinates, so
they follow what they measure. Live area and perimeter while you draw.

**Study.** Scrub the date, the time of day and the years since planting. Run a
sun study and get sun hours per day as a heatmap over the plan.

**Export.** Dimensioned plan PNG with a title block, scale bar and legend, a
planting list and quantities as CSV, a PDF sheet, and the `.tappa` project file
with its images inside it.

## Keyboard

Press `?` in the app for the full sheet.

| Key | Tool |
| --- | --- |
| `V` `H` | Select, pan |
| `B` | Plot boundary |
| `R` `A` `F` | Rectangle, area, freehand |
| `G` `S` `W` | Path, fence or hedge, wall |
| `P` `O` `I` | Plant, object, image |
| `M` `T` | Dimension, text |

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
