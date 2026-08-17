# Lutande terräng och suterränghus

Design for ground shaping in Täppa: a plot that rises and falls, flat terraces
cut into it, a house that sits in the slope with an exposed base storey, and a
side view that shows the result.

## Goal

Today the world is flat. The 3D ground is one plane at y=0, every wall runs from
0 to its height, plants and props sit at 0, and the sun study measures light on a
flat grid. A suterräng house cannot be described at all.

After this work you can say the plot falls 1.8 m from the road to the back fence,
cut a terrace into it, put the house in the slope so its lower floor is buried
uphill and walks out downhill, see the ground shape as contours on the plan and
as a real surface in 3D, read a side view from any of the four directions, and
get a sun study that measures light at real ground height.

A document with no height information stays exactly as it is today, in both
appearance and speed.

## Decisions already settled

- Ground shape comes from height points you place plus areas that level the
  ground. Not a single plot-wide tilt, not drawn contour lines.
- A levelled area meets the surrounding ground either with a bank over a run you
  give, or with a hard vertical face that is a retaining wall.
- The house gets one finished floor level and every wall grows a skirt down to
  the ground under it. No separately drawn lower storey in this work.
- Plants and hedges never tilt. Foot on the ground, growing straight up.
- The ground is baked into a height grid. Everything reads that one grid.
- The sun study handles terrain coarsely. It is not the point of this work.
- The side view of the plot is part of this work.

## Model

### Height point

A new entity kind, `spot`.

```
SpotEntity = Base & { k: 'spot'; at: Vec2; z: number }
```

Placed with a new tool, moved and deleted like anything else, its number typed in
the inspector. Lives on its own layer, `mark` (Swedish label "Marknivåer"),
created by `DEFAULT_LAYERS` for new documents and added on demand for old ones.

### Levelled area

No new entity. `AreaEntity` gains an optional field:

```
grade?: { level: number; edge: 'bank' | 'wall'; run: number; mat?: MaterialId }
```

`level` is the height the area sits at. `edge: 'bank'` ramps the surrounding
ground to meet it over `run` metres. `edge: 'wall'` steps vertically, and `mat`
is the material of the resulting retaining face, defaulting to concrete.

The existing `elev` field keeps its current meaning: a small lift of the surface
above the ground it is laid on, used for stacking order. `grade` moves the ground
itself. They are independent.

### Document settings

```
DocMeta gains: contour: number   // contour interval in metres, default 0.25
```

Bank run has no document-level default worth carrying; the tool remembers the
last one in `AppState`, like `pathWidth` and `fenceHeight`.

### Wall floor level

`WallEntity` gains `floor?: number`, the finished floor height. Absent means 0,
so every existing document is unchanged.

The value belongs to a house, not to a wall, but there is no building entity and
inventing one would ripple through roofs, the wall graph and selection. Instead a
single command writes the level to every wall in the connected run, and the
inspector edits it that way. Divergent values are still legal and each wall then
uses its own, which keeps the renderers total.

### Opening heights

`Opening.sill` changes meaning from "above the wall base" to "above the finished
floor". For every existing document those are the same number, since floor is 0
and the base is 0, so no migration is needed and nothing moves.

A negative sill puts an opening in the base storey. The inspector lists openings
with a negative sill under a separate heading rather than as raw negative numbers.

### Schema

`SCHEMA_VERSION` goes to 2. The migration step from 1 to 2 only stamps the
version and fills `meta.contour`; every new field is optional and absent means
flat. `KINDS` in `migrate.ts` gains `spot`, which is a compile error until added.

## Ground computation

New directory `src/lib/core/terrain/`, pure, no DOM, unit tested.

### field.ts

```
HeightField = { x0: number; y0: number; cell: number; nx: number; ny: number; h: Float32Array }
buildField(doc: Doc): HeightField | null
heightAt(f: HeightField | null, x: number, y: number): number   // 0 when null
```

`buildField` returns `null` when the document has no height points and no graded
areas. Every caller treats `null` as flat ground at 0 and skips its terrain work
entirely, which is what keeps existing projects untouched and fast.

Extent is `docBounds` grown by 10 m, so the ground is defined a little past
everything drawn. Cell size is 0.25 m, doubled as needed to keep the cell count
under 250 000, so a very large plot degrades in resolution rather than in speed.

Base surface from the height points:

- 0 points: 0 everywhere.
- 1 point: that height everywhere.
- 2 points: linear along the line joining them, constant across it.
- 3 or more: least squares plane through all points, plus an inverse distance
  weighted interpolation of each point's residual from that plane. The residual
  term is exactly 0 for a set of points that are already planar, so three points
  give a dead even slope, and it is exact at every point, so the ground passes
  through the numbers you typed.

Then graded areas are stamped in document order, later winning on overlap:

- Inside the ring: `level`.
- `edge: 'bank'`: within `run` metres outside the ring, blend from `level` to the
  height the surface already had, smoothstep on the distance so the join has no
  crease.
- `edge: 'wall'`: nothing outside the ring changes, leaving a vertical step.

Rebuilt when the document changes, cached against `AppState.rev` alongside the
existing scene rebuild.

### contour.ts

