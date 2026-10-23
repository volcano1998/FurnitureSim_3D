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
  edgePairs,
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

  const autoPilotFurnitureEdges = new THREE.Group();
  autoPilotFurnitureEdges.visible = false;
  furnitureMesh.add(autoPilotFurnitureEdges);
  const autoPilotRoomHighlight = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 1, 12),
    new THREE.MeshBasicMaterial({
      color: 0x2d8ac7,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  autoPilotRoomHighlight.renderOrder = 12;
  autoPilotRoomHighlight.visible = false;
  scene.add(autoPilotRoomHighlight);

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
  let manualEntranceOrientation = null;
  let manualDragging = false;
  let manualDragPointerId = null;
  let manualWon = false;
  let manualHasEntered = false;
  let moveKeyHeld = false;
  let autoPilotState = null;

  function qs(selector) {
    return document.querySelector(selector);
  }

  function setPointer(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function setCylinderBetween(mesh, from, to) {
    const direction = to.clone().sub(from);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize(),
    );
    mesh.scale.set(1, direction.length(), 1);
  }

  function furnitureLocalVertices() {
    const halfLength = simulationFurniture.length / 2;
    const halfWidth = simulationFurniture.width / 2;
    const halfHeight = simulationFurniture.height / 2;
    return [
      new THREE.Vector3(-halfLength, -halfWidth, -halfHeight),
      new THREE.Vector3(halfLength, -halfWidth, -halfHeight),
      new THREE.Vector3(-halfLength, halfWidth, -halfHeight),
      new THREE.Vector3(halfLength, halfWidth, -halfHeight),
      new THREE.Vector3(-halfLength, -halfWidth, halfHeight),
      new THREE.Vector3(halfLength, -halfWidth, halfHeight),
      new THREE.Vector3(-halfLength, halfWidth, halfHeight),
      new THREE.Vector3(halfLength, halfWidth, halfHeight),
    ];
  }

  function rebuildAutoPilotFurnitureEdges() {
    autoPilotFurnitureEdges.children.forEach((edge) => {
      edge.geometry.dispose();
      edge.material.dispose();
    });
    autoPilotFurnitureEdges.clear();
    const vertices = furnitureLocalVertices();
    edgePairs.forEach(([start, end], edgeIndex) => {
      const edge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 1, 10),
        new THREE.MeshBasicMaterial({
          color: 0xf2b84b,
          depthTest: false,
          transparent: true,
          opacity: 0.85,
        }),
      );
      edge.userData.edgeIndex = edgeIndex;
      edge.renderOrder = 12;
      setCylinderBetween(edge, vertices[start], vertices[end]);
      autoPilotFurnitureEdges.add(edge);
    });
  }

  function poseFromQuaternion(pose, quaternion) {
    const euler = new THREE.Euler().setFromQuaternion(quaternion, "ZYX");
    return {
      ...pose,
      yaw: euler.z,
      pitch: euler.x,
      roll: euler.y,
    };
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

  function getInsidePose() {
    if (!manualMode || !manualPose || !simulationEnvironment) return null;
    const clearance = Number(qs("#clearance").value) || 0;
    return isPoseValid(
      manualPose,
      simulationFurniture,
      simulationEnvironment,
      clearance,
    )
      ? { ...manualPose }
      : null;
  }

  function syncManualStartStatus(clearance) {
    qs("#simulationStatus").textContent = qs("#manualIgnoreEntrance").checked
      ? `Furniture starts just outside with ${clearance.toFixed(2)} clearance. Move it through the entrance.`
      : "Furniture starts inside at the entrance-aligned pose.";
  }

  function manualAllowedOpenings() {
    if (!simulationEnvironment || !simulationFurniture) return [];
    if (manualHasEntered) {
      return [simulationEnvironment.entrance, simulationEnvironment.exit];
    }
    return [{
      ...simulationEnvironment.entrance,
      unboundedExterior: qs("#manualIgnoreEntrance").checked,
      stagingPadding: Math.max(
        simulationFurniture.length,
        simulationFurniture.width,
        simulationFurniture.height,
      ),
    }];
  }

  function autoPilotTravelOpenings() {
    if (!manualHasEntered) return manualAllowedOpenings();
    return [
      simulationEnvironment.entrance,
      {
        ...simulationEnvironment.exit,
        unboundedExterior: true,
      },
    ];
  }

  function isManualPoseValid(
    pose,
    clearance,
    openings = manualAllowedOpenings(),
  ) {
    if (!simulationEnvironment || !simulationFurniture) return false;
    return isPoseValidThroughOpenings(
      pose,
      simulationFurniture,
      simulationEnvironment,
      clearance,
      openings,
    );
  }

  function furnitureReachedExit(
    pose = manualPose,
    requireOpeningFit = true,
  ) {
    const exit = simulationEnvironment.exit;
    const center = new THREE.Vector3(pose.x, pose.y, pose.z);
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
      pose,
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
      (
        !requireOpeningFit ||
        (
          uDistance + uExtent <= uLimit + tolerance &&
          vDistance + vExtent <= vLimit + tolerance
        )
      )
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

  function updateManualPose(
    recordTrail = false,
    openings = manualAllowedOpenings(),
    ignoreExitQuad = false,
  ) {
    if (!manualMode || !manualPose) return;
    const clearance = Number(qs("#clearance").value) || 0;
    const fullyInside = isPoseValid(
      manualPose,
      simulationFurniture,
      simulationEnvironment,
      clearance,
    );
    if (fullyInside) manualHasEntered = true;
    qs("#continueWithSolver").disabled = !fullyInside || manualWon;
    const valid = isManualPoseValid(manualPose, clearance, openings);
    setFurniturePose(manualPose, clearance);
    furnitureMaterial.color.setHex(
      valid ? (fullyInside ? 0x2eaf68 : 0xe6b83f) : 0xd94d45,
    );
    updateManualControls();
    const reachedExit =
      manualHasEntered &&
      valid &&
      furnitureReachedExit(manualPose, !ignoreExitQuad);
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

  function isManualTransitionValid(
    from,
    to,
    openings = manualAllowedOpenings(),
  ) {
    const clearance = Number(qs("#clearance").value) || 0;
    return isManualPoseValid(from, clearance, openings)
      ? isEdgeValidThroughOpenings(
        from,
        to,
        simulationFurniture,
        simulationEnvironment,
        clearance,
        openings,
        0.04,
      )
      : isPoseValidThroughOpenings(
        to,
        simulationFurniture,
        simulationEnvironment,
        clearance,
        openings,
      );
  }

  function setAutoPilotControlsEnabled(enabled) {
    [
      "#autoPilotTwist",
      "#autoPilotOffsetU",
      "#autoPilotOffsetV",
      "#autoPilotTravel",
    ].forEach((selector) => {
      qs(selector).disabled = !enabled;
    });
  }

  function setManualPoseControlsEnabled(enabled) {
    [
      "#manualZ",
      "#manualYaw",
      "#manualPitch",
      "#manualRoll",
    ].forEach((selector) => {
      qs(selector).disabled = !enabled;
    });
  }

  function syncAutoPilotControls() {
    if (!autoPilotState?.values) return;
    const fields = [
      ["Twist", "twist", "°", 0],
      ["OffsetU", "offsetU", "", 2],
      ["OffsetV", "offsetV", "", 2],
      ["Travel", "travel", "", 2],
    ];
    fields.forEach(([suffix, key, unit, digits]) => {
      qs(`#autoPilot${suffix}`).value = String(autoPilotState.values[key]);
      qs(`#autoPilot${suffix}Value`).textContent =
        `${autoPilotState.values[key].toFixed(digits)}${unit}`;
    });
  }

  function autoPilotPose(values) {
    const twist = new THREE.Quaternion().setFromAxisAngle(
      autoPilotState.axis,
      THREE.MathUtils.degToRad(values.twist),
    );
    const quaternion = twist.multiply(autoPilotState.alignedQuaternion.clone());
    const position = autoPilotState.basePosition
      .clone()
      .addScaledVector(autoPilotState.u, values.offsetU)
      .addScaledVector(autoPilotState.v, values.offsetV)
      .addScaledVector(autoPilotState.axis, values.travel);
    return poseFromQuaternion(
      {
        ...autoPilotState.basePose,
        x: position.x,
        y: position.y,
        z: position.z,
      },
      quaternion,
    );
  }

  function applyAutoPilotControl(key, requestedValue) {
    if (
      autoPilotState?.phase !== "adjust" ||
      !manualPose ||
      manualWon
    ) {
      return false;
    }
    const previousValue = autoPilotState.values[key];
    if (key === "travel") {
      const openings = autoPilotTravelOpenings();
      const distance = Math.abs(requestedValue - previousValue);
      const steps = Math.max(1, Math.ceil(distance / 0.04));
      let acceptedValue = previousValue;
      let acceptedPose = { ...manualPose };
      let stoppedAtExit = false;
      let blockedValue = null;

      for (let index = 1; index <= steps; index += 1) {
        const sampleValue = THREE.MathUtils.lerp(
          previousValue,
          requestedValue,
          index / steps,
        );
        const samplePose = autoPilotPose({
          ...autoPilotState.values,
          travel: sampleValue,
        });
        if (!isManualTransitionValid(acceptedPose, samplePose, openings)) {
          blockedValue = sampleValue;
          break;
        }
        acceptedValue = sampleValue;
        acceptedPose = samplePose;
        if (
          manualHasEntered &&
          furnitureReachedExit(samplePose, false)
        ) {
          stoppedAtExit = true;
          break;
        }
      }

      if (blockedValue !== null) {
        let safeValue = acceptedValue;
        let safePose = acceptedPose;
        for (let index = 0; index < 18; index += 1) {
          const midpointValue = (safeValue + blockedValue) / 2;
          const midpointPose = autoPilotPose({
            ...autoPilotState.values,
            travel: midpointValue,
          });
          if (isManualTransitionValid(safePose, midpointPose, openings)) {
            safeValue = midpointValue;
            safePose = midpointPose;
          } else {
            blockedValue = midpointValue;
          }
        }
        acceptedValue = safeValue;
        acceptedPose = safePose;
      }

      autoPilotState.values.travel = acceptedValue;
      manualPose = { ...acceptedPose };
      updateManualPose(true, openings, true);
      if (stoppedAtExit) setAutoPilotControlsEnabled(false);
      syncAutoPilotControls();
      qs("#autoPilotStatus").textContent = stoppedAtExit
        ? "Furniture is fully outside the exit."
        : blockedValue !== null
          ? "Stopped at the nearest collision-free position."
          : "Edges remain parallel. Adjust the pose or travel along the direction.";
      return true;
    }

    const requestedValues = {
      ...autoPilotState.values,
      [key]: requestedValue,
    };
    let acceptedValue = requestedValue;
    let acceptedPose = autoPilotPose(requestedValues);
    let blocked = !isManualTransitionValid(manualPose, acceptedPose);

    if (blocked) {
      let safeValue = previousValue;
      let blockedValue = requestedValue;
      let safePose = { ...manualPose };
      for (let index = 0; index < 18; index += 1) {
        const midpointValue = (safeValue + blockedValue) / 2;
        const midpointPose = autoPilotPose({
          ...autoPilotState.values,
          [key]: midpointValue,
        });
        if (isManualTransitionValid(manualPose, midpointPose)) {
          safeValue = midpointValue;
          safePose = midpointPose;
        } else {
          blockedValue = midpointValue;
        }
      }
      acceptedValue = safeValue;
      acceptedPose = safePose;
    }

    autoPilotState.values[key] = acceptedValue;
    manualPose = { ...acceptedPose };
    updateManualPose(true);
    syncAutoPilotControls();
    qs("#autoPilotStatus").textContent = blocked
      ? "Stopped at the nearest collision-free position."
      : "Edges remain parallel. Adjust the pose or travel along the direction.";
    return true;
  }

  function roomEdgeSelectionMeshes() {
    const uniqueObjects = new Set(
      simulationEnvironment.volumes.map((volume) => volume.object),
    );
    return [...uniqueObjects].flatMap((object) => object.edgeMeshes);
  }

  function selectAutoPilotFurnitureEdge(edgeMesh) {
    autoPilotFurnitureEdges.children.forEach((edge) => {
      edge.material.color.setHex(
        edge === edgeMesh ? 0xff6b35 : 0xf2b84b,
      );
    });
    autoPilotState.furnitureEdgeIndex = edgeMesh.userData.edgeIndex;
    autoPilotState.phase = "room-edge";
    qs("#autoPilotStatus").textContent =
      "Furniture edge selected. Click the room edge it should follow.";
  }

  function findAutoPilotAlignmentPose(alignedQuaternion) {
    const alignedPose = poseFromQuaternion(manualPose, alignedQuaternion);
    if (isManualTransitionValid(manualPose, alignedPose)) {
      return {
        stagingPose: null,
        alignedPose,
      };
    }
    if (manualHasEntered) return null;

    const entranceOpening = {
      ...simulationEnvironment.entrance,
      unboundedExterior: true,
    };
    const openings = [entranceOpening];
    const sceneSize = simulationEnvironment.bounds
      .getSize(new THREE.Vector3())
      .length();
    const furnitureSize = Math.max(
      simulationFurniture.length,
      simulationFurniture.width,
      simulationFurniture.height,
    );
    const maxDistance = Math.max(sceneSize, furnitureSize * 2);
    const step = Math.max(0.1, furnitureSize / 12);

    for (let distance = step; distance <= maxDistance; distance += step) {
      const stagingPose = {
        ...manualPose,
        x: manualPose.x + entranceOpening.normal.x * distance,
        y: manualPose.y + entranceOpening.normal.y * distance,
        z: manualPose.z + entranceOpening.normal.z * distance,
      };
      if (!isManualTransitionValid(manualPose, stagingPose, openings)) continue;
      const stagedAlignedPose = poseFromQuaternion(
        stagingPose,
        alignedQuaternion,
      );
      if (
        isManualTransitionValid(
          stagingPose,
          stagedAlignedPose,
          openings,
        )
      ) {
        return {
          stagingPose,
          alignedPose: stagedAlignedPose,
        };
      }
    }
    return null;
  }

  function selectAutoPilotRoomEdge(edgeMesh) {
    const roomObject = simulationEnvironment.volumes
      .map((volume) => volume.object)
      .find((object) => object.edgeMeshes.includes(edgeMesh));
    if (!roomObject) return false;
    const roomEdgeIndex = roomObject.edgeMeshes.indexOf(edgeMesh);
    const [roomStartIndex, roomEndIndex] = edgePairs[roomEdgeIndex];
    const roomStart = roomObject.vertices[roomStartIndex]
      .clone()
      .applyQuaternion(roomObject.root.quaternion)
      .add(roomObject.root.position);
    const roomEnd = roomObject.vertices[roomEndIndex]
      .clone()
      .applyQuaternion(roomObject.root.quaternion)
      .add(roomObject.root.position);
    const targetDirection = roomEnd.clone().sub(roomStart).normalize();

    const localVertices = furnitureLocalVertices();
    const [furnitureStartIndex, furnitureEndIndex] =
      edgePairs[autoPilotState.furnitureEdgeIndex];
    const localDirection = localVertices[furnitureEndIndex]
      .clone()
      .sub(localVertices[furnitureStartIndex])
      .normalize();
    const currentQuaternion = furnitureMesh.quaternion.clone();
    const currentDirection = localDirection
      .clone()
      .applyQuaternion(currentQuaternion)
      .normalize();
    if (currentDirection.dot(targetDirection) < 0) targetDirection.negate();

    const alignment = new THREE.Quaternion().setFromUnitVectors(
      currentDirection,
      targetDirection,
    );
    const alignedQuaternion = alignment.multiply(currentQuaternion);
    const alignmentPoses = findAutoPilotAlignmentPose(alignedQuaternion);
    if (!alignmentPoses) {
      qs("#autoPilotStatus").textContent =
        "That alignment is blocked even after moving farther outside.";
      return false;
    }
    if (alignmentPoses.stagingPose) {
      manualPose = { ...alignmentPoses.stagingPose };
      updateManualPose(true, [{
        ...simulationEnvironment.entrance,
        unboundedExterior: true,
      }]);
    }
    manualPose = { ...alignmentPoses.alignedPose };
    updateManualPose(true, manualHasEntered
      ? manualAllowedOpenings()
      : [{
        ...simulationEnvironment.entrance,
        unboundedExterior: true,
      }]);

    const reference = Math.abs(targetDirection.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3()
      .crossVectors(targetDirection, reference)
      .normalize();
    const v = new THREE.Vector3()
      .crossVectors(targetDirection, u)
      .normalize();
    const roomSpan =
      simulationEnvironment.bounds.getSize(new THREE.Vector3()).length();
    const furnitureSpan = Math.hypot(
      simulationFurniture.length + 2 * (Number(qs("#clearance").value) || 0),
      simulationFurniture.width + 2 * (Number(qs("#clearance").value) || 0),
      simulationFurniture.height + 2 * (Number(qs("#clearance").value) || 0),
    );
    const exitProjection = Math.abs(
      targetDirection.dot(simulationEnvironment.exit.normal),
    );
    const travelLimit = Math.max(
      1,
      (roomSpan + furnitureSpan) / Math.max(exitProjection, 0.05),
    );
    const offsetLimit = Math.max(1, roomSpan / 2);

    autoPilotState = {
      ...autoPilotState,
      phase: "adjust",
      roomObject,
      roomEdgeIndex,
      axis: targetDirection,
      u,
      v,
      basePose: { ...manualPose },
      basePosition: new THREE.Vector3(
        manualPose.x,
        manualPose.y,
        manualPose.z,
      ),
      alignedQuaternion,
      values: {
        twist: 0,
        offsetU: 0,
        offsetV: 0,
        travel: 0,
      },
    };
    setCylinderBetween(autoPilotRoomHighlight, roomStart, roomEnd);
    autoPilotRoomHighlight.visible = true;
    autoPilotFurnitureEdges.visible = false;
    qs("#autoPilotTravel").min = String(-travelLimit);
    qs("#autoPilotTravel").max = String(travelLimit);
    qs("#autoPilotOffsetU").min = String(-offsetLimit);
    qs("#autoPilotOffsetU").max = String(offsetLimit);
    qs("#autoPilotOffsetV").min = String(-offsetLimit);
    qs("#autoPilotOffsetV").max = String(offsetLimit);
    setAutoPilotControlsEnabled(true);
    syncAutoPilotControls();
    qs("#autoPilotStatus").textContent =
      alignmentPoses.stagingPose
        ? "Moved farther outside and aligned the edges. Adjust the pose or travel."
        : "Edges are parallel. Adjust the pose, then move along the direction.";
    return true;
  }

  function startAutoPilot() {
    if (!manualMode || !manualPose || manualWon) return false;
    stopManualDrag();
    autoPilotState = {
      phase: "furniture-edge",
      furnitureEdgeIndex: null,
    };
    rebuildAutoPilotFurnitureEdges();
    autoPilotFurnitureEdges.visible = true;
    autoPilotRoomHighlight.visible = false;
    qs("#autoPilotPanel").hidden = false;
    qs("#startAutoPilot").disabled = true;
    setAutoPilotControlsEnabled(false);
    setManualPoseControlsEnabled(false);
    qs("#autoPilotStatus").textContent =
      "Click one of the highlighted furniture edges.";
    return true;
  }

  function stopAutoPilot() {
    autoPilotState = null;
    autoPilotFurnitureEdges.visible = false;
    autoPilotRoomHighlight.visible = false;
    qs("#autoPilotPanel").hidden = true;
    qs("#startAutoPilot").disabled = false;
    setAutoPilotControlsEnabled(false);
    setManualPoseControlsEnabled(true);
    if (manualMode && !manualWon) updateManualPose(false);
    return true;
  }

  function createOutsideEntrancePose(
    orientation,
    furniture,
    environment,
    clearance,
  ) {
    const entrance = environment.entrance;
    const localVertices = furnitureVertices(
      { ...orientation, x: 0, y: 0, z: 0 },
      furniture,
      clearance,
    );
    const normalExtent = Math.max(
      ...localVertices.map((vertex) => Math.abs(vertex.dot(entrance.normal))),
    );
    let distance = normalExtent + 0.05;
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
    stopAutoPilot();
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
    manualEntranceOrientation = { ...insideCandidate };
    manualStartPose = qs("#manualIgnoreEntrance").checked
      ? createOutsideEntrancePose(
        manualEntranceOrientation,
        furniture,
        environment,
        manualClearance,
      )
      : { ...manualEntranceOrientation };
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
    qs("#continueWithSolver").disabled = true;
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
    syncManualStartStatus(manualClearance);
    return true;
  }

  function stopManualChallenge() {
    stopAutoPilot();
    manualMode = false;
    stopManualDrag();
    manualWon = false;
    manualHasEntered = false;
    manualPose = null;
    manualStartPose = null;
    manualEntranceOrientation = null;
    furnitureMesh.visible = false;
    manualTrail.visible = false;
    qs("#manualStage").hidden = true;
    qs("#runSimulation").disabled = false;
    qs("#startManual").disabled = false;
    qs("#continueWithSolver").disabled = true;
    controls.enabled = true;
    renderer.domElement.classList.remove("is-dragging");
    setSimulationContext(null, null);
    qs("#simulationStatus").textContent =
      "Manual challenge ended. Run the solver or try again.";
  }

  function resetManualChallenge() {
    if (!manualStartPose) return false;
    stopAutoPilot();
    const clearance = Number(qs("#clearance").value) || 0;
    manualWon = false;
    manualHasEntered = false;
    manualPose = { ...manualStartPose };
    clearManualTrail();
    updateManualPose(true);
    syncManualStartStatus(clearance);
    return true;
  }

  function updateEntranceOption() {
    if (
      !manualMode ||
      !manualEntranceOrientation ||
      !simulationFurniture ||
      !simulationEnvironment
    ) {
      return false;
    }
    const clearance = Number(qs("#clearance").value) || 0;
    stopAutoPilot();
    manualWon = false;
    manualHasEntered = false;
    manualStartPose = qs("#manualIgnoreEntrance").checked
      ? createOutsideEntrancePose(
        manualEntranceOrientation,
        simulationFurniture,
        simulationEnvironment,
        clearance,
      )
      : { ...manualEntranceOrientation };
    manualPose = { ...manualStartPose };
    clearManualTrail();
    updateManualPose(true);
    return true;
  }

  function handlePointerDown(event) {
    if (!manualMode || event.button !== 0) return false;
    if (manualWon) return true;
    if (autoPilotState) {
      setPointer(event);
      if (autoPilotState.phase === "furniture-edge") {
        const hit = raycaster.intersectObjects(
          autoPilotFurnitureEdges.children,
          false,
        )[0];
        if (hit) {
          selectAutoPilotFurnitureEdge(hit.object);
          event.preventDefault();
        }
      } else if (autoPilotState.phase === "room-edge") {
        const hit = raycaster.intersectObjects(
          roomEdgeSelectionMeshes(),
          false,
        )[0];
        if (hit) {
          selectAutoPilotRoomEdge(hit.object);
          event.preventDefault();
        }
      }
      return true;
    }
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
    getInsidePose,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    updateEntranceOption,
    startAutoPilot,
    stopAutoPilot,
    applyAutoPilotControl,
    isActive: () => manualMode,
    isWon: () => manualWon,
  };
}
