import * as THREE from "three";

export function createManualModeController({
  scene,
  camera,
  controls,
  renderer,
  furnitureMesh,
  furnitureMaterial,
  clearRouteVisualization,
  selectedSimulationEnvironment,
  readFurnitureInputs,
  setSimulationContext,
  setFurniturePose,
  faceQuads,
  openingPoseCandidates,
  furnitureVertices,
  isEdgeValidThroughOpenings,
  isPoseValid,
  isPoseValidThroughOpenings,
  pointInVolume,
}) {
  const manualTrailPoints = [];
  const manualTrail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x9b59b6,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  manualTrail.renderOrder = 10;
  manualTrail.visible = false;
  scene.add(manualTrail);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragPoint = new THREE.Vector3();
  const manualDragOffset = new THREE.Vector3();

  let simulationEnvironment = null;
  let simulationFurniture = null;
  let manualMode = false;
  let manualPose = null;
  let manualStartPose = null;
  let manualDragging = false;
  let manualDragPointerId = null;
  let manualWon = false;
  let manualHasEntered = false;
  let moveKeyHeld = false;

  function qs(selector) {
    return document.querySelector(selector);
  }

  function setPointer(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function updateManualControls() {
    if (!manualPose) return;
    qs("#manualZ").value = String(manualPose.z);
    qs("#manualZValue").textContent = manualPose.z.toFixed(2);
    qs("#manualYaw").value = String(THREE.MathUtils.radToDeg(manualPose.yaw));
    qs("#manualPitch").value = String(THREE.MathUtils.radToDeg(manualPose.pitch));
    qs("#manualRoll").value = String(THREE.MathUtils.radToDeg(manualPose.roll));
  }

  function clearManualTrail() {
    manualTrailPoints.length = 0;
    manualTrail.geometry.dispose();
    manualTrail.geometry = new THREE.BufferGeometry();
    manualTrail.visible = false;
  }

  function getPose() {
    return manualPose ? { ...manualPose } : null;
  }

  function manualAllowedOpenings() {
    if (!simulationEnvironment || !simulationFurniture) return [];
    if (manualHasEntered) {
      return [simulationEnvironment.entrance, simulationEnvironment.exit];
    }
    return [{
      ...simulationEnvironment.entrance,
      stagingPadding: Math.max(
        simulationFurniture.length,
        simulationFurniture.width,
        simulationFurniture.height,
      ),
    }];
  }

  function isManualPoseValid(pose, clearance) {
    if (!simulationEnvironment || !simulationFurniture) return false;
    return isPoseValidThroughOpenings(
      pose,
      simulationFurniture,
      simulationEnvironment,
      clearance,
      manualAllowedOpenings(),
    );
  }

  function furnitureReachedExit() {
    const exit = simulationEnvironment.exit;
    const center = new THREE.Vector3(manualPose.x, manualPose.y, manualPose.z);
    const offset = center.clone().sub(exit.center);
    const signedNormalDistance = offset.dot(exit.normal);
    const uDistance = Math.abs(offset.dot(exit.u));
    const vDistance = Math.abs(offset.dot(exit.v));
    const openingVertices = faceQuads[exit.faceIndex].map((index) =>
      exit.object.vertices[index]
        .clone()
        .applyQuaternion(exit.object.root.quaternion)
        .add(exit.object.root.position),
    );
    const uLimit = Math.max(
      ...openingVertices.map((vertex) =>
        Math.abs(vertex.clone().sub(exit.center).dot(exit.u))),
    );
    const vLimit = Math.max(
      ...openingVertices.map((vertex) =>
        Math.abs(vertex.clone().sub(exit.center).dot(exit.v))),
    );
    const clearance = Number(qs("#clearance").value) || 0;
    const furnitureOffsets = furnitureVertices(
      manualPose,
      simulationFurniture,
      clearance,
    ).map((vertex) => vertex.sub(center));
    const normalExtent = Math.max(
      ...furnitureOffsets.map((vertex) => Math.abs(vertex.dot(exit.normal))),
    );
    const uExtent = Math.max(
      ...furnitureOffsets.map((vertex) => Math.abs(vertex.dot(exit.u))),
    );
    const vExtent = Math.max(
      ...furnitureOffsets.map((vertex) => Math.abs(vertex.dot(exit.v))),
    );
    const trailingFaceDistance = signedNormalDistance - normalExtent;
    const tolerance = 0.03;
    return (
      trailingFaceDistance >= -tolerance &&
      uDistance + uExtent <= uLimit + tolerance &&
      vDistance + vExtent <= vLimit + tolerance
    );
  }

  function stopManualDrag() {
    manualDragging = false;
    controls.enabled = true;
    renderer.domElement.classList.remove("is-dragging");
    if (
      manualDragPointerId !== null &&
      renderer.domElement.hasPointerCapture(manualDragPointerId)
    ) {
      renderer.domElement.releasePointerCapture(manualDragPointerId);
    }
    manualDragPointerId = null;
  }

  function syncManualStatus(text, valid) {
    const status = qs("#manualStatus");
    status.className = valid ? "is-valid" : "is-invalid";
    status.textContent = text;
  }

  function updateManualPose(recordTrail = false) {
    if (!manualMode || !manualPose) return;
    const clearance = Number(qs("#clearance").value) || 0;
    const fullyInside = isPoseValid(
      manualPose,
      simulationFurniture,
      simulationEnvironment,
      clearance,
    );
    if (fullyInside) manualHasEntered = true;
    const valid = isManualPoseValid(manualPose, clearance);
    setFurniturePose(manualPose, clearance);
    furnitureMaterial.color.setHex(
      valid ? (fullyInside ? 0x2eaf68 : 0xe6b83f) : 0xd94d45,
    );
    updateManualControls();
    const reachedExit = manualHasEntered && valid && furnitureReachedExit();
    syncManualStatus(
      reachedExit
        ? "You win! The furniture passed completely through the exit."
        : manualHasEntered
          ? "Furniture is inside. Only the entrance and exit can cross the boundary."
          : valid
            ? "Entrance phase: align and move the furniture fully inside."
            : "Collision or outside the hallway. Adjust the pose.",
      valid,
    );
    if (reachedExit) {
      manualWon = true;
      stopManualDrag();
    }

    if (valid && recordTrail) {
      const point = new THREE.Vector3(manualPose.x, manualPose.y, manualPose.z);
      const previous = manualTrailPoints.at(-1);
      if (!previous || previous.distanceTo(point) > 0.08) {
        manualTrailPoints.push(point);
        manualTrail.geometry.dispose();
        manualTrail.geometry = new THREE.BufferGeometry().setFromPoints(
          manualTrailPoints,
        );
        manualTrail.visible = manualTrailPoints.length > 1;
      }
    }
  }

  function tryManualPose(candidate, recordTrail = true) {
    if (!manualMode || !manualPose || manualWon) return false;
    const clearance = Number(qs("#clearance").value) || 0;
    const currentValid = isManualPoseValid(manualPose, clearance);
    const openings = manualAllowedOpenings();
    const validPath = currentValid
      ? isEdgeValidThroughOpenings(
        manualPose,
        candidate,
        simulationFurniture,
        simulationEnvironment,
        clearance,
        openings,
        0.04,
      )
      : isPoseValidThroughOpenings(
        candidate,
        simulationFurniture,
        simulationEnvironment,
        clearance,
        openings,
      );
    if (!validPath) {
      syncManualStatus(
        "Blocked by a wall or room boundary. The furniture stayed at its last valid pose.",
        false,
      );
      updateManualControls();
      return false;
    }
    manualPose = { ...candidate };
    updateManualPose(recordTrail);
    return true;
  }

  function createOutsideEntrancePose(orientation, furniture, environment, clearance) {
    const entrance = environment.entrance;
    const localVertices = furnitureVertices(
      { ...orientation, x: 0, y: 0, z: 0 },
      furniture,
      clearance,
    );
    const normalExtent = Math.max(
      ...localVertices.map((vertex) => Math.abs(vertex.dot(entrance.normal))),
    );
    const stagingGap =
      Math.max(furniture.length, furniture.width, furniture.height) * 0.45 +
      clearance +
      0.2;
    let distance = normalExtent + stagingGap;
    let pose;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const center = entrance.center
        .clone()
        .addScaledVector(entrance.normal, distance);
      pose = {
        ...orientation,
        x: center.x,
        y: center.y,
        z: center.z,
      };
      const overlapsRoom = furnitureVertices(
        pose,
        furniture,
        clearance,
      ).some((vertex) =>
        environment.volumes.some((volume) => pointInVolume(vertex, volume)));
      if (!overlapsRoom) return pose;
      distance += Math.max(0.15, normalExtent * 0.2);
    }
    return pose;
  }

  function findManualFallbackPose(environment, furniture, clearance) {
    const opening = environment.entrance;
    const volume = environment.volumes.find(
      (candidate) => candidate.object === opening.object,
    );
    const roomCenter = volume.origin
      .clone()
      .addScaledVector(volume.a, 0.5)
      .addScaledVector(volume.b, 0.5)
      .addScaledVector(volume.c, 0.5);
    const yaws = Array.from(
      { length: 12 },
      (_, index) => index * Math.PI / 6,
    );
    const pitches = [0, -15, 15, -30, 30].map(THREE.MathUtils.degToRad);
    for (let step = 1; step <= 12; step += 1) {
      const center = opening.center.clone().lerp(roomCenter, step / 12);
      for (const yaw of yaws) {
        for (const pitch of pitches) {
          const pose = {
            x: center.x,
            y: center.y,
            z: center.z,
            yaw,
            pitch,
            roll: 0,
          };
          if (isPoseValid(pose, furniture, environment, clearance)) return pose;
        }
      }
    }
    return {
      x: roomCenter.x,
      y: roomCenter.y,
      z: roomCenter.z,
      yaw: 0,
      pitch: 0,
      roll: 0,
    };
  }

  function startManualChallenge() {
    const environment = selectedSimulationEnvironment();
    const furniture = readFurnitureInputs();
    const manualClearance = Number(qs("#clearance").value) || 0;
    if (!environment || Object.values(furniture).some((value) => value <= 0)) {
      qs("#simulationStatus").textContent =
        "Choose valid openings and furniture dimensions first.";
      return false;
    }
    const candidates = openingPoseCandidates(
      environment.entrance,
      furniture,
      environment,
      manualClearance,
    );

    clearRouteVisualization();
    simulationEnvironment = environment;
    simulationFurniture = furniture;
    setSimulationContext(environment, furniture);
    manualMode = true;
    manualWon = false;
    manualHasEntered = false;
    const insideCandidate = candidates.length
      ? candidates.reduce((closest, candidate) => {
        const candidateDistance = new THREE.Vector3(
          candidate.x,
          candidate.y,
          candidate.z,
        ).distanceTo(environment.entrance.center);
        const closestDistance = new THREE.Vector3(
          closest.x,
          closest.y,
          closest.z,
        ).distanceTo(environment.entrance.center);
        return candidateDistance < closestDistance ? candidate : closest;
      })
      : findManualFallbackPose(environment, furniture, manualClearance);
    manualStartPose = createOutsideEntrancePose(
      insideCandidate,
      furniture,
      environment,
      manualClearance,
    );
    manualPose = { ...manualStartPose };
    furnitureMesh.geometry.dispose();
    furnitureMesh.geometry = new THREE.BoxGeometry(
      furniture.length,
      furniture.width,
      furniture.height,
    );
    furnitureMesh.visible = true;
    qs("#manualStage").hidden = false;
    qs("#runSimulation").disabled = true;
    qs("#startManual").disabled = true;
    const manualBounds = environment.bounds.clone().expandByScalar(
      Math.max(furniture.length, furniture.width, furniture.height) +
        manualClearance,
    );
    const zControl = qs("#manualZ");
    zControl.min = String(manualBounds.min.z);
    zControl.max = String(manualBounds.max.z);
    zControl.value = String(manualPose.z);
    clearManualTrail();
    updateManualPose(true);
    qs("#simulationStatus").textContent = candidates.length
      ? `Furniture starts outside. Align it with the entrance using ${manualClearance.toFixed(2)} clearance, then move it in.`
      : "No automatic entrance alignment was found. Rotate the furniture outside and test the opening manually.";
    return true;
  }

  function stopManualChallenge() {
    manualMode = false;
    stopManualDrag();
    manualWon = false;
    manualHasEntered = false;
    manualPose = null;
    manualStartPose = null;
    furnitureMesh.visible = false;
    manualTrail.visible = false;
    qs("#manualStage").hidden = true;
    qs("#runSimulation").disabled = false;
    qs("#startManual").disabled = false;
    controls.enabled = true;
    renderer.domElement.classList.remove("is-dragging");
    setSimulationContext(null, null);
    qs("#simulationStatus").textContent =
      "Manual challenge ended. Run the solver or try again.";
  }

  function resetManualChallenge() {
    if (!manualStartPose) return false;
    manualWon = false;
    manualHasEntered = false;
    manualPose = { ...manualStartPose };
    clearManualTrail();
    updateManualPose(true);
    return true;
  }

  function handlePointerDown(event) {
    if (!manualMode || event.button !== 0) return false;
    if (manualWon) return true;
    if (!moveKeyHeld) return true;
    setPointer(event);
    const furnitureHit = raycaster.intersectObject(furnitureMesh, false)[0];
    if (!furnitureHit) return true;
    manualDragging = true;
    manualDragPointerId = event.pointerId;
    controls.enabled = false;
    renderer.domElement.classList.add("is-dragging");
    renderer.domElement.setPointerCapture(event.pointerId);
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      furnitureHit.point,
    );
    manualDragOffset.copy(furnitureHit.point).sub(furnitureMesh.position);
    event.preventDefault();
    return true;
  }

  function handlePointerMove(event) {
    if (!manualMode) return false;
    if (manualDragging && manualPose) {
      setPointer(event);
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        const desired = dragPoint.clone().sub(manualDragOffset);
        const candidate = {
          ...manualPose,
          x: desired.x,
          y: desired.y,
          z: desired.z,
        };
        if (!tryManualPose(candidate)) {
          let safe = { ...manualPose };
          let blocked = candidate;
          const clearance = Number(qs("#clearance").value) || 0;
          for (let index = 0; index < 14; index += 1) {
            const midpoint = {
              ...manualPose,
              x: (safe.x + blocked.x) / 2,
              y: (safe.y + blocked.y) / 2,
              z: (safe.z + blocked.z) / 2,
            };
            if (
              isEdgeValidThroughOpenings(
                manualPose,
                midpoint,
                simulationFurniture,
                simulationEnvironment,
                clearance,
                manualAllowedOpenings(),
                0.04,
              )
            ) {
              safe = midpoint;
            } else {
              blocked = midpoint;
            }
          }
          if (
            Math.hypot(
              safe.x - manualPose.x,
              safe.y - manualPose.y,
              safe.z - manualPose.z,
            ) > 0.002
          ) {
            manualPose = safe;
            updateManualPose(true);
          }
        }
      }
    }
    return true;
  }

  function handlePointerUp() {
    if (!manualMode && manualDragPointerId === null) return false;
    if (manualDragging) stopManualDrag();
    return true;
  }

  function handleKeyDown(event) {
    if (event.code !== "KeyM" || event.repeat) return false;
    moveKeyHeld = true;
    if (manualMode && !manualWon) {
      qs("#manualStatus").textContent =
        "M held: click and drag the furniture to move it.";
    }
    return true;
  }

  function handleKeyUp(event) {
    if (event.code !== "KeyM") return false;
    moveKeyHeld = false;
    if (manualDragging) stopManualDrag();
    if (manualMode && !manualWon) updateManualPose(false);
    return true;
  }

  function handleBlur() {
    moveKeyHeld = false;
    stopManualDrag();
  }

  return {
    startManualChallenge,
    stopManualChallenge,
    resetManualChallenge,
    clearManualTrail,
    tryManualPose,
    getPose,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    isActive: () => manualMode,
    isWon: () => manualWon,
  };
}
