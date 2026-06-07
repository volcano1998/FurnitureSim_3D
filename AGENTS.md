# AGENTS.md

## Project Overview

Can It Fit? is a single-page Three.js application for building connected
parallelepiped rooms and testing whether furniture can travel between selected
entrance and exit faces.

The project has no package manager, bundler, or generated source. Three.js and
OrbitControls are loaded from a CDN through the import map in `index.html`.

## Files

- `index.html`: application markup, panels, controls, dialogs, and CDN imports.
- `styles.css`: all application styling and responsive layout.
- `app.js`: scene setup, block editing, attachments, persistence, UI state,
  manual interaction, animation, and environment construction.
- `planner.js`: furniture geometry, collision checks, opening traversal, and
  RRT-Connect route planning.

Keep changes within these ownership boundaries when practical. Geometry and
motion-planning functions that do not depend on DOM state belong in
`planner.js`.

## Running Locally

ES modules must be served over HTTP. From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

An internet connection is required because Three.js and the fonts are loaded
from CDNs.

## Verification

There is currently no automated browser test suite. Always run:

```sh
node --check app.js
node --check planner.js
git diff --check
```

For geometry, interaction, or solver changes, also test the affected workflow
in a browser. At minimum verify:

1. Create, move, edit, attach, detach, and delete blocks.
2. Confirm the model and select distinct entrance and exit faces.
3. Run the automatic solver with zero and nonzero clearance.
4. Start manual mode and verify the furniture begins fully outside the
   entrance.
5. Verify furniture crosses only through the entrance or exit and cannot pass
   through other walls.
6. Verify the manual win state occurs only after fully passing through the
   exit.
7. Save and reload a project after structural changes.

## Geometry Conventions

- A block is represented by origin `O` and edge vectors `A`, `B`, and `C`.
- Vertex, face, and edge ordering is centralized near the top of `app.js` in
  `faces`, `faceQuads`, `faceNames`, `edgePairs`, and `edgeFamilies`.
- Do not reorder those arrays independently. Face indices are persisted in
  project files and referenced by attachments and entrance/exit selections.
- World-space block volumes use `{ origin, a, b, c }`.
- Furniture poses use `{ x, y, z, yaw, pitch, roll }`.
- `poseQuaternion()` uses Euler order `"ZYX"`. Preserve this convention across
  rendering, collision detection, interpolation, and serialization.
- Clearance expands every furniture half-dimension. It is enforced in both
  automatic and manual modes.

## Face Normals And Openings

`outwardFaceFrame()` in `app.js` is the authority for exterior face direction.
It probes both sides of a face against the block volume and flips the normal
when necessary. Do not infer outward direction from triangle winding alone.

Opening data contains:

- world-space `center`, `normal`, `u`, and `v`
- `uLimit` and `vLimit`
- a projected parallelogram `polygon`

Manual traversal uses portal-aware validation from `planner.js`:

- Before entry, furniture may occupy the staging area outside the entrance.
- Crossing the room boundary is allowed only through the entrance polygon.
- Once fully inside, only the entrance and exit are valid portals.
- Other exterior faces remain solid.

When changing manual start placement, verify every clearance-expanded furniture
vertex is outside all room volumes. The start position is produced by
`createOutsideEntrancePose()` in `app.js`.

## Solver Guidance

The automatic planner is probabilistic RRT-Connect. A failed search does not
prove that no route exists.

- Keep collision validation authoritative; do not improve success rates by
  silently reducing clearance.
- Prefer better sampling, useful orientation candidates, retries, or search
  limits over weakening wall constraints.
- Validate every returned and smoothed edge with `isEdgeValid()`.
- Avoid long synchronous loops that freeze the UI. The planner periodically
  yields through the progress callback loop.

## Editing Practices

- Preserve the current dependency-free, static-site architecture unless a
  larger migration is explicitly requested.
- Use existing DOM IDs and CSS patterns before adding new abstractions.
- Dispose replaced Three.js geometries, materials, and textures.
- Keep unrelated user changes intact; the working tree may already be dirty.
- Project JSON changes require careful compatibility handling. Increment
  `PROJECT_VERSION` only when old saved projects cannot be safely interpreted.
- Use ASCII in source unless existing UI text requires otherwise.
- Update AGENTS.md when you make major changes.

