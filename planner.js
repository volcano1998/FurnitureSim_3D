import * as THREE from "three";

const TAU = Math.PI * 2;

export function poseQuaternion(pose) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose.pitch, pose.roll, pose.yaw, "ZYX"),
  );
}

export function furnitureVertices(pose, furniture, clearance = 0) {
  const half = {
    x: furniture.length / 2 + clearance,
    y: furniture.width / 2 + clearance,
    z: furniture.height / 2 + clearance,
  };
  const quaternion = poseQuaternion(pose);
  const center = new THREE.Vector3(pose.x, pose.y, pose.z);
  const vertices = [];
  [-1, 1].forEach((x) => {
    [-1, 1].forEach((y) => {
      [-1, 1].forEach((z) => {
        vertices.push(
          new THREE.Vector3(x * half.x, y * half.y, z * half.z)
            .applyQuaternion(quaternion)
            .add(center),
        );
      });
    });
  });
  return vertices;
}

export function pointInVolume(point, volume, epsilon = 1e-6) {
  const offset = point.clone().sub(volume.origin);
  const denominator = volume.a.dot(
    new THREE.Vector3().crossVectors(volume.b, volume.c),
  );
  if (Math.abs(denominator) < 1e-10) return false;

  const u = offset.dot(new THREE.Vector3().crossVectors(volume.b, volume.c)) / denominator;
  const v = offset.dot(new THREE.Vector3().crossVectors(volume.c, volume.a)) / denominator;
  const w = offset.dot(new THREE.Vector3().crossVectors(volume.a, volume.b)) / denominator;
  return (
    u >= -epsilon && u <= 1 + epsilon &&
    v >= -epsilon && v <= 1 + epsilon &&
    w >= -epsilon && w <= 1 + epsilon
  );
}

export function isPoseValid(pose, furniture, environment, clearance = 0) {
  const quaternion = poseQuaternion(pose);
  const center = new THREE.Vector3(pose.x, pose.y, pose.z);
  const half = {
    x: furniture.length / 2 + clearance,
    y: furniture.width / 2 + clearance,
    z: furniture.height / 2 + clearance,
  };
  const samples = [-1, -0.5, 0, 0.5, 1];

  for (const x of samples) {
    for (const y of samples) {
      for (const z of samples) {
        if (
          Math.abs(x) !== 1 &&
          Math.abs(y) !== 1 &&
          Math.abs(z) !== 1
        ) {
          continue;
        }
        const point = new THREE.Vector3(
          x * half.x,
          y * half.y,
          z * half.z,
        ).applyQuaternion(quaternion).add(center);
        if (!environment.volumes.some((volume) => pointInVolume(point, volume))) {
          return false;
        }
      }
    }
  }
  return true;
}

export function isPoseValidThroughOpenings(
  pose,
  furniture,
  environment,
  clearance,
  openings,
) {
  const quaternion = poseQuaternion(pose);
  const center = new THREE.Vector3(pose.x, pose.y, pose.z);
  const half = {
    x: furniture.length / 2 + clearance,
    y: furniture.width / 2 + clearance,
    z: furniture.height / 2 + clearance,
  };
  const samples = [-1, -0.5, 0, 0.5, 1];

  for (const x of samples) {
    for (const y of samples) {
      for (const z of samples) {
        if (
          Math.abs(x) !== 1 &&
          Math.abs(y) !== 1 &&
          Math.abs(z) !== 1
        ) {
          continue;
        }
        const point = new THREE.Vector3(
          x * half.x,
          y * half.y,
          z * half.z,
        ).applyQuaternion(quaternion).add(center);
        const inside = environment.volumes.some(
          (volume) => pointInVolume(point, volume),
        );
        if (!inside && !openings.some((opening) =>
          pointPassesThroughOpening(point, opening))) {
          return false;
        }
      }
    }
  }
  return true;
}

function pointPassesThroughOpening(point, opening) {
  const offset = point.clone().sub(opening.center);
  const normalDistance = offset.dot(opening.normal);
  const projected = {
    u: offset.dot(opening.u),
    v: offset.dot(opening.v),
  };
  if (opening.unboundedExterior && normalDistance >= -1e-5) {
    return true;
  }
  if (opening.stagingPadding && normalDistance > 1e-5) {
    return (
      Math.abs(projected.u) <= opening.uLimit + opening.stagingPadding &&
      Math.abs(projected.v) <= opening.vLimit + opening.stagingPadding
    );
  }
  return (
    normalDistance >= -1e-5 &&
    pointInConvexPolygon(projected, opening.polygon)
  );
}

function pointInConvexPolygon(point, polygon) {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross =
      (b.u - a.u) * (point.v - a.v) -
      (b.v - a.v) * (point.u - a.u);
    if (Math.abs(cross) <= 1e-5) continue;
    const edgeSign = Math.sign(cross);
    if (sign && edgeSign !== sign) return false;
    sign = edgeSign;
  }
  return true;
}

export function interpolatePose(a, b, t) {
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    z: THREE.MathUtils.lerp(a.z, b.z, t),
    yaw: a.yaw + shortestAngle(a.yaw, b.yaw) * t,
    pitch: a.pitch + shortestAngle(a.pitch, b.pitch) * t,
    roll: a.roll + shortestAngle(a.roll, b.roll) * t,
  };
}

