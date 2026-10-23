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
- `manual.js`：Manual dragging "solver" allowing user to attempt solution themselves.

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
7. In Auto Pilot, select a furniture edge and room edge, verify they become
   parallel, and confirm every adjustment slider stops at collisions.
8. Exit Auto Pilot and verify ordinary manual dragging resumes from the
   adjusted pose.
9. Move the furniture fully inside manually, hand off to the solver, and
   verify the automatic route begins at exactly that pose.
10. Apply the 45-degree template and verify the AB faces are parallelograms
   while the other four faces remain rectangular.
11. Save and reload a project after structural changes.

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
`createOutsideEntrancePose()` in `manual.js`.

## Manual Auto Pilot

Auto Pilot is a temporary sub-mode of manual navigation implemented in
`manual.js`.

- The user selects a furniture edge followed by a room edge.
- The furniture edge is aligned parallel to the selected room edge.
- Before entry, if rotating in place is blocked, Auto Pilot may first move the
  furniture farther along the entrance outward normal and then rotate there.
  Both transitions must be portal-aware and collision-validated.
- Twist preserves that parallel direction; U and V offsets use a stable basis
  perpendicular to it.
- Travel moves only along the aligned direction.
- The Auto Pilot travel range must account for projection onto the exit normal
  and the furniture's clearance-expanded diagonal. A room bounding-box
  diagonal alone is insufficient for skewed rooms.
- Auto Pilot travel must treat the first fully-outside exit pose as a valid
  terminal point rather than clamping against the exit boundary.
- During Auto Pilot travel only, the exit opening uses an unbounded exterior
  side so the exit quad itself cannot stop the furniture before success.
- Every alignment and slider transition must use the same portal-aware,
  clearance-expanded collision validation as ordinary manual movement.
- Exiting Auto Pilot keeps the adjusted furniture pose and restores manual
  interaction.

## Shape Templates

The 45-degree two-face template is represented by `angleAB: 45`,
`angleAC: 90`, and `angleBC: 90`. This creates two opposite parallelogram
faces and four rectangular faces. Applying a template must preserve the
selected object's pose and reject geometry that overlaps another object.

## Solver Guidance

The automatic planner is probabilistic RRT-Connect. A failed search does not
prove that no route exists.

- Hybrid mode accepts a user-assisted pose only when the clearance-expanded
  furniture is fully inside. The planner must use that exact pose as its fixed
  start and skip automatic entrance planning.
- Automatic routes begin fully outside the entrance. A portal-aware entrance
  phase may translate and rotate the furniture with the entrance exterior
  unbounded until it connects to a fully-inside seed.
- Automatic start and goal initialization is opening-frame aware. It samples
  lateral and vertical offsets plus coarse 15-degree yaw/pitch/roll
  orientations, refines promising candidates at 5 degrees, probes them inward,
  and ranks them by probe depth, clearance, alignment, offset, and tilt.
- RRT-Connect is multi-start/multi-goal using the top ranked opening poses.
  Failed searches return the best entrance poses for visualization.
- Keep collision validation authoritative; do not improve success rates by
  silently reducing clearance.
- Prefer better sampling, useful orientation candidates, retries, or search
  limits over weakening wall constraints.
- Validate every returned and smoothed edge with `isEdgeValid()`.
- Avoid long synchronous loops that freeze the UI. The planner periodically
  yields through the progress callback loop.

## Heuristic Solver

The straight heuristic solver is deterministic and returns named physical
checkpoints even when it fails.

- The opening's travel direction is the inward block edge family not contained
  in that face: `AB -> C`, `AC -> B`, and `BC -> A`.
- The furniture's smallest-area face is perpendicular to its longest axis.
  Align that longest axis with the travel direction.
- Project the opening along the travel direction and test the
  clearance-expanded furniture cross-section against the projected polygon.
- Center the cross-section on that projection, stage fully outside, then move
  only along the travel direction.
- Validate the entire sweep with the same portal-aware collision checks used by
  manual mode. A failed result must retain its attempted collision pose and
  stage-specific checkpoint for 3D inspection.
- In multi-object models, follow the attachment graph from the entrance object
  to the exit object. Use straight heuristic motion within a block, stop at the
  last valid pose when that motion is blocked, and use fixed-start RRT to reach
  a clearance-valid pose fully inside the next block.
- Every block handoff must end aligned with that block's inward edge direction
  before straight heuristic motion resumes. Do not change the movement
  direction without a collision-validated orientation transition.

## Editing Practices

- Preserve the current dependency-free, static-site architecture unless a
  larger migration is explicitly requested.
- Use existing DOM IDs and CSS patterns before adding new abstractions.
- Dispose replaced Three.js geometries, materials, and textures.
- Keep unrelated user changes intact; the working tree may already be dirty.
- Project JSON changes require careful compatibility handling. Increment
  `PROJECT_VERSION` only when old saved projects cannot be safely interpreted.
- Local ES module URLs use matching revision query tags in `index.html` and
  `app.js`. Whenever `app.js`, `manual.js`, or `planner.js` changes, update all
  local module revision tags together so browsers cannot mix cached versions.
- Use ASCII in source unless existing UI text requires otherwise.
- Update AGENTS.md when you make major changes.