```
contourLines(f: HeightField, interval: number): { z: number; pts: Vec2[] }[]
```

Marching squares over the grid, one polyline set per level, with saddle cells
resolved by the cell average so lines never cross. Used by the plan painter and
nothing else.

### query.ts

Thin helpers every renderer shares, so nobody reimplements them:

```
groundUnder(f, ring): { min: number; max: number }
profileAlong(f, spine, step): number[]
drape(f, ring, holes, lift, maxEdge): Float32Array   // triangulated and lifted
```

`drape` triangulates with earcut, subdivides any triangle edge longer than
`maxEdge`, then lifts each vertex to ground height plus `lift`.

### Tests

`field.test.ts`: three points give a plane, the field is exact at every point,
one point gives a constant, a graded area is flat inside and blended in the band,
overlapping areas resolve in document order, a hard edge leaves a step of the
right size, an empty document returns null.

`contour.test.ts`: a plane gives parallel straight lines at the right spacing, a
cone gives closed rings, no line crosses another, levels outside the height range
produce nothing.

## The house in the slope

`wallgraph.ts` currently builds each wall from 0 to `height`. It gains a base
that follows the ground:

- Top of the wall: `floor + height`.
- Bottom: the ground under that point of the wall, minus 0.2 m, sampled along the
  wall at the field cell size so the underside follows the slope rather than
  stepping at each end.
- The part below `floor` is emitted as separate faces so it can take the
  foundation material and read as a base storey rather than a very tall wall.
- Floor slab at `floor`, which `floorSolid` already supports.

Openings place at `floor + sill`. An opening whose head is below the ground
outside is still cut and still drawn; it is simply buried, which is the honest
result of putting a window there.

Roofs are unaffected beyond riding on `floor + height`.

Default floor level when a wall loop closes: the highest ground under the
footprint, which is where a suterräng house sits. The user can type another.

`checks.ts` gains one check: a wall whose exposed base is over 3 m, which usually
means the floor level is wrong rather than that the house has a three metre
plinth.

## Everything else standing on the ground

- Plants: base at the ground under the stem, no tilt. `InstancedMesh` matrices
  gain a y translation, which costs nothing.
- Hedges and fences: bottom and top both follow the ground along the run, posts
  upright, so a fence up a slope rakes.
- Props: level, sitting at the highest ground under the footprint.
- Areas and paths: draped, following the ground. A graded area is flat by
  definition and needs no drape.
- Terrain surface itself: the grid as a mesh, plus explicit vertical faces at
  every hard graded edge, since a grid cannot hold a vertical step crisply. The
  plot boundary keeps its own tint over the terrain, draped.

## Sun study

Deliberately cheap.

- Each sample cell starts at ground height rather than 0.
- Occluders carry real base heights: walls and fences from ground to top, plants
  from their own ground, roofs unchanged.
- Terrain shading itself: from each sample, step along the sun direction at 1 m
  for 60 m and compare the ray height with the ground. Catches a bank or a rise
  to the south, misses fine detail, skipped entirely when the field is null.

## Views

### Plan

- Contour lines every `meta.contour`, thin, in the existing grid colours, with
  the height written along a line at intervals. Every fifth line heavier.
- Height points as a small cross with the number beside it, in mono.
- A graded area shows its level in its label, and a hard edge is drawn with the
  retaining wall hatch.
- Both are one layer, so the layer panel toggles them.

### Side view

A fourth view mode, `elevation`, with a direction picker for north, east, south
and west, and its own painter in `src/lib/render2d/elevation.ts`.

Projection: horizontal axis across the plot perpendicular to the view direction,
vertical axis is height, scale shared with the plan so a metre is a metre.

Drawn back to front:

- Earth fill under the ground profile, the profile being the highest ground at
  each horizontal position across the depth of the plot.
- Every entity as a flat silhouette at its own height range, nearer things
  drawn over farther ones with an outline so they separate.
- The buried part of the house drawn dashed through the earth fill rather than
  clipped away, so you can see how deep the base storey sits.
- A height ruler down the left with the floor level marked.

Exports to PNG and PDF through the existing export menu, with the direction in
the title block.

## Order of work

Each step ends runnable, checked and committed.

1. `core/terrain`: field, contours, queries, tests. Nothing visible yet.
2. Document model: `spot` entity, `grade` on areas, `floor` on walls, schema 2,
   migration, validation, factory, the new layer.
3. Plan: terrain tool, height point placing and editing, grade settings in the
   inspector, contours and points in the painter.
4. 3D: terrain mesh, retaining faces, draped surfaces, plants, props and fences
   on the ground.
5. House: wall skirt, foundation material, openings from the floor, default floor
   level, the exposed base check.
6. Sun study on terrain.
7. Side view, including export.

## Risks

- The height grid is rebuilt on every document change. On a large plot that is a
  quarter million cells and a plane fit per cell. Measure before optimising; if
  it bites, rebuild only when a height point or grade actually changed.
- Draped surfaces multiply triangle counts. Cap the subdivision at the field cell
  size and no finer.
- Retaining faces come from graded area rings, which can self intersect after a
  freehand draw. Clean the ring the same way the surface builder already does.