export function isEdgeValidThroughOpenings(
  poseA,
  poseB,
  furniture,
  environment,
  clearance,
  openings,
  resolution = 0.12,
) {
  const positionDistance = Math.hypot(
    poseB.x - poseA.x,
    poseB.y - poseA.y,
    poseB.z - poseA.z,
  );
  const angularDistance = Math.max(
    Math.abs(shortestAngle(poseA.yaw, poseB.yaw)),
    Math.abs(shortestAngle(poseA.pitch, poseB.pitch)),
    Math.abs(shortestAngle(poseA.roll, poseB.roll)),
  );
  const steps = Math.max(
    2,
    Math.ceil(positionDistance / resolution),
    Math.ceil(angularDistance / THREE.MathUtils.degToRad(3)),
  );
  for (let index = 1; index <= steps; index += 1) {
    if (
      !isPoseValidThroughOpenings(
        interpolatePose(poseA, poseB, index / steps),
        furniture,
        environment,
        clearance,
        openings,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function isEdgeValid(
  poseA,
  poseB,
  furniture,
  environment,
  clearance,
  resolution = 0.12,
) {
  const positionDistance = Math.hypot(
    poseB.x - poseA.x,
    poseB.y - poseA.y,
    poseB.z - poseA.z,
  );
  const angularDistance = Math.max(
    Math.abs(shortestAngle(poseA.yaw, poseB.yaw)),
    Math.abs(shortestAngle(poseA.pitch, poseB.pitch)),
    Math.abs(shortestAngle(poseA.roll, poseB.roll)),
  );
  const steps = Math.max(
    2,
    Math.ceil(positionDistance / resolution),
    Math.ceil(angularDistance / THREE.MathUtils.degToRad(3)),
  );
  for (let index = 1; index <= steps; index += 1) {
    if (
      !isPoseValid(
        interpolatePose(poseA, poseB, index / steps),
        furniture,
        environment,
        clearance,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function openingPoseCandidates(
  opening,
  furniture,
  environment,
  clearance,
  allowRoll = false,
) {
  const candidates = [];
  const yawAngles = Array.from({ length: 24 }, (_, index) => index * TAU / 24);
  const pitchAngles = [0, -15, 15, -30, 30, -45, 45, -60, 60]
    .map(THREE.MathUtils.degToRad);
  const rollAngles = (allowRoll ? [0, -30, 30, -60, 60, 90] : [0])
    .map(THREE.MathUtils.degToRad);

  yawAngles.forEach((yaw) => {
    pitchAngles.forEach((pitch) => {
      rollAngles.forEach((roll) => {
        const base = {
          x: opening.center.x,
          y: opening.center.y,
          z: opening.center.z,
          yaw,
          pitch,
          roll,
        };
        const vertices = furnitureVertices(
          { ...base, x: 0, y: 0, z: 0 },
          furniture,
          clearance,
        );
        const extent = Math.max(
          ...vertices.map((vertex) => Math.abs(vertex.dot(opening.normal))),
        );
        const center = opening.center
          .clone()
          .addScaledVector(opening.normal, -(extent + 0.02));
        const pose = { ...base, x: center.x, y: center.y, z: center.z };
        if (isPoseValid(pose, furniture, environment, clearance)) {
          candidates.push(pose);
        }
      });
    });
  });
  return candidates;
}

export function computeOpeningFrame(opening) {
  const N = opening.normal.clone().negate().normalize();
  let U = opening.v.clone().normalize();
  let T = new THREE.Vector3().crossVectors(U, N).normalize();
  if (T.dot(opening.u) < 0) T.negate();
  U = new THREE.Vector3().crossVectors(N, T).normalize();
  const polygon = opening.polygon.map((point) => {
    const offset = opening.u.clone()
      .multiplyScalar(point.u)
      .addScaledVector(opening.v, point.v);
    return {
      u: offset.dot(T),
      v: offset.dot(U),
    };
  });
  return { center: opening.center.clone(), N, T, U, polygon };
}

function furnitureAxesAndDimensions(furniture) {
  return [
    { name: "length", dimension: furniture.length },
    { name: "width", dimension: furniture.width },
    { name: "height", dimension: furniture.height },
  ];
}

function projectedOpeningFrame(opening, direction) {
  const vertices = opening.vertices ?? opening.polygon.map((point) =>
    opening.center.clone()
      .addScaledVector(opening.u, point.u)
      .addScaledVector(opening.v, point.v));
  let across = null;
  let longest = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const edge = vertices[(index + 1) % vertices.length]
      .clone()
      .sub(vertices[index])
      .addScaledVector(
        direction,
        -vertices[(index + 1) % vertices.length]
          .clone()
          .sub(vertices[index])
          .dot(direction),
      );
    if (edge.lengthSq() > longest) {
      across = edge;
      longest = edge.lengthSq();
    }
  }
  if (!across || longest < 1e-10) return null;
  across.normalize();
  const vertical = new THREE.Vector3()
    .crossVectors(direction, across)
    .normalize();
  const polygon = vertices.map((vertex) => {
    const offset = vertex.clone().sub(opening.center);
    return {
      u: offset.dot(across),
      v: offset.dot(vertical),
    };
  });
  return { across, vertical, polygon };
}

function heuristicOrientations(direction, crossFrame, longestAxis) {
  const remainingAxes = [0, 1, 2].filter((axis) => axis !== longestAxis);
  const orientations = [];
  const seen = new Set();
  [false, true].forEach((swap) => {
    [-1, 1].forEach((sign) => {
      const axes = [];
      axes[longestAxis] = direction.clone();
      axes[remainingAxes[0]] = (swap
        ? crossFrame.vertical
        : crossFrame.across).clone().multiplyScalar(sign);
      axes[remainingAxes[1]] = (swap
        ? crossFrame.across
        : crossFrame.vertical).clone();
      const determinant = axes[0].dot(
        new THREE.Vector3().crossVectors(axes[1], axes[2]),
      );
      if (determinant < 0) axes[remainingAxes[1]].negate();
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(axes[0], axes[1], axes[2]),
      );
      const key = quaternion.toArray().map((value) => value.toFixed(6)).join(":");
      if (!seen.has(key)) {
        seen.add(key);
        orientations.push(quaternion);
      }
    });
  });
  return orientations;
}

function projectedFurnitureFootprint(
  quaternion,
  furniture,
  clearance,
  crossFrame,
) {
  const pose = quaternionPose(new THREE.Vector3(), quaternion);
  const vertices = furnitureVertices(pose, furniture, clearance);
  return vertices.map((vertex) => ({
    u: vertex.dot(crossFrame.across),
    v: vertex.dot(crossFrame.vertical),
  }));
}

function fullyOutsideEnvironment(pose, furniture, environment, clearance) {
  return furnitureVertices(pose, furniture, clearance).every((vertex) =>
    !environment.volumes.some((volume) => pointInVolume(vertex, volume)));
}

function fullyPastExit(pose, furniture, exit, clearance) {
  return furnitureVertices(pose, furniture, clearance).every((vertex) =>
    vertex.clone().sub(exit.center).dot(exit.normal) >= -1e-5);
}

function appendHeuristicSegment(path, from, to, step) {
  const segment = resamplePath([from, to], step);
  if (path.length) segment.shift();
  path.push(...segment);
}

function heuristicCheckpoint(stage, label, pose, path, status, details) {
  return {
    stage,
    label,
    pose: { ...pose },
    index: Math.max(0, path.length - 1),
    status,
    details,
  };
}

function planStraightHeuristicTraversal({
  environment,
  furniture,
  entrance,
  exit,
  config,
}) {
  const clearance = config.clearance ?? 0;
  const direction = entrance.travelDirection?.clone().normalize();
  if (!direction) {
    return {
      possible: false,
      solver: "heuristic",
      path: [],
      checkpoints: [],
      failureStage: "movement-direction",
      failureReason: "The entrance does not define an inward room-edge direction.",
    };
  }

  const dimensions = furnitureAxesAndDimensions(furniture);
  const longestAxis = dimensions
    .map((axis, index) => ({ ...axis, index }))
    .sort((a, b) => b.dimension - a.dimension)[0];
  const smallestFaceAxes = dimensions.filter(
    (_, index) => index !== longestAxis.index,
  );
  const crossFrame = projectedOpeningFrame(entrance, direction);
  if (!crossFrame) {
    return {
      possible: false,
      solver: "heuristic",
      path: [],
      checkpoints: [],
      failureStage: "doorway-projection",
      failureReason: "The entrance projection collapses along the movement direction.",
    };
  }

  const orientations = heuristicOrientations(
    direction,
    crossFrame,
    longestAxis.index,
  );
  const orientation = orientations.find((candidate) =>
    projectedFurnitureFootprint(
      candidate,
      furniture,
      clearance,
      crossFrame,
    ).every((point) => pointInConvexPolygon(point, crossFrame.polygon)));
  const configuration = {
    movementDirection: direction.toArray(),
    smallestFace: smallestFaceAxes.map((axis) => axis.name).join(" x "),
    smallestFaceArea:
      smallestFaceAxes[0].dimension * smallestFaceAxes[1].dimension,
    movementAxis: longestAxis.name,
  };
  if (!orientation) {
    const pose = {
      x: entrance.center.x,
      y: entrance.center.y,
      z: entrance.center.z,
      yaw: 0,
      pitch: 0,
      roll: 0,
    };
    const path = [pose];
    return {
      possible: false,
      solver: "heuristic",
      path,
      configuration,
      checkpoints: [
        heuristicCheckpoint(
          "smallest-face",
          `Smallest face: ${configuration.smallestFace}`,
          pose,
          path,
          "passed",
          `Area ${configuration.smallestFaceArea.toFixed(3)}; ` +
            `${configuration.movementAxis} axis selected for travel.`,
        ),
        heuristicCheckpoint(
          "doorway-fit",
          "Projected doorway fit",
          pose,
          path,
          "failed",
          "The clearance-expanded smallest face does not fit inside the projected entrance.",
        ),
      ],
      failureStage: "doorway-fit",
      failureReason:
        "The furniture's smallest face does not fit in the entrance projection.",
    };
  }

  const alignedAtEntrance = quaternionPose(entrance.center, orientation);
  const furnitureDiagonal = Math.hypot(
    furniture.length + 2 * clearance,
    furniture.width + 2 * clearance,
    furniture.height + 2 * clearance,
  );
  const sceneDiagonal = environment.bounds.getSize(new THREE.Vector3()).length();
  const searchStep = Math.max(0.04, config.positionStep / 2);
  let outsideDistance = furnitureDiagonal / 2 + searchStep;
  let centeredOutside = null;
  while (outsideDistance <= sceneDiagonal + furnitureDiagonal * 2) {
    const center = entrance.center.clone()
      .addScaledVector(direction, -outsideDistance);
    const candidate = quaternionPose(center, orientation);
    if (fullyOutsideEnvironment(candidate, furniture, environment, clearance)) {
      centeredOutside = candidate;
      break;
    }
    outsideDistance += searchStep;
  }
  if (!centeredOutside) {
    return {
      possible: false,
      solver: "heuristic",
      path: [alignedAtEntrance],
      configuration,
      checkpoints: [
        heuristicCheckpoint(
          "outside-start",
          "Find outside staging pose",
          alignedAtEntrance,
          [alignedAtEntrance],
          "failed",
          "No fully outside pose was found behind the centered entrance projection.",
        ),
      ],
      failureStage: "outside-start",
      failureReason: "Could not place the aligned furniture fully outside the entrance.",
    };
  }

  const farCenter = new THREE.Vector3(
    centeredOutside.x,
    centeredOutside.y,
    centeredOutside.z,
  ).addScaledVector(direction, -furnitureDiagonal);
  const offsetDistance = Math.min(
    furnitureDiagonal * 0.2,
    Math.max(0.15, smallestFaceAxes[0].dimension * 0.2),
  );
  const analysisCenter = farCenter.clone()
    .addScaledVector(crossFrame.across, offsetDistance);
  const analysisPose = {
    x: analysisCenter.x,
    y: analysisCenter.y,
    z: analysisCenter.z,
    yaw: 0,
    pitch: 0,
    roll: 0,
  };
  const alignedOffsetPose = quaternionPose(analysisCenter, orientation);
  const alignedCenterPose = quaternionPose(farCenter, orientation);
  const path = [analysisPose];
  const checkpoints = [
    heuristicCheckpoint(
      "smallest-face",
      `Find smallest face: ${configuration.smallestFace}`,
      analysisPose,
      path,
      "passed",
      `Area ${configuration.smallestFaceArea.toFixed(3)}; ` +
        `${configuration.movementAxis} axis will point along room travel.`,
    ),
  ];
  appendHeuristicSegment(
    path,
    analysisPose,
    alignedOffsetPose,
    config.animationStep ?? searchStep,
  );
  checkpoints.push(heuristicCheckpoint(
    "align",
    "Align smallest face perpendicular to travel",
    alignedOffsetPose,
    path,
    "passed",
    `Movement direction (${direction.toArray().map((value) =>
      value.toFixed(3)).join(", ")}).`,
  ));
  appendHeuristicSegment(
    path,
    alignedOffsetPose,
    alignedCenterPose,
    config.animationStep ?? searchStep,
  );
  checkpoints.push(heuristicCheckpoint(
    "center",
    "Center furniture on projected entrance",
    alignedCenterPose,
    path,
    "passed",
    "Furniture cross-section and doorway projection share the same center.",
  ));
  appendHeuristicSegment(
    path,
    alignedCenterPose,
    centeredOutside,
    config.animationStep ?? searchStep,
  );
  checkpoints.push(heuristicCheckpoint(
    "outside-start",
    "Move to entrance staging position",
    centeredOutside,
    path,
    "passed",
    "Furniture is fully outside and centered before traversal.",
  ));

  if (direction.dot(exit.normal) <= 1e-5) {
    checkpoints.push(heuristicCheckpoint(
      "exit-direction",
      "Check exit direction",
      centeredOutside,
      path,
      "failed",
      "The entrance room-edge direction does not point through the exit exterior.",
    ));
    return {
      possible: false,
      solver: "heuristic",
      path,
      checkpoints,
      configuration,
      failureStage: "exit-direction",
      failureReason: "The selected exit is not downstream of the heuristic movement direction.",
    };
  }

  const portals = [
    { ...entrance, unboundedExterior: true },
    { ...exit, unboundedExterior: true },
  ];
  const exitDistance = exit.center.clone()
    .sub(new THREE.Vector3(
      centeredOutside.x,
      centeredOutside.y,
      centeredOutside.z,
    ))
    .dot(direction);
  const maximumDistance = Math.max(
    sceneDiagonal + furnitureDiagonal,
    exitDistance + sceneDiagonal + furnitureDiagonal,
  );
  let entered = false;
  let previous = centeredOutside;
  for (
    let distance = searchStep;
    distance <= maximumDistance + 1e-8;
    distance += searchStep
  ) {
    const candidate = {
      ...centeredOutside,
      x: centeredOutside.x + direction.x * distance,
      y: centeredOutside.y + direction.y * distance,
      z: centeredOutside.z + direction.z * distance,
    };
    if (!isEdgeValidThroughOpenings(
      previous,
      candidate,
      furniture,
      environment,
      clearance,
      portals,
      searchStep / 2,
    )) {
      path.push(candidate);
      checkpoints.push(heuristicCheckpoint(
        "collision",
        "Straight traversal blocked",
        candidate,
        path,
        "failed",
        `Collision after moving ${distance.toFixed(3)} units from staging.`,
      ));
      return {
        possible: false,
        solver: "heuristic",
        path,
        checkpoints,
        configuration,
        failureStage: "collision",
        failureReason: "The heuristic straight path hit a wall or opening edge.",
      };
    }
    path.push(candidate);
    previous = candidate;
    if (!entered && isPoseValid(candidate, furniture, environment, clearance)) {
      entered = true;
      checkpoints.push(heuristicCheckpoint(
        "entered",
        "Furniture fully entered",
        candidate,
        path,
        "passed",
        `Fully inside after ${distance.toFixed(3)} units of travel.`,
      ));
    }
    if (
      fullyPastExit(candidate, furniture, exit, clearance) &&
      fullyOutsideEnvironment(candidate, furniture, environment, clearance)
    ) {
      checkpoints.push(heuristicCheckpoint(
        "exited",
        "Furniture fully exited",
        candidate,
        path,
        "passed",
        `Completed straight traversal after ${distance.toFixed(3)} units.`,
      ));
      return {
        possible: true,
        solver: "heuristic",
        path,
        checkpoints,
        configuration,
        minimumClearanceEstimate: clearance,
      };
    }
  }

  checkpoints.push(heuristicCheckpoint(
    "exit-not-reached",
    "Exit not reached",
    previous,
    path,
    "failed",
    "The straight sweep passed its search range without fully clearing the exit.",
  ));
  return {
    possible: false,
    solver: "heuristic",
    path,
    checkpoints,
    configuration,
    failureStage: "exit-not-reached",
    failureReason: "The heuristic movement line did not fully pass through the selected exit.",
  };
}

function poseFullyInsideVolume(pose, furniture, volume, clearance) {
  const quaternion = poseQuaternion(pose);
  const center = new THREE.Vector3(pose.x, pose.y, pose.z);
  const half = {
    x: furniture.length / 2 + clearance,
    y: furniture.width / 2 + clearance,
    z: furniture.height / 2 + clearance,
  };
  const samples = [-1, -0.5, 0, 0.5, 1];
  for (const x of samples) {
    for (const y of samples) {
      for (const z of samples) {
        if (
          Math.abs(x) !== 1 &&
          Math.abs(y) !== 1 &&
          Math.abs(z) !== 1
        ) {
          continue;
        }
        const point = new THREE.Vector3(
          x * half.x,
          y * half.y,
          z * half.z,
        ).applyQuaternion(quaternion).add(center);
        if (!pointInVolume(point, volume)) return false;
      }
    }
  }
  return true;
}

function connectionRoute(environment, entranceObject, exitObject) {
  if (entranceObject === exitObject) return [];
  const queue = [{ object: entranceObject, route: [] }];
  const visited = new Set([entranceObject]);
  while (queue.length) {
    const current = queue.shift();
    for (const connection of environment.connections ?? []) {
      let next = null;
      let from = null;
      let to = null;
      if (connection.a.object === current.object) {
        next = connection.b.object;
        from = connection.a;
        to = connection.b;
      } else if (connection.b.object === current.object) {
        next = connection.a.object;
        from = connection.b;
        to = connection.a;
      }
      if (!next || visited.has(next)) continue;
      const route = [...current.route, { connection, from, to }];
      if (next === exitObject) return route;
      visited.add(next);
      queue.push({ object: next, route });
    }
  }
  return null;
}

function heuristicOrientationForPortal(portal, furniture, clearance) {
  const direction = portal.travelDirection.clone().normalize();
  const crossFrame = projectedOpeningFrame(portal, direction);
  if (!crossFrame) return null;
  const longestAxis = furnitureAxesAndDimensions(furniture)
    .map((axis, index) => ({ ...axis, index }))
    .sort((a, b) => b.dimension - a.dimension)[0];
  const orientation = heuristicOrientations(
    direction,
    crossFrame,
    longestAxis.index,
  ).find((candidate) =>
    projectedFurnitureFootprint(
      candidate,
      furniture,
      clearance,
      crossFrame,
    ).every((point) => pointInConvexPolygon(point, crossFrame.polygon)));
  return orientation
    ? { direction, orientation, crossFrame, longestAxis }
    : null;
}

function initialHybridHeuristicPath(
  entrance,
  furniture,
  environment,
  config,
) {
  const setup = heuristicOrientationForPortal(
    entrance,
    furniture,
    config.clearance,
  );
  if (!setup) return null;
  const furnitureDiagonal = Math.hypot(
    furniture.length + 2 * config.clearance,
    furniture.width + 2 * config.clearance,
    furniture.height + 2 * config.clearance,
  );
  const step = Math.max(0.04, config.positionStep / 2);
  const sceneDiagonal = environment.bounds.getSize(new THREE.Vector3()).length();
  let distance = furnitureDiagonal / 2 + step;
  let staged = null;
  while (distance <= sceneDiagonal + furnitureDiagonal * 2) {
    const center = entrance.center.clone()
      .addScaledVector(setup.direction, -distance);
    const pose = quaternionPose(center, setup.orientation);
    if (fullyOutsideEnvironment(
      pose,
      furniture,
      environment,
      config.clearance,
    )) {
      staged = pose;
      break;
    }
    distance += step;
  }
  if (!staged) return null;
  const farCenter = new THREE.Vector3(staged.x, staged.y, staged.z)
    .addScaledVector(setup.direction, -furnitureDiagonal);
  const offsetCenter = farCenter.clone()
    .addScaledVector(setup.crossFrame.across, Math.min(0.4, furnitureDiagonal * 0.15));
  const analysisPose = {
    x: offsetCenter.x,
    y: offsetCenter.y,
    z: offsetCenter.z,
    yaw: 0,
    pitch: 0,
    roll: 0,
  };
  const alignedOffset = quaternionPose(offsetCenter, setup.orientation);
  const alignedCenter = quaternionPose(farCenter, setup.orientation);
  const path = [analysisPose];
  const dimensions = furnitureAxesAndDimensions(furniture);
  const faceAxes = dimensions.filter(
    (_, index) => index !== setup.longestAxis.index,
  );
  const checkpoints = [
    heuristicCheckpoint(
      "smallest-face",
      `Find smallest face: ${faceAxes.map((axis) => axis.name).join(" x ")}`,
      analysisPose,
      path,
      "passed",
      `${setup.longestAxis.name} axis selected for the first straight segment.`,
    ),
  ];
  appendHeuristicSegment(
    path,
    analysisPose,
    alignedOffset,
    config.animationStep ?? step,
  );
  checkpoints.push(heuristicCheckpoint(
    "align",
    "Align for Object 1",
    alignedOffset,
    path,
    "passed",
    "Smallest face is perpendicular to the first block's movement direction.",
  ));
  appendHeuristicSegment(
    path,
    alignedOffset,
    alignedCenter,
    config.animationStep ?? step,
  );
  checkpoints.push(heuristicCheckpoint(
    "center",
    "Center on entrance projection",
    alignedCenter,
    path,
    "passed",
    "Furniture is centered on the projected entrance.",
  ));
  appendHeuristicSegment(
    path,
    alignedCenter,
    staged,
    config.animationStep ?? step,
  );
  checkpoints.push(heuristicCheckpoint(
    "outside-start",
    "Entrance staging pose",
    staged,
    path,
    "passed",
    "Furniture is fully outside and ready for the first straight segment.",
  ));
  return {
    path,
    checkpoints,
    pose: staged,
    direction: setup.direction,
    orientation: setup.orientation,
  };
}

function sampleBridgeGoals(
  volume,
  portal,
  furniture,
  environment,
  config,
) {
  const setup = heuristicOrientationForPortal(
    portal,
    furniture,
    config.clearance,
  );
  if (!setup) return [];
  const center = volume.origin.clone()
    .addScaledVector(volume.a, 0.5)
    .addScaledVector(volume.b, 0.5)
    .addScaledVector(volume.c, 0.5);
  const goals = [];
  const fractions = [0.35, 0.5, 0.65];
  fractions.forEach((u) => {
    fractions.forEach((v) => {
      fractions.forEach((w) => {
        const position = volume.origin.clone()
          .addScaledVector(volume.a, u)
          .addScaledVector(volume.b, v)
          .addScaledVector(volume.c, w);
        const pose = quaternionPose(position, setup.orientation);
        if (
          poseFullyInsideVolume(
            pose,
            furniture,
            volume,
            config.clearance,
          ) &&
          isPoseValid(pose, furniture, environment, config.clearance)
        ) {
          goals.push(pose);
        }
      });
    });
  });
  const centered = quaternionPose(center, setup.orientation);
  if (
    poseFullyInsideVolume(centered, furniture, volume, config.clearance) &&
    !goals.some((goal) => poseDistance(goal, centered) < 1e-5)
  ) {
    goals.unshift(centered);
  }
  return goals;
}

async function planRRTBridge({
  startPose,
  goals,
  furniture,
  environment,
  config,
  transition,
  onProgress,
}) {
  if (!goals.length) return null;
  const treeStart = [{ pose: { ...startPose }, parent: -1 }];
  const treeGoal = goals.map((pose) => ({ pose: { ...pose }, parent: -1 }));
  let treeA = treeStart;
  let treeB = treeGoal;
  const bridgeIterations = Math.max(
    1000,
    Math.min(config.maxIterations, Math.ceil(config.maxIterations / 3)),
  );
  for (let iteration = 0; iteration < bridgeIterations; iteration += 1) {
    const target = Math.random() < Math.max(0.25, config.goalBias)
      ? treeB[Math.floor(Math.random() * treeB.length)].pose
      : randomValidPose(environment, furniture, config, environment.bounds);
    const newIndex = extendTree(
      treeA,
      target,
      furniture,
      environment,
      config,
    );
    if (newIndex >= 0) {
      const connectedIndex = connectTree(
        treeB,
        treeA[newIndex].pose,
        furniture,
        environment,
        config,
      );
      if (connectedIndex >= 0) {
        const aPath = tracePath(treeA, newIndex);
        const bPath = tracePath(treeB, connectedIndex);
        const rawPath = treeA === treeStart
          ? [...aPath.reverse(), ...bPath]
          : [...bPath.reverse(), ...aPath];
        return resamplePath(
          smoothPath(rawPath, furniture, environment, config.clearance),
          config.animationStep ?? 0.08,
        );
      }
    }
    [treeA, treeB] = [treeB, treeA];
    if ((iteration + 1) % 100 === 0) {
      onProgress?.({
        phase: "hybrid-rrt",
        transition,
        iteration: iteration + 1,
        maxIterations: bridgeIterations,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return null;
}

export async function planHeuristicTraversal({
  environment,
  furniture,
  entrance,
  exit,
  config,
  onProgress,
}) {
  const route = connectionRoute(
    environment,
    entrance.object,
    exit.object,
  );
  if (!route) {
    return {
      possible: false,
      solver: "heuristic",
      path: [],
      checkpoints: [],
      failureStage: "object-route",
      failureReason:
        "No attachment path connects the entrance object to the exit object.",
    };
  }
  if (route.length === 0) {
    return planStraightHeuristicTraversal({
      environment,
      furniture,
      entrance,
      exit,
      config,
    });
  }

  const initial = initialHybridHeuristicPath(
    entrance,
    furniture,
    environment,
    config,
  );
  if (!initial) {
    return {
      possible: false,
      solver: "heuristic",
      path: [],
      checkpoints: [],
      failureStage: "initial-heuristic",
      failureReason: "Could not construct the initial centered heuristic pose.",
    };
  }

  const path = [...initial.path];
  const checkpoints = [...initial.checkpoints];
  const volumes = new Map(
    environment.volumes.map((volume) => [volume.object, volume]),
  );
  let pose = initial.pose;
  let direction = initial.direction;
  const step = Math.max(0.04, config.positionStep / 2);
  const portals = [
    { ...entrance, unboundedExterior: true },
    { ...exit, unboundedExterior: true },
  ];

  for (let routeIndex = 0; routeIndex <= route.length; routeIndex += 1) {
    const finalSegment = routeIndex === route.length;
    const transition = finalSegment ? null : route[routeIndex];
    const nextVolume = transition
      ? volumes.get(transition.to.object)
      : null;
    let previous = pose;
    let traveled = 0;
    let enteredNextDirectly = false;
    const maximum = environment.bounds.getSize(new THREE.Vector3()).length() * 2;
    while (traveled <= maximum) {
      traveled += step;
      const candidate = {
        ...pose,
        x: pose.x + direction.x * traveled,
        y: pose.y + direction.y * traveled,
        z: pose.z + direction.z * traveled,
      };
      if (!isEdgeValidThroughOpenings(
        previous,
        candidate,
        furniture,
        environment,
        config.clearance,
        portals,
        step / 2,
      )) {
        break;
      }
      path.push(candidate);
      previous = candidate;
      if (
        finalSegment &&
        fullyPastExit(candidate, furniture, exit, config.clearance) &&
        fullyOutsideEnvironment(
          candidate,
          furniture,
          environment,
          config.clearance,
        )
      ) {
        checkpoints.push(heuristicCheckpoint(
          "exited",
          "Furniture fully exited",
          candidate,
          path,
          "passed",
          "The final straight heuristic segment fully cleared the exit.",
        ));
        return {
          possible: true,
          solver: "heuristic",
          path,
          checkpoints,
          minimumClearanceEstimate: config.clearance,
        };
      }
      if (
        nextVolume &&
        poseFullyInsideVolume(
          candidate,
          furniture,
          nextVolume,
          config.clearance,
        )
      ) {
        pose = candidate;
        checkpoints.push(heuristicCheckpoint(
          "next-object",
          `Straight into Object ${transition.to.object.id}`,
          candidate,
          path,
          "passed",
          "Furniture became fully contained; RRT will align it for the next block.",
        ));
        enteredNextDirectly = true;
        break;
      }
    }
    if (finalSegment) {
      path.push({
        ...previous,
        x: previous.x + direction.x * step,
        y: previous.y + direction.y * step,
        z: previous.z + direction.z * step,
      });
      checkpoints.push(heuristicCheckpoint(
        "final-collision",
        "Final heuristic segment blocked",
        path.at(-1),
        path,
        "failed",
        "The furniture hit a boundary before fully clearing the exit.",
      ));
      return {
        possible: false,
        solver: "heuristic",
        path,
        checkpoints,
        failureStage: "final-collision",
        failureReason: "The final straight heuristic segment was blocked.",
      };
    }

    pose = enteredNextDirectly ? pose : previous;
    checkpoints.push(heuristicCheckpoint(
      "boundary-hit",
      enteredNextDirectly
        ? `Align inside Object ${transition.to.object.id}`
        : `Boundary before Object ${transition.to.object.id}`,
      pose,
      path,
      "passed",
      enteredNextDirectly
        ? "Starting an RRT handoff from the fully-inside pose."
        : "Straight motion stopped at the last valid pose; starting an RRT corner bridge.",
    ));
    const goals = sampleBridgeGoals(
      nextVolume,
      transition.to,
      furniture,
      environment,
      config,
    );
    const bridge = await planRRTBridge({
      startPose: pose,
      goals,
      furniture,
      environment,
      config,
      transition: `${transition.from.object.id} -> ${transition.to.object.id}`,
      onProgress,
    });
    if (!bridge) {
      checkpoints.push(heuristicCheckpoint(
        "rrt-bridge",
        `RRT bridge to Object ${transition.to.object.id}`,
        pose,
        path,
        "failed",
        goals.length
          ? "RRT could not connect the boundary pose to a fully-inside target pose."
          : "No aligned pose fits fully inside the next object.",
      ));
      return {
        possible: false,
        solver: "heuristic",
        path,
        checkpoints,
        failureStage: "rrt-bridge",
        failureReason:
          `Could not bridge into Object ${transition.to.object.id}.`,
      };
    }
    bridge.shift();
    path.push(...bridge);
    pose = path.at(-1);
    direction = transition.to.travelDirection.clone().normalize();
    checkpoints.push(heuristicCheckpoint(
      "rrt-bridge",
      `RRT bridge into Object ${transition.to.object.id}`,
      pose,
      path,
      "passed",
      "Furniture is fully inside the next object and aligned for another straight heuristic segment.",
    ));
  }

  return {
    possible: false,
    solver: "heuristic",
    path,
    checkpoints,
    failureStage: "hybrid-incomplete",
    failureReason: "The hybrid heuristic ended before reaching the exit.",
  };
}

function quaternionPose(position, quaternion) {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "ZYX");
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: euler.z,
    pitch: euler.x,
    roll: euler.y,
  };
}

function orientationQuaternion(frame, yaw, pitch, roll) {
  const base = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(frame.N, frame.T, frame.U),
  );
  return new THREE.Quaternion()
    .setFromAxisAngle(frame.U, yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(frame.T, pitch))
    .multiply(new THREE.Quaternion().setFromAxisAngle(frame.N, roll))
    .multiply(base);
}

function projectedFurnitureExtents(quaternion, furniture, clearance, frame) {
  const offsets = furnitureVertices(
    {
      x: 0,
      y: 0,
      z: 0,
      ...quaternionPose(new THREE.Vector3(), quaternion),
    },
    furniture,
    clearance,
  );
  return {
    n: Math.max(...offsets.map((vertex) => Math.abs(vertex.dot(frame.N)))),
    t: Math.max(...offsets.map((vertex) => Math.abs(vertex.dot(frame.T)))),
    u: Math.max(...offsets.map((vertex) => Math.abs(vertex.dot(frame.U)))),
    footprint: offsets.map((vertex) => ({
      u: vertex.dot(frame.T),
      v: vertex.dot(frame.U),
    })),
  };
}

function sampleOffsetRange(minimum, maximum) {
  if (minimum > maximum + 1e-5) return [];
  const values = Array.from(
    { length: 5 },
    (_, index) => THREE.MathUtils.lerp(minimum, maximum, index / 4),
  );
  if (minimum <= 0 && maximum >= 0) values.push(0);
  return [...new Set(values.map((value) => value.toFixed(6)))]
    .map(Number);
}

function footprintFitsOpening(footprint, polygon, tOffset, uOffset) {
  return footprint.every((point) =>
    pointInConvexPolygon(
      {
        u: point.u + tOffset,
        v: point.v + uOffset,
      },
      polygon,
    ));
}

function footprintSlack(footprint, polygon, tOffset, uOffset) {
  let slack = Infinity;
  footprint.forEach((point) => {
    const translated = {
      u: point.u + tOffset,
      v: point.v + uOffset,
    };
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      const edgeU = b.u - a.u;
      const edgeV = b.v - a.v;
      const edgeLength = Math.hypot(edgeU, edgeV);
      if (edgeLength <= 1e-10) continue;
      const cross =
        edgeU * (translated.v - a.v) -
        edgeV * (translated.u - a.u);
      slack = Math.min(slack, Math.abs(cross) / edgeLength);
    }
  });
  return slack;
}

function clearanceEstimate(pose, furniture, environment, config) {
  const increment = Math.max(0.02, config.positionStep / 5);
  const maximum = Math.max(
    increment,
    Math.min(furniture.length, furniture.width, furniture.height) * 0.2,
  );
  let extra = 0;
  for (
    let candidate = increment;
    candidate <= maximum + 1e-8;
    candidate += increment
  ) {
    if (
      !isPoseValid(
        pose,
        furniture,
        environment,
        config.clearance + candidate,
      )
    ) {
      break;
    }
    extra = candidate;
  }
  return extra;
}

export function probePoseIntoHallway(
  pose,
  openingFrame,
  furniture,
  environment,
  config,
) {
  const sceneDepth = environment.bounds.getSize(new THREE.Vector3()).length();
  const maximum = Math.max(
    config.positionStep * 4,
    Math.min(sceneDepth * 0.35, sceneDepth),
  );
  const step = Math.max(0.04, config.positionStep / 2);
  let distance = 0;
  let lastPose = { ...pose };
  for (let probe = step; probe <= maximum + 1e-8; probe += step) {
    const candidate = {
      ...pose,
      x: pose.x + openingFrame.N.x * probe,
      y: pose.y + openingFrame.N.y * probe,
      z: pose.z + openingFrame.N.z * probe,
    };
    if (
      !isEdgeValid(
        lastPose,
        candidate,
        furniture,
        environment,
        config.clearance,
        step / 2,
      )
    ) {
      break;
    }
    distance = probe;
    lastPose = candidate;
  }
  return { distance, pose: lastPose };
}

function candidateScore(candidate) {
  const tiltPenalty =
    Math.abs(candidate.samplePitch) + Math.abs(candidate.sampleRoll);
  return (
    candidate.probeDistance * 12 +
    candidate.clearanceEstimate * 8 +
    candidate.alignment * 3 -
    tiltPenalty * 0.35 -
    candidate.offsetMagnitude * 0.08
  );
}

export function rankCandidatePoses(candidates) {
  return [...candidates].sort((a, b) => b.score - a.score);
}

function candidateFromSample({
  opening,
  frame,
  furniture,
  environment,
  config,
  yaw,
  pitch,
  roll,
  tOffset,
  uOffset,
}) {
  const quaternion = orientationQuaternion(frame, yaw, pitch, roll);
  const extents = projectedFurnitureExtents(
    quaternion,
    furniture,
    config.clearance,
    frame,
  );
  if (!footprintFitsOpening(
    extents.footprint,
    frame.polygon,
    tOffset,
    uOffset,
  )) {
    return null;
  }
  const center = frame.center
    .clone()
    .addScaledVector(frame.T, tOffset)
    .addScaledVector(frame.U, uOffset)
    .addScaledVector(frame.N, extents.n + 0.02);
  const pose = quaternionPose(center, quaternion);
  if (!isPoseValid(pose, furniture, environment, config.clearance)) return null;
  const longestAxis = [
    { length: furniture.length, axis: new THREE.Vector3(1, 0, 0) },
    { length: furniture.width, axis: new THREE.Vector3(0, 1, 0) },
    { length: furniture.height, axis: new THREE.Vector3(0, 0, 1) },
  ].sort((a, b) => b.length - a.length)[0].axis
    .applyQuaternion(quaternion)
    .normalize();
  return {
    pose,
    quaternion,
    extents,
    sampleYaw: yaw,
    samplePitch: pitch,
    sampleRoll: roll,
    tOffset,
    uOffset,
    offsetMagnitude: Math.hypot(tOffset, uOffset),
    alignment: Math.abs(longestAxis.dot(frame.N)),
    openingSlack: footprintSlack(
      extents.footprint,
      frame.polygon,
      tOffset,
      uOffset,
    ),
  };
}

async function sampleOrientationGrid({
  opening,
  furniture,
  environment,
  config,
  frame,
  samples,
  onProgress,
}) {
  const candidates = [];
  let checked = 0;
  for (const { yaw, pitch, roll } of samples) {
    const quaternion = orientationQuaternion(frame, yaw, pitch, roll);
    const extents = projectedFurnitureExtents(
      quaternion,
      furniture,
      config.clearance,
      frame,
    );
    const polygonT = frame.polygon.map((point) => point.u);
    const polygonU = frame.polygon.map((point) => point.v);
    const footprintT = extents.footprint.map((point) => point.u);
    const footprintU = extents.footprint.map((point) => point.v);
    const tOffsets = sampleOffsetRange(
      Math.min(...polygonT) - Math.min(...footprintT),
      Math.max(...polygonT) - Math.max(...footprintT),
    );
    const uOffsets = sampleOffsetRange(
      Math.min(...polygonU) - Math.min(...footprintU),
      Math.max(...polygonU) - Math.max(...footprintU),
    );
    for (const tOffset of tOffsets) {
      for (const uOffset of uOffsets) {
        const candidate = candidateFromSample({
          opening,
          frame,
          furniture,
          environment,
          config,
          yaw,
          pitch,
          roll,
          tOffset,
          uOffset,
        });
        if (candidate) candidates.push(candidate);
      }
    }
    checked += 1;
    if (checked % 80 === 0) {
      onProgress?.({
        phase: "opening",
        checked,
        total: samples.length,
        candidates: candidates.length,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return candidates;
}

function angleSamples(minimum, maximum, stepDegrees) {
  const values = [];
  for (
    let degrees = minimum;
    degrees <= maximum + 1e-8;
    degrees += stepDegrees
  ) {
    values.push(THREE.MathUtils.degToRad(degrees));
  }
  return values;
}

function coarseOrientationSamples(allowRoll) {
  const samples = [];
  const yaws = angleSamples(-180, 165, 5);
  const pitches = angleSamples(-60, 60, 5);
  const rolls = allowRoll ? angleSamples(-90, 90, 10) : [0];
  yaws.forEach((yaw) => {
    pitches.forEach((pitch) => {
      rolls.forEach((roll) => samples.push({ yaw, pitch, roll }));
    });
  });
  return samples;
}

function fineOrientationSamples(seeds, allowRoll) {
  const samples = [];
  const seen = new Set();
  const deltas = [-10, -5, 0, 5, 10].map(THREE.MathUtils.degToRad);
  seeds.forEach((seed) => {
    deltas.forEach((yawDelta) => {
      deltas.forEach((pitchDelta) => {
        (allowRoll ? deltas : [0]).forEach((rollDelta) => {
          const yaw = seed.sampleYaw + yawDelta;
          const pitch = THREE.MathUtils.clamp(
            seed.samplePitch + pitchDelta,
            -Math.PI / 2,
            Math.PI / 2,
          );
          const roll = seed.sampleRoll + rollDelta;
          const key = [yaw, pitch, roll]
            .map((value) => value.toFixed(5))
            .join(":");
          if (seen.has(key)) return;
          seen.add(key);
          samples.push({ yaw, pitch, roll });
        });
      });
    });
  });
  return samples;
}

export async function sampleEntrancePoses(
  opening,
  furniture,
  environment,
  config,
  onProgress,
) {
  const frame = computeOpeningFrame(opening);
  const coarse = await sampleOrientationGrid({
    opening,
    furniture,
    environment,
    config,
    frame,
    samples: coarseOrientationSamples(config.allowRoll),
    onProgress,
  });
  const coarseShortlist = [...coarse]
    .sort((a, b) => {
      const score = (candidate) =>
        candidate.openingSlack * 3 +
        candidate.alignment * 2 -
        candidate.offsetMagnitude * 0.08 -
        (Math.abs(candidate.samplePitch) +
          Math.abs(candidate.sampleRoll)) * 0.2;
      return score(b) - score(a);
    })
    .slice(0, 180);
  const fine = await sampleOrientationGrid({
    opening,
    furniture,
    environment,
    config,
    frame,
    samples: fineOrientationSamples(coarseShortlist.slice(0, 12), config.allowRoll),
    onProgress,
  });
  const fineShortlist = [...fine]
    .sort((a, b) =>
      b.alignment - a.alignment ||
      a.offsetMagnitude - b.offsetMagnitude)
    .slice(0, 160);
  const unique = new Map();
  [...coarseShortlist, ...fineShortlist].forEach((candidate) => {
    const key = [
      candidate.pose.x,
      candidate.pose.y,
      candidate.pose.z,
      candidate.pose.yaw,
      candidate.pose.pitch,
      candidate.pose.roll,
    ].map((value) => value.toFixed(4)).join(":");
    unique.set(key, candidate);
  });
  const evaluated = [];
  for (const candidate of unique.values()) {
    const probe = probePoseIntoHallway(
      candidate.pose,
      frame,
      furniture,
      environment,
      config,
    );
    candidate.probeDistance = probe.distance;
    candidate.clearanceEstimate = clearanceEstimate(
      probe.pose,
      furniture,
      environment,
      config,
    );
    candidate.score = candidateScore(candidate);
    evaluated.push(candidate);
  }
  return rankCandidatePoses(evaluated);
}

export async function generateStartGoalPoseSets({
  entrance,
  exit,
  furniture,
  environment,
  config,
  onProgress,
}) {
  const topK = config.openingPoseCount ?? 20;
  const startCandidates = await sampleEntrancePoses(
    entrance,
    furniture,
    environment,
    config,
    onProgress,
  );
  const goalCandidates = await sampleEntrancePoses(
    exit,
    furniture,
    environment,
    config,
    onProgress,
  );
  return {
    startCandidates,
    goalCandidates,
    starts: startCandidates.slice(0, topK).map((candidate) => candidate.pose),
    goals: goalCandidates.slice(0, topK).map((candidate) => candidate.pose),
  };
}

function outsidePoseForCandidate(candidate, opening, furniture, config) {
  const frame = computeOpeningFrame(opening);
  const extents = projectedFurnitureExtents(
    candidate.quaternion,
    furniture,
    config.clearance,
    frame,
  );
  const center = frame.center
    .clone()
    .addScaledVector(frame.T, candidate.tOffset)
    .addScaledVector(frame.U, candidate.uOffset)
    .addScaledVector(frame.N, -(extents.n + 0.05));
  return quaternionPose(center, candidate.quaternion);
}

async function entranceConnections(
  entrance,
  furniture,
  environment,
  config,
  rankedCandidates,
) {
  const entranceOpening = { ...entrance, unboundedExterior: true };
  const connections = [];
  for (const candidate of rankedCandidates) {
    const outside = outsidePoseForCandidate(
      candidate,
      entrance,
      furniture,
      config,
    );
    if (
      isEdgeValidThroughOpenings(
        outside,
        candidate.pose,
        furniture,
        environment,
        config.clearance,
        [entranceOpening],
        config.positionStep / 3,
      )
    ) {
      connections.push({
        outside,
        inside: { ...candidate.pose },
      });
    }
    if (connections.length >= (config.openingPoseCount ?? 20)) break;
  }
  return connections;
}

export async function planRRTConnect({
  environment,
  furniture,
  entrance,
  exit,
  startPose = null,
  config,
  onProgress,
}) {
  const topK = config.openingPoseCount ?? 20;
  let startCandidates = [];
  let goalCandidates = [];
  if (startPose) {
    goalCandidates = await sampleEntrancePoses(
      exit,
      furniture,
      environment,
      config,
      onProgress,
    );
  } else {
    const poseSets = await generateStartGoalPoseSets({
      entrance,
      exit,
      furniture,
      environment,
      config,
      onProgress,
    });
    startCandidates = poseSets.startCandidates;
    goalCandidates = poseSets.goalCandidates;
  }
  const entrancePaths = startPose
    ? [{
      outside: null,
      inside: { ...startPose },
    }]
    : await entranceConnections(
      entrance,
      furniture,
      environment,
      config,
      startCandidates,
    );
  const starts = entrancePaths.map(({ inside }) => inside);
  const goals = goalCandidates
    .slice(0, topK)
    .map((candidate) => candidate.pose);
  const bestEntrancePoses = startCandidates
    .slice(0, Math.min(10, topK))
    .map((candidate) => ({
      ...candidate.pose,
      score: candidate.score,
      probeDistance: candidate.probeDistance,
      clearanceEstimate: candidate.clearanceEstimate,
    }));
  const fixedStartValid =
    !startPose ||
    isPoseValid(startPose, furniture, environment, config.clearance);
  if (!fixedStartValid) {
    return {
      possible: false,
      path: [],
      bestEntrancePoses,
      failureStage: "hybrid-start",
      failureReason: "The hybrid start pose is not fully inside.",
    };
  }
  if (!goalCandidates.length) {
    return {
      possible: false,
      path: [],
      bestEntrancePoses,
      failureStage: "exit-poses",
      failureReason:
        "No clearance-valid furniture pose fits fully inside the selected exit.",
    };
  }
  if (!startPose && !startCandidates.length) {
    return {
      possible: false,
      path: [],
      bestEntrancePoses,
      failureStage: "entrance-poses",
      failureReason:
        "No clearance-valid furniture pose fits fully inside the selected entrance.",
    };
  }
  if (!starts.length) {
    return {
      possible: false,
      path: [],
      bestEntrancePoses,
      failureStage: "entrance-traversal",
      failureReason:
        "Valid inside entrance poses were found, but none could cross the entrance polygon from outside.",
    };
  }
  const entrancePathByStart = new Map(
    entrancePaths.map(({ outside, inside }) => [
      inside,
      outside ? [outside, inside] : [inside],
    ]),
  );

  const treeStart = starts.map((pose) => ({ pose, parent: -1 }));
  const treeGoal = goals.map((pose) => ({ pose, parent: -1 }));

  const directPairs = [];
  const directStarts = evenlySpacedCandidates(starts, 48);
  const directGoals = evenlySpacedCandidates(goals, 48);
  directStarts.forEach((start) => {
    directGoals.forEach((goal) => {
      directPairs.push({ start, goal, distance: poseDistance(start, goal) });
    });
  });
  directPairs.sort((a, b) => a.distance - b.distance);
  for (const { start, goal } of directPairs.slice(0, 240)) {
    if (
      isEdgeValid(
        start,
        goal,
        furniture,
        environment,
        config.clearance,
        config.positionStep / 3,
      )
    ) {
      return {
        possible: true,
        path: resamplePath(
          [...entrancePathByStart.get(start), goal],
          config.animationStep ?? 0.08,
        ),
        minimumClearanceEstimate: config.clearance,
      };
    }
  }

  let treeA = treeStart;
  let treeB = treeGoal;
  const bounds = environment.bounds;

  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    const target = Math.random() < config.goalBias
      ? treeB[Math.floor(Math.random() * treeB.length)].pose
      : randomValidPose(
        environment,
        furniture,
        config,
        bounds,
      );
    const newIndex = extendTree(
      treeA,
      target,
      furniture,
      environment,
      config,
    );
    if (newIndex >= 0) {
      const connectedIndex = connectTree(
        treeB,
        treeA[newIndex].pose,
        furniture,
        environment,
        config,
      );
      if (connectedIndex >= 0) {
        const aPath = tracePath(treeA, newIndex);
        const bPath = tracePath(treeB, connectedIndex);
        const rawPath = treeA === treeStart
          ? [...aPath.reverse(), ...bPath]
          : [...bPath.reverse(), ...aPath];
        const path = smoothPath(
          rawPath,
          furniture,
          environment,
          config.clearance,
        );
        const entrancePath = entrancePathByStart.get(path[0]);
        return {
          possible: true,
          path: resamplePath(
            [...entrancePath.slice(0, -1), ...path],
            config.animationStep ?? 0.08,
          ),
          minimumClearanceEstimate: config.clearance,
        };
      }
    }

    [treeA, treeB] = [treeB, treeA];
    if ((iteration + 1) % 100 === 0) {
      onProgress?.({
        phase: "rrt",
        iteration: iteration + 1,
        maxIterations: config.maxIterations,
        nodes: treeStart.length + treeGoal.length,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    possible: false,
    path: [],
    bestEntrancePoses,
    failureReason: "No route found with current search settings.",
  };
}

export async function runMultiStartRRTConnect(options) {
  return planRRTConnect(options);
}

export function smoothPath(path, furniture, environment, clearance) {
  const smoothed = [...path];
  for (let pass = 0; pass < 120 && smoothed.length > 2; pass += 1) {
    const first = Math.floor(Math.random() * (smoothed.length - 2));
    const second = first + 2 + Math.floor(
      Math.random() * (smoothed.length - first - 2),
    );
    if (
      isEdgeValid(
        smoothed[first],
        smoothed[second],
        furniture,
        environment,
        clearance,
      )
    ) {
      smoothed.splice(first + 1, second - first - 1);
    }
  }
  return smoothed;
}

export function resamplePath(path, step = 0.08) {
  if (path.length < 2) return path;
  const frames = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const count = Math.max(2, Math.ceil(distance / step));
    for (let frame = 0; frame < count; frame += 1) {
      frames.push(interpolatePose(a, b, frame / count));
    }
  }
  frames.push(path.at(-1));
  return frames;
}

function extendTree(tree, target, furniture, environment, config) {
  const nearestIndex = nearestNode(tree, target);
  const nearest = tree[nearestIndex].pose;
  const next = stepToward(nearest, target, config);
  if (
    !isEdgeValid(
      nearest,
      next,
      furniture,
      environment,
      config.clearance,
      config.positionStep / 3,
    )
  ) {
    return -1;
  }
  tree.push({ pose: next, parent: nearestIndex });
  return tree.length - 1;
}

function connectTree(tree, target, furniture, environment, config) {
  for (let count = 0; count < 160; count += 1) {
    const index = extendTree(tree, target, furniture, environment, config);
    if (index < 0) return -1;
    if (poseDistance(tree[index].pose, target) < config.positionStep * 0.45) {
      if (
        isEdgeValid(
          tree[index].pose,
          target,
          furniture,
          environment,
          config.clearance,
        )
      ) {
        tree.push({ pose: { ...target }, parent: index });
        return tree.length - 1;
      }
      return -1;
    }
  }
  return -1;
}

function stepToward(from, to, config) {
  const positionDistance = Math.hypot(
    to.x - from.x,
    to.y - from.y,
    to.z - from.z,
  );
  const maxAngle = Math.max(
    Math.abs(shortestAngle(from.yaw, to.yaw)),
    Math.abs(shortestAngle(from.pitch, to.pitch)),
    Math.abs(shortestAngle(from.roll, to.roll)),
  );
  const factor = Math.min(
    1,
    config.positionStep / Math.max(positionDistance, 1e-9),
    config.angleStep / Math.max(maxAngle, 1e-9),
  );
  return interpolatePose(from, to, factor);
}

function nearestNode(tree, target) {
  let nearest = 0;
  let nearestDistance = Infinity;
  tree.forEach((node, index) => {
    const distance = poseDistance(node.pose, target);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function poseDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) +
    0.2 * Math.abs(shortestAngle(a.yaw, b.yaw)) +
    0.2 * Math.abs(shortestAngle(a.pitch, b.pitch)) +
    0.2 * Math.abs(shortestAngle(a.roll, b.roll));
}

function tracePath(tree, index) {
  const path = [];
  while (index >= 0) {
    path.push(tree[index].pose);
    index = tree[index].parent;
  }
  return path;
}

function randomPose(bounds, allowRoll = false) {
  return {
    x: THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, Math.random()),
    y: THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, Math.random()),
    z: THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, Math.random()),
    yaw: Math.random() * TAU - Math.PI,
    pitch: (Math.random() - 0.5) * Math.PI * 0.75,
    roll: allowRoll ? (Math.random() - 0.5) * Math.PI * 0.5 : 0,
  };
}

function randomValidPose(environment, furniture, config, bounds) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const volume =
      environment.volumes[
        Math.floor(Math.random() * environment.volumes.length)
      ];
    const center = volume.origin
      .clone()
      .addScaledVector(volume.a, Math.random())
      .addScaledVector(volume.b, Math.random())
      .addScaledVector(volume.c, Math.random());
    const useAlignedAngles = Math.random() < 0.7;
    const pose = {
      x: center.x,
      y: center.y,
      z: center.z,
      yaw: useAlignedAngles
        ? Math.round(Math.random() * 24) * TAU / 24
        : Math.random() * TAU - Math.PI,
      pitch: useAlignedAngles
        ? THREE.MathUtils.degToRad(
          [-60, -45, -30, -15, 0, 15, 30, 45, 60][
            Math.floor(Math.random() * 9)
          ],
        )
        : (Math.random() - 0.5) * Math.PI * 0.9,
      roll: config.allowRoll
        ? (useAlignedAngles
          ? THREE.MathUtils.degToRad(
            [-90, -60, -30, 0, 30, 60, 90][
              Math.floor(Math.random() * 7)
            ],
          )
          : (Math.random() - 0.5) * Math.PI)
        : 0,
    };
    if (
      isPoseValid(
        pose,
        furniture,
        environment,
        config.clearance,
      )
    ) {
      return pose;
    }
  }
  return randomPose(bounds, config.allowRoll);
}

function evenlySpacedCandidates(candidates, limit) {
  if (candidates.length <= limit) return candidates;
  return Array.from(
    { length: limit },
    (_, index) => candidates[
      Math.floor(index * candidates.length / limit)
    ],
  );
}

function shortestAngle(from, to) {
  return THREE.MathUtils.euclideanModulo(to - from + Math.PI, TAU) - Math.PI;
}
