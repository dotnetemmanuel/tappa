# Decisions

Two lines each. Newest last.

## Geometry is polyline only
A curved bed is stored as many short straight segments, written at draw time.
Arcs would double every geometry path (offset, area, boolean, dimensions, both renderers) for a shape that is rarely re-edited as a curve.

## The document lives outside the rune graph
`Doc` is a plain object; `AppState.rev` increments on every command patch and is what components track.
Deep-proxying thousands of entities cost more than it bought, and the canvas repaints imperatively anyway.

## Commands mutate the document in place
`apply` captures whatever `invert` needs before it changes anything, and returns a `Patch` naming what moved.
An immutable document would copy the whole entity array per drag frame, which a 60 fps drag cannot afford.

## Draft state is snapshotted before it enters the document
`PlanController` holds drafts in `$state`, so the values are reactive proxies, and `structuredClone` refuses to clone a proxy.
Every commit converts through `$state.snapshot` first, rather than each command defending itself.

## Pointer capture goes on the element that carries the listeners
Capture retargets later pointer events to the capturing element, so capturing on a wrapper while listening on the canvas silently loses every `pointerup`.
Both now sit on the canvas.

## Angle lock outranks the grid
A segment drawn under angle lock keeps the cursor distance, so its length is rarely round.
That matches how polar tracking works in a CAD tool: the lock fixes direction, and you type the length.

## Selection is an array, not a Set
`AppState.selection` is `EntityId[]` with a `selectionSet` getter for membership tests.
Runes track array reassignment cleanly, and the sets we build are read-only snapshots.

## A roof has one ridge, even over an L
The height comes from distance to a single ridge line in a rotated frame, so an L gets one ridge and a gable wall on the short wing rather than two ridges meeting in a valley.
Valleys need a straight skeleton, which is a lot of machinery for a shape the user can also draw as two roofs.

## The roof surface is split before it is triangulated
`polygon-clipping` cuts the footprint along the ridge and the hip lines, so each piece is one plane and lifting its vertices puts a real crease there.
Triangulating the whole footprint first would run a face straight across the ridge and flatten it.

## A roof covers the largest piece of what it is over
Everything in `over` is merged and only the biggest resulting outline is roofed, so a roof named over two separate buildings covers one.
The result type carries a single outline, and two buildings under one roof entity is a modelling mistake worth leaving visible.

## The sky is a gradient we own, not the three.js Sky addon
The `Sky` shader in this three release washes out to near white at any exposure, and its cloud uniforms are new and undocumented here.
A hand written vertical gradient tinted by sun altitude is fewer moving parts and always gives a readable horizon.

## The 3D view rebuilds the whole scene on every document change
A garden is a few thousand objects, so a full rebuild costs less than the bookkeeping a diffing scene graph would need.
`Patch` still exists for the plan renderer, where redraw happens every frame.

## One canonical plant form per species, scaled per instance
`plantForm` is built once at mature size for each species bucket, and each plant rides on an `InstancedMesh` matrix carrying its own age and jitter.
Per plant shape variation would defeat instancing, which is what keeps a thousand plants at frame rate.

## Wall points merge onto one node when they coincide
Clicking back on the first corner to close a house has to reuse that node, not make a second one on top of it.
Without the merge the loop never closes, and everything that needs a closed loop, roofs above all, silently finds nothing.

## offsetRing grows a ring on a positive distance
The implementation did the opposite of its own docstring, which two callers had already worked around with a negative sign.
The code was changed to match the documented contract rather than the other way round, since the contract is the intuitive one.

## polygon-clipping is imported as a default
The package ships only a default export, so `import * as clip` then `clip.union(...)` throws at runtime while typechecking cleanly.
Named type imports still come from the namespace.
