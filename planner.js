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

export function openingPoseCandidates(opening, furniture, environment, clearance) {
  const candidates = [];
  const yawAngles = Array.from({ length: 12 }, (_, index) => index * TAU / 12);
  const pitchAngles = [0, -15, 15, -30, 30].map(THREE.MathUtils.degToRad);

  yawAngles.forEach((yaw) => {
    pitchAngles.forEach((pitch) => {
      const base = {
        x: opening.center.x,
        y: opening.center.y,
        z: opening.center.z,
        yaw,
        pitch,
        roll: 0,
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
  return candidates;
}

export async function planRRTConnect({
  environment,
  furniture,
  entrance,
  exit,
  config,
  onProgress,
}) {
  const starts = openingPoseCandidates(
    entrance,
    furniture,
    environment,
    config.clearance,
  );
  const goals = openingPoseCandidates(
    exit,
    furniture,
    environment,
    config.clearance,
  );
  if (!starts.length || !goals.length) {
    return {
      possible: false,
      path: [],
      failureReason: "Furniture does not fit at the selected entrance or exit.",
    };
  }

  const treeStart = starts.map((pose) => ({ pose, parent: -1 }));
  const treeGoal = goals.map((pose) => ({ pose, parent: -1 }));
  let treeA = treeStart;
  let treeB = treeGoal;
  const bounds = environment.bounds;

  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    const target = Math.random() < config.goalBias
      ? treeB[Math.floor(Math.random() * treeB.length)].pose
      : randomPose(bounds, config.allowRoll);
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
        return {
          possible: true,
          path: resamplePath(path, config.animationStep ?? 0.08),
          minimumClearanceEstimate: config.clearance,
        };
      }
    }

    [treeA, treeB] = [treeB, treeA];
    if (iteration % 100 === 0) {
      onProgress?.(iteration, treeStart.length + treeGoal.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    possible: false,
    path: [],
    failureReason: "No route found with current search settings.",
  };
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
  for (let count = 0; count < 80; count += 1) {
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

function shortestAngle(from, to) {
  return THREE.MathUtils.euclideanModulo(to - from + Math.PI, TAU) - Math.PI;
}
