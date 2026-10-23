import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  planHeuristicTraversal,
  planRRTConnect,
  furnitureVertices,
  isEdgeValidThroughOpenings,
  isPoseValid,
  isPoseValidThroughOpenings,
  openingPoseCandidates,
  pointInVolume,
  poseQuaternion,
} from "./planner.js?v=20260607-19";
import { createManualModeController } from "./manual.js?v=20260607-19";

const defaults = {
  aLength: 4,
  bLength: 4,
  cLength: 4,
  angleAB: 90,
  angleAC: 90,
  angleBC: 90,
};
const slantedTemplate = {
  ...defaults,
  angleAB: 45,
};
const PROJECT_FORMAT = "can-it-fit";
const PROJECT_VERSION = 1;
const DEFAULT_MAX_ITERATIONS = 150000;

const faces = [
  [0, 2, 3, 0, 3, 1],
  [4, 5, 7, 4, 7, 6],
  [0, 1, 5, 0, 5, 4],
  [2, 6, 7, 2, 7, 3],
  [0, 4, 6, 0, 6, 2],
  [1, 3, 7, 1, 7, 5],
];
const faceQuads = [
  [0, 2, 3, 1],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 4, 6, 2],
  [1, 3, 7, 5],
];
const faceNames = [
  "AB (−C)",
  "AB (+C)",
  "AC (−B)",
  "AC (+B)",
  "BC (−A)",
  "BC (+A)",
];
const edgePairs = [
  [0, 1], [0, 2], [1, 3], [2, 3],
  [4, 5], [4, 6], [5, 7], [6, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const edgeFamilies = [0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2];
const selectedFaceColor = 0xb9ddf5;
const unselectedFaceColor = 0xd7dadd;
const joinObjectColors = [0x78c7f0, 0xd6a4ef];
const joinFaceColors = [0x209fd8, 0xa85bd0];
const vectorStyles = [
  { name: "A", color: 0xd65748 },
  { name: "B", color: 0x278d61 },
  { name: "C", color: 0x3974bd },
];

const sceneHost = document.querySelector("#scene");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1ec);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 150);
camera.position.set(9, -11, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneHost.appendChild(renderer.domElement);

const previewHost = document.querySelector("#joinPreview");
const previewRenderer = new THREE.WebGLRenderer({ antialias: true });
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
previewHost.appendChild(previewRenderer.domElement);
const previewCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 150);

const topViewHost = document.querySelector("#topView");
const topRenderer = new THREE.WebGLRenderer({ antialias: true });
topRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
topRenderer.outputColorSpace = THREE.SRGBColorSpace;
topViewHost.appendChild(topRenderer.domElement);
const topCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);

const routeVideoHost = document.querySelector("#routeVideo");
const routeVideoRenderer = new THREE.WebGLRenderer({ antialias: true });
routeVideoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
routeVideoRenderer.outputColorSpace = THREE.SRGBColorSpace;
routeVideoHost.appendChild(routeVideoRenderer.domElement);
const routeVideoCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
const routeVideoControls = new OrbitControls(
  routeVideoCamera,
  routeVideoRenderer.domElement,
);
routeVideoControls.enableDamping = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(1.7, 1.4, 1.5);
controls.minDistance = 6;
controls.maxDistance = 70;

scene.add(new THREE.HemisphereLight(0xffffff, 0x637169, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(-5, -7, 12);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d7c9, 1.1);
fillLight.position.set(8, 5, 3);
scene.add(fillLight);

const objects = [];
const attachments = [];
let selectedObject = null;
let nextObjectId = 1;
let nextAttachmentId = 1;
let syncingFields = false;
let joinState = null;
let simulationResult = null;
let simulationEnvironment = null;
let simulationFurniture = null;
let animationFrameIndex = 0;
let animationPlaying = false;
let animationLastTime = 0;
let modelConfirmed = false;
let editorTemporarilyDisabled = false;
let openingPickRole = "entrance";
let openingPickArmed = false;
let openingSignature = "";
let openingSignatureTime = 0;
let openingHighlights = [];
let measurementMode = false;
const measuredFaces = [];
const measurementOverlays = [];

const furnitureMaterial = new THREE.MeshStandardMaterial({
  color: 0x2eaf68,
  roughness: 0.55,
  transparent: true,
  opacity: 0.85,
});
const furnitureMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  furnitureMaterial,
);
furnitureMesh.visible = false;
furnitureMesh.renderOrder = 4;
scene.add(furnitureMesh);

const furniturePreview = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x2eaf68,
    roughness: 0.55,
    transparent: true,
    opacity: 0.85,
  }),
);
furniturePreview.add(
  new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0x1b7a47 }),
  ),
);
furniturePreview.renderOrder = 3;
scene.add(furniturePreview);
let furniturePreviewKey = "";

function updateFurniturePreview() {
  const manualActive = manualModeController.isActive();
  furniturePreview.visible = !furnitureMesh.visible && !manualActive;
  if (!furniturePreview.visible) return;
  const { length, width, height } = readFurnitureInputs();
  if (!(length > 0 && width > 0 && height > 0)) {
    furniturePreview.visible = false;
    return;
  }
  const bounds = new THREE.Box3();
  objects.forEach((object) => {
    worldVertices(object).forEach((vertex) => bounds.expandByPoint(vertex));
  });
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(), new THREE.Vector3());
  const key = [length, width, height, bounds.min.toArray(), bounds.max.toArray()].join();
  if (key === furniturePreviewKey) return;
  furniturePreviewKey = key;
  furniturePreview.scale.set(length, width, height);
  furniturePreview.position.set(
    bounds.max.x + 1 + length / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  );
}

const routeMaterial = new THREE.LineBasicMaterial({
  color: 0x176fa6,
  depthTest: false,
  transparent: true,
  opacity: 0.9,
});
const routeLine = new THREE.Line(new THREE.BufferGeometry(), routeMaterial);
routeLine.visible = false;
routeLine.renderOrder = 9;
scene.add(routeLine);
const routeFrames = new THREE.Group();
scene.add(routeFrames);
const checkpointFrames = new THREE.Group();
scene.add(checkpointFrames);
const measurementLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({
    color: 0xd9ad32,
    depthTest: false,
  }),
);
measurementLine.visible = false;
measurementLine.renderOrder = 11;
scene.add(measurementLine);
const measurementLabel = createLabel("", "#9a7414");
measurementLabel.visible = false;
measurementLabel.renderOrder = 12;
scene.add(measurementLabel);

const manualModeController = createManualModeController({
  scene,
  camera,
  controls,
  renderer,
  furnitureMesh,
  furnitureMaterial,
  clearRouteVisualization,
  selectedSimulationEnvironment,
  readFurnitureInputs,
  setSimulationContext: (environment, furniture) => {
    simulationEnvironment = environment;
    simulationFurniture = furniture;
  },
  setFurniturePose,
  faceQuads,
  edgePairs,
  openingPoseCandidates,
  furnitureVertices,
  isEdgeValidThroughOpenings,
  isPoseValid,
  isPoseValidThroughOpenings,
  pointInVolume,
});

function createSolid(params = defaults, position = new THREE.Vector3()) {
  const root = new THREE.Group();
  root.position.copy(position);
  scene.add(root);

  const positions = new Float32Array(24);
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  faceGeometry.setIndex(faces.flat());
  faces.forEach((face, index) => faceGeometry.addGroup(index * 6, 6, index));

  const materials = faces.map(
    () => new THREE.MeshStandardMaterial({
      color: unselectedFaceColor,
      roughness: 0.72,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  const mesh = new THREE.Mesh(faceGeometry, materials);
  root.add(mesh);

  const edges = new THREE.Group();
  const edgeGeometry = new THREE.CylinderGeometry(0.045, 0.045, 1, 10);
  const edgeMaterials = vectorStyles.map(
    ({ color }) => new THREE.MeshBasicMaterial({ color }),
  );
  const edgeMeshes = edgePairs.map((pair, index) => {
    const edge = new THREE.Mesh(
      edgeGeometry,
      edgeMaterials[edgeFamilies[index]],
    );
    edge.renderOrder = 2;
    edges.add(edge);
    return edge;
  });
  root.add(edges);

  const annotationGroup = new THREE.Group();
  root.add(annotationGroup);
  const vectorLabels = vectorStyles.map(({ name, color }) => {
    const label = createLabel(name, `#${color.toString(16).padStart(6, "0")}`);
    label.visible = document.querySelector("#showAnnotations").checked;
    annotationGroup.add(label);
    return label;
  });

  const object = {
    id: nextObjectId++,
    root,
    mesh,
    materials,
    edges,
    edgeMeshes,
    annotationGroup,
    vectorLabels,
    positions,
    params: { ...params },
    vectors: [],
    vertices: [],
  };
  mesh.userData.object = object;
  objects.push(object);
  applyGeometry(object, calculateGeometry(object.params));
  selectObject(object);
  updateObjectUI();
  return object;
}

function serializeProject() {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    objects: objects.map((object) => ({
      id: object.id,
      params: { ...object.params },
      position: object.root.position.toArray(),
      quaternion: object.root.quaternion.toArray(),
    })),
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      aId: attachment.a.id,
      bId: attachment.b.id,
      faceA: attachment.faceA,
      faceB: attachment.faceB,
      rotation: attachment.rotation,
      offsetU: attachment.offsetU,
      offsetV: attachment.offsetV,
    })),
    selectedObjectId: selectedObject?.id ?? null,
    modelConfirmed,
    entranceId: document.querySelector("#entranceFace").value,
    exitId: document.querySelector("#exitFace").value,
    openingsConfirmed: modelConfirmed,
    furniture: {
      length: Number(document.querySelector("#furnitureLength").value),
      width: Number(document.querySelector("#furnitureWidth").value),
      height: Number(document.querySelector("#furnitureHeight").value),
      clearance: Number(document.querySelector("#clearance").value),
      maxIterations: Number(document.querySelector("#maxIterations").value),
      solverMode: document.querySelector("#solverMode").value,
      allowRoll: document.querySelector("#allowRoll").checked,
    },
    preferences: {
      showAnnotations: document.querySelector("#showAnnotations").checked,
    },
    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    },
  };
}

function validateProject(data) {
  if (
    !data ||
    data.format !== PROJECT_FORMAT ||
    data.version !== PROJECT_VERSION ||
    !Array.isArray(data.objects) ||
    data.objects.length === 0 ||
    !Array.isArray(data.attachments)
  ) {
    throw new Error("This is not a supported Can It Fit? project file.");
  }

  const ids = new Set();
  data.objects.forEach((object) => {
    const params = object.params ?? {};
    if (
      !Number.isInteger(object.id) ||
      ids.has(object.id) ||
      !object.params ||
      !Array.isArray(object.position) ||
      object.position.length !== 3 ||
      !Array.isArray(object.quaternion) ||
      object.quaternion.length !== 4 ||
      !calculateGeometry(object.params)
    ) {
      throw new Error("The project contains invalid object geometry.");
    }
    const numbers = [
      ...Object.values(object.params),
      ...object.position,
      ...object.quaternion,
    ];
    if (numbers.some((value) => !Number.isFinite(value))) {
      throw new Error("The project contains invalid numeric values.");
    }
    if (
      params.aLength <= 0 ||
      params.bLength <= 0 ||
      params.cLength <= 0 ||
      new THREE.Quaternion().fromArray(object.quaternion).lengthSq() < 1e-10
    ) {
      throw new Error("The project contains invalid dimensions or rotation.");
    }
    ids.add(object.id);
  });

  const attachmentIds = new Set();
  data.attachments.forEach((attachment) => {
    if (
      !Number.isInteger(attachment.id) ||
      attachmentIds.has(attachment.id) ||
      !ids.has(attachment.aId) ||
      !ids.has(attachment.bId) ||
      attachment.aId === attachment.bId ||
      !Number.isInteger(attachment.faceA) ||
      !Number.isInteger(attachment.faceB) ||
      attachment.faceA < 0 ||
      attachment.faceA >= faces.length ||
      attachment.faceB < 0 ||
      attachment.faceB >= faces.length
    ) {
      throw new Error("The project contains an invalid attachment.");
    }
    attachmentIds.add(attachment.id);
  });
}

function disposeSolidObject(object) {
  scene.remove(object.root);
  object.mesh.geometry.dispose();
  object.materials.forEach((material) => material.dispose());
  object.edgeMeshes[0]?.geometry.dispose();
  new Set(object.edges.children.map((edge) => edge.material))
    .forEach((material) => material.dispose());
  object.vectorLabels.forEach((label) => {
    label.material.map?.dispose();
    label.material.dispose();
  });
}

function clearProjectScene() {
  if (manualModeController.isActive()) manualModeController.stopManualChallenge();
  clearMeasurement();
  clearRouteVisualization();
  cancelJoin();
  openingHighlights.forEach((highlight) => {
    scene.remove(highlight);
    highlight.geometry.dispose();
    highlight.material.dispose();
  });
  openingHighlights = [];
  objects.forEach(disposeSolidObject);
  objects.length = 0;
  attachments.length = 0;
  selectedObject = null;
  nextObjectId = 1;
  nextAttachmentId = 1;
}

function restoreProject(data) {
  validateProject(data);
  clearProjectScene();
  modelConfirmed = false;
  editorTemporarilyDisabled = false;

  const objectMap = new Map();
  data.objects.forEach((saved) => {
    const object = createSolid(
      saved.params,
      new THREE.Vector3().fromArray(saved.position),
    );
    object.id = saved.id;
    object.root.quaternion.fromArray(saved.quaternion).normalize();
    object.params = { ...saved.params };
    objectMap.set(object.id, object);
  });
  nextObjectId = Math.max(...data.objects.map((object) => object.id)) + 1;

  data.attachments.forEach((saved) => {
    attachments.push({
      id: saved.id,
      a: objectMap.get(saved.aId),
      b: objectMap.get(saved.bId),
      faceA: saved.faceA,
      faceB: saved.faceB,
      rotation: Number(saved.rotation) || 0,
      offsetU: Number(saved.offsetU) || 0,
      offsetV: Number(saved.offsetV) || 0,
    });
  });
  nextAttachmentId = attachments.length
    ? Math.max(...attachments.map((attachment) => attachment.id)) + 1
    : 1;

  document.querySelector("#showAnnotations").checked =
    Boolean(data.preferences?.showAnnotations);
  objects.forEach((object) => {
    object.vectorLabels.forEach((label) => {
      label.visible = document.querySelector("#showAnnotations").checked;
    });
  });
  updateAttachmentFaceVisibility();

  const furniture = data.furniture ?? {};
  document.querySelector("#furnitureLength").value = furniture.length ?? 2.5;
  document.querySelector("#furnitureWidth").value = furniture.width ?? 1.2;
  document.querySelector("#furnitureHeight").value = furniture.height ?? 1.2;
  document.querySelector("#clearance").value = furniture.clearance ?? 0.1;
  document.querySelector("#maxIterations").value =
    furniture.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  document.querySelector("#solverMode").value =
    furniture.solverMode ?? "rrt";
  document.querySelector("#allowRoll").checked = Boolean(furniture.allowRoll);

  const restoredSelection =
    objectMap.get(data.selectedObjectId) ?? objects[0];
  selectObject(restoredSelection);
  if (Array.isArray(data.camera?.position) && data.camera.position.length === 3) {
    camera.position.fromArray(data.camera.position);
  }
  if (Array.isArray(data.camera?.target) && data.camera.target.length === 3) {
    controls.target.fromArray(data.camera.target);
  }
  controls.update();

  updateOpeningOptions();
  document.querySelector("#entranceFace").value = data.entranceId ?? "";
  document.querySelector("#exitFace").value = data.exitId ?? "";
  if (document.querySelector("#entranceFace").value !== (data.entranceId ?? "")) {
    document.querySelector("#entranceFace").value = "";
  }
  if (document.querySelector("#exitFace").value !== (data.exitId ?? "")) {
    document.querySelector("#exitFace").value = "";
  }
  const openingsValid =
    document.querySelector("#entranceFace").value &&
    document.querySelector("#exitFace").value &&
    document.querySelector("#entranceFace").value !==
      document.querySelector("#exitFace").value;
  if (data.modelConfirmed && openingsValid) {
    modelConfirmed = true;
    document.querySelector("#confirmModel").hidden = true;
    document.querySelector("#editModel").hidden = false;
    setHallwayTransparency(true);
    document.querySelector("#workflowStatus").textContent =
      "Project restored. Furniture settings are ready.";
  } else {
    document.querySelector("#confirmModel").hidden = false;
    document.querySelector("#editModel").hidden = true;
    setHallwayTransparency(false);
    document.querySelector("#workflowStatus").textContent =
      "Project restored in editing mode.";
  }
  refreshOpeningHighlights();
  document.querySelector("#simulationActions").hidden = true;
  document.querySelector("#topView").hidden = true;
  applyWorkflowLocks();
  refreshObjectColors();
  updateAttachmentUI();
  updateOpeningOptions();
  updateAttachmentFaceVisibility();
  refreshOpeningHighlights();
}

function saveProject() {
  const payload = serializeProject();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `can-it-fit-project-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  document.querySelector("#projectStatus").textContent =
    `Project saved with ${objects.length} object${objects.length === 1 ? "" : "s"}.`;
}

async function loadProjectFile(file) {
  const status = document.querySelector("#projectStatus");
  try {
    const data = JSON.parse(await file.text());
    validateProject(data);
    restoreProject(data);
    status.textContent =
      `Loaded ${objects.length} object${objects.length === 1 ? "" : "s"} successfully.`;
  } catch (error) {
    status.textContent = error instanceof Error
      ? error.message
      : "The project could not be loaded.";
  }
}

function calculateGeometry(params) {
  const angleAB = THREE.MathUtils.degToRad(params.angleAB);
  const cosAB = Math.cos(angleAB);
  const sinAB = Math.sin(angleAB);
  const cosAC = Math.cos(THREE.MathUtils.degToRad(params.angleAC));
  const cosBC = Math.cos(THREE.MathUtils.degToRad(params.angleBC));
  const cX = cosAC;
  const cY = (cosBC - cosAB * cosAC) / sinAB;
  const cZSquared = 1 - cX * cX - cY * cY;
  if (cZSquared <= 1e-8) return null;

  const O = new THREE.Vector3();
  const A = new THREE.Vector3(params.aLength, 0, 0);
  const B = new THREE.Vector3(params.bLength * cosAB, params.bLength * sinAB, 0);
  const C = new THREE.Vector3(
    cX,
    cY,
    Math.sqrt(Math.max(0, cZSquared)),
  ).multiplyScalar(params.cLength);
  return {
    vectors: [A, B, C],
    vertices: [
      O,
      A.clone(),
      B.clone(),
      A.clone().add(B),
      C.clone(),
      A.clone().add(C),
      B.clone().add(C),
      A.clone().add(B).add(C),
    ],
  };
}

function applyGeometry(object, geometry) {
  object.vectors = geometry.vectors;
  object.vertices = geometry.vertices;
  geometry.vertices.forEach((vertex, index) => vertex.toArray(object.positions, index * 3));
  object.mesh.geometry.attributes.position.needsUpdate = true;
  object.mesh.geometry.computeVertexNormals();
  object.mesh.geometry.computeBoundingSphere();

  const up = new THREE.Vector3(0, 1, 0);
  edgePairs.forEach(([start, end], index) => {
    const from = geometry.vertices[start];
    const to = geometry.vertices[end];
    const direction = to.clone().sub(from);
    const edge = object.edgeMeshes[index];
    edge.position.copy(from).add(to).multiplyScalar(0.5);
    edge.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    edge.scale.set(1, direction.length(), 1);
  });

  geometry.vectors.forEach((vector, index) => {
    object.vectorLabels[index].position.copy(vector).multiplyScalar(0.5);
  });
}

function createLabel(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
  }));
  sprite.userData.labelCanvas = canvas;
  sprite.userData.labelColor = color;
  redrawLabel(sprite, text);
  sprite.scale.set(1, 0.5, 1);
  sprite.renderOrder = 7;
  return sprite;
}

function redrawLabel(sprite, text) {
  const canvas = sprite.userData.labelCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.beginPath();
  context.roundRect(3, 3, 122, 58, 16);
  context.fill();
  context.strokeStyle = sprite.userData.labelColor;
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = sprite.userData.labelColor;
  context.font = "500 28px DM Mono, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 64, 33);
  sprite.material.map.needsUpdate = true;
}

const fields = {};
for (const control of document.querySelectorAll(".control")) {
  const key = control.dataset.control;
  const range = control.querySelector('input[type="range"]');
  const number = control.querySelector('input[type="number"]');
  const output = control.querySelector("output");
  fields[key] = { range, number, output, unit: control.dataset.unit ?? "" };
  range.addEventListener("input", () => setFieldValue(key, range.value));
  number.addEventListener("input", () => {
    if (number.value !== "") setFieldValue(key, number.value);
  });
  number.addEventListener("change", () => setFieldValue(key, number.value));
}

function setFieldValue(key, rawValue) {
  if (syncingFields || !selectedObject) return;
  if (attachmentsFor(selectedObject).length) return;
  clearMeasurement();
  clearRouteVisualization();
  const field = fields[key];
  const value = THREE.MathUtils.clamp(
    Number(rawValue) || 0,
    Number(field.range.min),
    Number(field.range.max),
  );
  const candidateParams = { ...selectedObject.params, [key]: value };
  const candidateGeometry = calculateGeometry(candidateParams);
  const error = document.querySelector("#angleError");

  if (!candidateGeometry) {
    error.textContent = "These three angles cannot form a real parallelepiped.";
    syncFields(selectedObject.params);
    return;
  }

  const oldGeometry = {
    vectors: selectedObject.vectors,
    vertices: selectedObject.vertices,
  };
  applyGeometry(selectedObject, candidateGeometry);
  if (objects.some((other) => other !== selectedObject && objectsOverlap(selectedObject, other))) {
    applyGeometry(selectedObject, oldGeometry);
    error.textContent = "That size or angle would overlap another object.";
    syncFields(selectedObject.params);
    return;
  }

  error.textContent = "";
  selectedObject.params = candidateParams;
  syncFields(candidateParams);
  updateReadout();
}

function applyShapeTemplate(params, name) {
  if (
    !selectedObject ||
    attachmentsFor(selectedObject).length ||
    modelConfirmed
  ) {
    return;
  }
  clearMeasurement();
  clearRouteVisualization();
  const geometry = calculateGeometry(params);
  if (!geometry) return;
  const oldGeometry = {
    vectors: selectedObject.vectors,
    vertices: selectedObject.vertices,
  };
  applyGeometry(selectedObject, geometry);
  if (
    objects.some(
      (other) =>
        other !== selectedObject &&
        objectsOverlap(selectedObject, other),
    )
  ) {
    applyGeometry(selectedObject, oldGeometry);
    document.querySelector("#angleError").textContent =
      `${name} is blocked because it would overlap another object.`;
    return;
  }
  selectedObject.params = { ...params };
  syncFields(selectedObject.params);
  updateReadout();
  document.querySelector("#angleError").textContent =
    `${name} applied: AB 45°, AC 90°, BC 90°.`;
}

function syncFields(params) {
  syncingFields = true;
  Object.entries(fields).forEach(([key, field]) => {
    const value = params[key];
    const decimals = field.range.step.includes(".") ? 1 : 0;
    field.range.value = value;
    field.number.value = value.toFixed(decimals);
    field.output.textContent = `${value.toFixed(decimals)}${field.unit}`;
    const fill = ((value - Number(field.range.min)) /
      (Number(field.range.max) - Number(field.range.min))) * 100;
    field.range.style.setProperty("--fill", `${fill}%`);
  });
  syncingFields = false;
}

function selectObject(object) {
  selectedObject = object;
  refreshObjectColors();
  syncFields(object.params);
  updateReadout();
  updateObjectUI();
  updateAttachmentUI();
  updateShapeControlState();
  updateOpeningOptions();
}

function refreshObjectColors() {
  objects.forEach((item) => {
    let joinIndex = -1;
    joinState?.objects.forEach((anchor, index) => {
      if (
        joinIndex < 0 &&
        connectedObjects(anchor, joinState.attachment).includes(item)
      ) {
        joinIndex = index;
      }
    });
    const color = joinIndex >= 0
      ? joinObjectColors[joinIndex]
      : item === selectedObject
        ? selectedFaceColor
        : unselectedFaceColor;
    item.materials.forEach((material) => material.color.setHex(color));
  });

  joinState?.faces.forEach(({ object, faceIndex }) => {
    const joinIndex = joinState.objects.indexOf(object);
    object.materials[faceIndex].color.setHex(joinFaceColors[joinIndex]);
  });

  updateJoinLegend();
}

function updateJoinLegend() {
  const legend = document.querySelector("#joinLegend");
  legend.hidden = !joinState;
  if (!joinState) return;
  [0, 1].forEach((index) => {
    const object = joinState.objects[index];
    document.querySelector(`#joinObject${index + 1}`).textContent =
      object ? `Object ${object.id}` : `Object ${index + 1}: not selected`;
  });
}

function updateReadout() {
  if (!selectedObject) return;
  ["A", "B", "C"].forEach((name, index) => {
    document.querySelector(`#vector${name}`).textContent =
      vectorText(selectedObject.vectors[index]);
  });
}

function updateObjectUI() {
  if (!selectedObject) return;
  document.querySelector("#selectedObject").textContent =
    `Object ${selectedObject.id} selected`;
  document.querySelector("#objectCount").textContent =
    `${objects.length} object${objects.length === 1 ? "" : "s"} in scene`;
  document.querySelector("#deleteObject").disabled =
    objects.length <= 1 || editorTemporarilyDisabled || modelConfirmed;
}

function attachmentsFor(object) {
  return attachments.filter(
    (attachment) => attachment.a === object || attachment.b === object,
  );
}

function connectedObjects(start, excludedAttachment = null) {
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    attachments.forEach((attachment) => {
      if (attachment === excludedAttachment) return;
      let neighbor = null;
      if (attachment.a === current) neighbor = attachment.b;
      if (attachment.b === current) neighbor = attachment.a;
      if (neighbor && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    });
  }
  return [...visited];
}

function updateAttachmentUI() {
  const tools = document.querySelector("#attachmentTools");
  const links = selectedObject ? attachmentsFor(selectedObject) : [];
  tools.hidden = links.length === 0;
  if (!links.length) return;

  const group = connectedObjects(selectedObject);
  document.querySelector("#groupStatus").textContent =
    `Object ${selectedObject.id} is attached`;
  document.querySelector("#groupCount").textContent =
    `${group.length} objects move and rotate together`;

  const select = document.querySelector("#attachmentSelect");
  const previous = Number(select.value);
  select.replaceChildren();
  links.forEach((attachment) => {
    const other = attachment.a === selectedObject ? attachment.b : attachment.a;
    const option = document.createElement("option");
    option.value = attachment.id;
    option.textContent = `Object ${selectedObject.id} ↔ Object ${other.id}`;
    select.appendChild(option);
  });
  if (links.some((attachment) => attachment.id === previous)) {
    select.value = String(previous);
  }
}

function updateAttachmentFaceVisibility() {
  objects.forEach((object) => {
    object.materials.forEach((material) => {
      material.visible = true;
    });
  });
  attachments.forEach((attachment) => {
    attachment.a.materials[attachment.faceA].visible = false;
    attachment.b.materials[attachment.faceB].visible = false;
  });
  if (modelConfirmed) {
    const openingIds = [
      document.querySelector("#entranceFace").value,
      document.querySelector("#exitFace").value,
    ];
    const environment = selectedObject ? buildEnvironment() : null;
    openingIds.forEach((id) => {
      const opening = environment?.openings.find((item) => item.id === id);
      if (opening) opening.object.materials[opening.faceIndex].visible = false;
    });
  }
}

function selectedAttachment() {
  const id = Number(document.querySelector("#attachmentSelect").value);
  return attachments.find((attachment) => attachment.id === id) ?? null;
}

function updateShapeControlState() {
  if (joinState) return;
  const attached = selectedObject && attachmentsFor(selectedObject).length > 0;
  document.querySelectorAll("#controls input, #reset").forEach((element) => {
    element.disabled = Boolean(attached || modelConfirmed);
  });
  document.querySelector("#applySlantedTemplate").disabled =
    Boolean(attached || modelConfirmed);
  document.querySelector("#angleError").textContent = modelConfirmed
    ? "Model confirmed. Choose Edit model to make geometry changes."
    : attached
    ? "Attached objects are inspect-only. Edit or detach the attachment first."
    : "";
}

function vectorText(vector) {
  const clean = (value) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
  return `(${clean(vector.x)}, ${clean(vector.y)}, ${clean(vector.z)})`;
}

function worldVertices(
  object,
  position = object.root.position,
  quaternion = object.root.quaternion,
) {
  return object.vertices.map(
    (vertex) => vertex.clone().applyQuaternion(quaternion).add(position),
  );
}

function objectsOverlap(
  first,
  second,
  firstPosition = first.root.position,
  firstQuaternion = first.root.quaternion,
  secondPosition = second.root.position,
  secondQuaternion = second.root.quaternion,
) {
  const firstVertices = worldVertices(first, firstPosition, firstQuaternion);
  const secondVertices = worldVertices(second, secondPosition, secondQuaternion);
  const firstEdges = first.vectors.map(
    (edge) => edge.clone().applyQuaternion(firstQuaternion).normalize(),
  );
  const secondEdges = second.vectors.map(
    (edge) => edge.clone().applyQuaternion(secondQuaternion).normalize(),
  );
  const axes = [];

  axes.push(
    new THREE.Vector3().crossVectors(firstEdges[0], firstEdges[1]),
    new THREE.Vector3().crossVectors(firstEdges[0], firstEdges[2]),
    new THREE.Vector3().crossVectors(firstEdges[1], firstEdges[2]),
    new THREE.Vector3().crossVectors(secondEdges[0], secondEdges[1]),
    new THREE.Vector3().crossVectors(secondEdges[0], secondEdges[2]),
    new THREE.Vector3().crossVectors(secondEdges[1], secondEdges[2]),
  );
  firstEdges.forEach((a) => {
    secondEdges.forEach((b) => axes.push(new THREE.Vector3().crossVectors(a, b)));
  });

  const touchingTolerance = 1e-5;
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-10) continue;
    axis.normalize();
    const firstProjection = projectVertices(firstVertices, axis);
    const secondProjection = projectVertices(secondVertices, axis);
    if (
      firstProjection.max <= secondProjection.min + touchingTolerance ||
      secondProjection.max <= firstProjection.min + touchingTolerance
    ) {
      return false;
    }
  }
  return true;
}

function projectVertices(vertices, axis) {
  let min = Infinity;
  let max = -Infinity;
  vertices.forEach((vertex) => {
    const projection = vertex.dot(axis);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  });
  return { min, max };
}

function buildEnvironment() {
  const members = selectedObject ? connectedObjects(selectedObject) : [];
  const memberSet = new Set(members);
  const internalFaces = new Set();
  attachments.forEach((attachment) => {
    if (memberSet.has(attachment.a) && memberSet.has(attachment.b)) {
      internalFaces.add(`${attachment.a.id}:${attachment.faceA}`);
      internalFaces.add(`${attachment.b.id}:${attachment.faceB}`);
    }
  });

  const volumes = members.map((object) => ({
    object,
    origin: object.root.position.clone(),
    a: object.vectors[0].clone().applyQuaternion(object.root.quaternion),
    b: object.vectors[1].clone().applyQuaternion(object.root.quaternion),
    c: object.vectors[2].clone().applyQuaternion(object.root.quaternion),
  }));
  const openings = [];
  const faceOpeningData = (object, faceIndex) => {
    const frame = outwardFaceFrame(object, faceIndex);
    const vertices = faceQuads[faceIndex].map((vertexIndex) =>
      object.vertices[vertexIndex]
        .clone()
        .applyQuaternion(object.root.quaternion)
        .add(object.root.position),
    );
    const family = faceIndex < 2 ? 2 : faceIndex < 4 ? 1 : 0;
    const travelDirection = object.vectors[family]
      .clone()
      .applyQuaternion(object.root.quaternion)
      .normalize()
      .multiplyScalar(faceIndex % 2 === 0 ? 1 : -1);
    return {
      object,
      faceIndex,
      center: frame.center,
      normal: frame.normal,
      u: frame.u,
      v: frame.v,
      vertices,
      travelDirection,
      uLimit: Math.max(
        ...vertices.map((vertex) =>
          Math.abs(vertex.clone().sub(frame.center).dot(frame.u))),
      ),
      vLimit: Math.max(
        ...vertices.map((vertex) =>
          Math.abs(vertex.clone().sub(frame.center).dot(frame.v))),
      ),
      polygon: vertices.map((vertex) => {
        const offset = vertex.clone().sub(frame.center);
        return {
          u: offset.dot(frame.u),
          v: offset.dot(frame.v),
        };
      }),
    };
  };
  members.forEach((object) => {
    for (let faceIndex = 0; faceIndex < faceQuads.length; faceIndex += 1) {
      if (internalFaces.has(`${object.id}:${faceIndex}`)) continue;
      const opening = faceOpeningData(object, faceIndex);
      openings.push({
        ...opening,
        id: `${object.id}:${faceIndex}`,
        name: `Object ${object.id} · ${faceNames[faceIndex]}`,
      });
    }
  });
  const connections = attachments
    .filter((attachment) =>
      memberSet.has(attachment.a) && memberSet.has(attachment.b))
    .map((attachment) => ({
      id: attachment.id,
      a: faceOpeningData(attachment.a, attachment.faceA),
      b: faceOpeningData(attachment.b, attachment.faceB),
    }));

  const bounds = new THREE.Box3();
  members.forEach((object) => {
    worldVertices(object).forEach((vertex) => bounds.expandByPoint(vertex));
  });
  return {
    volumes,
    exteriorWalls: openings,
    openings,
    connections,
    bounds,
  };
}

function outwardFaceFrame(object, faceIndex) {
  const frame = faceFrame(object, faceIndex, true);
  const volume = {
    origin: object.root.position.clone(),
    a: object.vectors[0].clone().applyQuaternion(object.root.quaternion),
    b: object.vectors[1].clone().applyQuaternion(object.root.quaternion),
    c: object.vectors[2].clone().applyQuaternion(object.root.quaternion),
  };
  const probeDistance = Math.max(
    1e-4,
    Math.min(volume.a.length(), volume.b.length(), volume.c.length()) * 1e-4,
  );
  const positiveProbe = frame.center
    .clone()
    .addScaledVector(frame.normal, probeDistance);
  const negativeProbe = frame.center
    .clone()
    .addScaledVector(frame.normal, -probeDistance);
  const positiveInside = pointInVolume(positiveProbe, volume, 1e-8);
  const negativeInside = pointInVolume(negativeProbe, volume, 1e-8);

  if (positiveInside && !negativeInside) {
    frame.normal.negate();
    frame.v.negate();
  }
  return frame;
}

function toggleMeasurementMode() {
  if (joinState || manualModeController.isActive()) return;
  measurementMode = !measurementMode;
  if (measurementMode) clearMeasurement(false);
  const button = document.querySelector("#measureSurfaces");
  button.classList.toggle("is-active", measurementMode);
  button.textContent = measurementMode
    ? "Selecting surfaces…"
    : "Measure parallel surfaces";
  document.querySelector("#measurementStatus").textContent = measurementMode
    ? "Click the first surface."
    : "Click two parallel surfaces to measure their perpendicular distance.";
}

function selectMeasurementFace(hit) {
  const object = hit.object.userData.object;
  const faceIndex = Math.floor(hit.faceIndex / 2);
  const frame = outwardFaceFrame(object, faceIndex);
  measuredFaces.push({ object, faceIndex, frame });
  addMeasurementOverlay(object, faceIndex);

  if (measuredFaces.length === 1) {
    document.querySelector("#measurementStatus").textContent =
      "First surface selected. Click a parallel surface.";
    return;
  }

  const [first, second] = measuredFaces;
  const alignment = Math.abs(first.frame.normal.dot(second.frame.normal));
  if (alignment < 0.999) {
    measuredFaces.pop();
    const overlay = measurementOverlays.pop();
    scene.remove(overlay);
    overlay.geometry.dispose();
    overlay.material.dispose();
    document.querySelector("#measurementStatus").textContent =
      "Those surfaces are not parallel. Choose another second surface.";
    return;
  }

  const signedDistance = second.frame.center
    .clone()
    .sub(first.frame.center)
    .dot(first.frame.normal);
  const distance = Math.abs(signedDistance);
  const endpoint = first.frame.center
    .clone()
    .addScaledVector(first.frame.normal, signedDistance);
  measurementLine.geometry.dispose();
  measurementLine.geometry = new THREE.BufferGeometry().setFromPoints([
    first.frame.center,
    endpoint,
  ]);
  measurementLine.visible = true;
  measurementLabel.position.copy(first.frame.center).lerp(endpoint, 0.5);
  redrawLabel(measurementLabel, distance.toFixed(3));
  measurementLabel.visible = true;
  measurementMode = false;
  document.querySelector("#measureSurfaces").classList.remove("is-active");
  document.querySelector("#measureSurfaces").textContent =
    "Measure parallel surfaces";
  document.querySelector("#clearMeasurement").hidden = false;
  document.querySelector("#measurementStatus").textContent =
    `Perpendicular distance: ${distance.toFixed(3)} model units.`;
}

function addMeasurementOverlay(object, faceIndex) {
  const vertices = faceQuads[faceIndex].map(
    (index) => object.vertices[index]
      .clone()
      .applyQuaternion(object.root.quaternion)
      .add(object.root.position),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      ...vertices[0].toArray(),
      ...vertices[1].toArray(),
      ...vertices[2].toArray(),
      ...vertices[0].toArray(),
      ...vertices[2].toArray(),
      ...vertices[3].toArray(),
    ], 3),
  );
  const overlay = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xf2c94c,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  overlay.renderOrder = 10;
  scene.add(overlay);
  measurementOverlays.push(overlay);
}

function clearMeasurement(resetMessage = true) {
  measuredFaces.length = 0;
  measurementOverlays.splice(0).forEach((overlay) => {
    scene.remove(overlay);
    overlay.geometry.dispose();
    overlay.material.dispose();
  });
  measurementLine.visible = false;
  measurementLabel.visible = false;
  document.querySelector("#clearMeasurement").hidden = true;
  if (resetMessage) {
    document.querySelector("#measurementStatus").textContent =
      "Click two parallel surfaces to measure their perpendicular distance.";
  }
}

function updateOpeningOptions() {
  const entranceSelect = document.querySelector("#entranceFace");
  const exitSelect = document.querySelector("#exitFace");
  if (!entranceSelect || !selectedObject) return;
  const previousEntrance = entranceSelect.value;
  const previousExit = exitSelect.value;
  const environment = buildEnvironment();

  [entranceSelect, exitSelect].forEach((select) => select.replaceChildren());
  [entranceSelect, exitSelect].forEach((select) => {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Click a surface or choose here";
    select.appendChild(placeholder);
  });
  environment.openings.forEach((opening) => {
    [entranceSelect, exitSelect].forEach((select) => {
      const option = document.createElement("option");
      option.value = opening.id;
      option.textContent = opening.name;
      select.appendChild(option);
    });
  });
  if (environment.openings.some((opening) => opening.id === previousEntrance)) {
    entranceSelect.value = previousEntrance;
  }
  if (environment.openings.some((opening) => opening.id === previousExit)) {
    exitSelect.value = previousExit;
  }
  document.querySelector("#simulationStatus").textContent =
    environment.openings.length >= 2
      ? `${environment.openings.length} exterior openings available.`
      : "At least two exterior openings are required.";
  if (!environment.bounds.isEmpty()) fitTopCamera(environment.bounds);
  refreshOpeningHighlights();
}

function openingForHit(hit) {
  const object = hit.object.userData.object;
  const faceIndex = Math.floor(hit.faceIndex / 2);
  const environment = buildEnvironment();
  return environment.openings.find(
    (opening) => opening.object === object && opening.faceIndex === faceIndex,
  );
}

function pickOpeningFromSurface(hit) {
  const opening = openingForHit(hit);
  if (!opening) {
    document.querySelector("#simulationStatus").textContent =
      "That surface is an internal portal. Choose an exterior surface.";
    return;
  }
  const select = document.querySelector(
    openingPickRole === "entrance" ? "#entranceFace" : "#exitFace",
  );
  select.value = opening.id;
  if (openingPickRole === "entrance") {
    openingPickRole = "exit";
    document.querySelector("#simulationStatus").textContent =
      `Entrance selected: ${opening.name}. Now click the exit surface.`;
  } else {
    openingPickRole = "entrance";
    document.querySelector("#simulationStatus").textContent =
      `Exit selected: ${opening.name}. Click Confirm 3D model when ready.`;
  }
  refreshOpeningHighlights();
}

function setOpeningPickArmed(armed) {
  openingPickArmed = armed;
  const button = document.querySelector("#pickOpenings");
  button.textContent = armed
    ? "Click entrance, then exit (click to stop)"
    : "Pick faces in 3D view";
  button.classList.toggle("active", armed);
  if (armed) {
    openingPickRole = "entrance";
    document.querySelector("#simulationStatus").textContent =
      "Click an exterior surface for the entrance, then one for the exit.";
  }
}

function modelSignature() {
  return JSON.stringify([
    objects.map((object) => [
      object.id,
      object.root.position.toArray(),
      object.root.quaternion.toArray(),
      object.vertices.map((vertex) => vertex.toArray()),
    ]),
    attachments.map((attachment) => [
      attachment.id, attachment.faceA, attachment.faceB,
    ]),
    selectedObject?.id ?? null,
  ]);
}

function refreshOpeningsWhileEditing(now) {
  if (modelConfirmed || joinState || now - openingSignatureTime < 250) return;
  openingSignatureTime = now;
  const signature = modelSignature();
  if (signature === openingSignature) return;
  openingSignature = signature;
  updateOpeningOptions();
}

function viewFurniture() {
  updateFurniturePreview();
  if (!furniturePreview.visible) return;
  const size = Math.max(
    furniturePreview.scale.x,
    furniturePreview.scale.y,
    furniturePreview.scale.z,
  );
  const direction = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(furniturePreview.position);
  camera.position.copy(furniturePreview.position).addScaledVector(direction, size * 3 + 2);
  controls.update();
}

function refreshOpeningHighlights() {
  openingHighlights.forEach((highlight) => {
    highlight.material.dispose();
    highlight.geometry.dispose();
    scene.remove(highlight);
  });
  openingHighlights = [];

  const environment = buildEnvironment();
  [
    { id: document.querySelector("#entranceFace").value, color: 0x35b96f },
    { id: document.querySelector("#exitFace").value, color: 0xf19a3e },
  ].forEach(({ id, color }) => {
    const opening = environment.openings.find((item) => item.id === id);
    if (!opening) return;
    const vertices = faceQuads[opening.faceIndex].map(
      (index) => opening.object.vertices[index]
        .clone()
        .applyQuaternion(opening.object.root.quaternion)
        .add(opening.object.root.position),
    );
    const geometry = new THREE.BufferGeometry().setFromPoints([
      vertices[0], vertices[1], vertices[2],
      vertices[0], vertices[2], vertices[3],
    ]);
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const highlight = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    highlight.position.addScaledVector(opening.normal, 0.025);
    highlight.renderOrder = 8;
    scene.add(highlight);
    openingHighlights.push(highlight);
  });
}

function capturePoses(members) {
  return new Map(
    members.map((object) => [
      object,
      {
        position: object.root.position.clone(),
        quaternion: object.root.quaternion.clone(),
      },
    ]),
  );
}

function applyPoses(poses) {
  poses.forEach((pose, object) => {
    object.root.position.copy(pose.position);
    object.root.quaternion.copy(pose.quaternion);
  });
}

function translatedPoses(basePoses, delta) {
  const poses = new Map();
  basePoses.forEach((pose, object) => {
    poses.set(object, {
      position: pose.position.clone().add(delta),
      quaternion: pose.quaternion.clone(),
    });
  });
  return poses;
}

function transformedPoses(basePoses, anchorObject, anchorPosition, anchorQuaternion) {
  const anchorPose = basePoses.get(anchorObject);
  const deltaQuaternion = anchorQuaternion
    .clone()
    .multiply(anchorPose.quaternion.clone().invert());
  const poses = new Map();
  basePoses.forEach((pose, object) => {
    poses.set(object, {
      position: pose.position
        .clone()
        .sub(anchorPose.position)
        .applyQuaternion(deltaQuaternion)
        .add(anchorPosition),
      quaternion: deltaQuaternion.clone().multiply(pose.quaternion),
    });
  });
  return poses;
}

function groupCenter(members, poses = null) {
  const center = new THREE.Vector3();
  members.forEach((object) => {
    const pose = poses?.get(object);
    center.add(pose?.position ?? object.root.position);
  });
  return center.multiplyScalar(1 / members.length);
}

function rotatedGroupPoses(members, axis, radians) {
  const base = capturePoses(members);
  const center = groupCenter(members, base);
  const rotation = new THREE.Quaternion().setFromAxisAngle(axis, radians);
  const poses = new Map();
  base.forEach((pose, object) => {
    poses.set(object, {
      position: pose.position
        .clone()
        .sub(center)
        .applyQuaternion(rotation)
        .add(center),
      quaternion: rotation.clone().multiply(pose.quaternion),
    });
  });
  return poses;
}

function posesCollide(movingMembers, poses, ignoredPairs = []) {
  const movingSet = new Set(movingMembers);
  const ignored = new Set(
    ignoredPairs.map(([a, b]) => `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`),
  );
  for (const moving of movingMembers) {
    const movingPose = poses.get(moving);
    for (const other of objects) {
      if (movingSet.has(other)) continue;
      const key = `${Math.min(moving.id, other.id)}:${Math.max(moving.id, other.id)}`;
      if (ignored.has(key)) continue;
      if (
        objectsOverlap(
          moving,
          other,
          movingPose.position,
          movingPose.quaternion,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

document.querySelector("#showAnnotations").addEventListener("change", (event) => {
  objects.forEach((object) => {
    object.vectorLabels.forEach((label) => {
      label.visible = event.target.checked;
    });
  });
});

document.querySelector("#addObject").addEventListener("click", () => {
  const source = selectedObject ?? objects[0];
  let x = source.root.position.x + source.params.aLength + 0.5;
  const position = source.root.position.clone();
  let candidate;
  do {
    position.x = x;
    candidate = objects.every((object) => {
      const test = {
        root: { position, quaternion: new THREE.Quaternion() },
        vertices: source.vertices,
        vectors: source.vectors,
      };
      return !objectsOverlap(test, object, position);
    });
    x += source.params.aLength + 0.5;
  } while (!candidate);
  createSolid(source.params, position);
});

document.querySelector("#applySlantedTemplate").addEventListener("click", () => {
  applyShapeTemplate(slantedTemplate, "45° two-face box");
});

document.querySelector("#deleteObject").addEventListener("click", () => {
  if (
    !selectedObject ||
    objects.length <= 1 ||
    editorTemporarilyDisabled ||
    modelConfirmed
  ) {
    return;
  }

  clearMeasurement();
  clearRouteVisualization();
  const deletedObject = selectedObject;
  const deletedIndex = objects.indexOf(deletedObject);
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    if (attachment.a === deletedObject || attachment.b === deletedObject) {
      attachments.splice(index, 1);
    }
  }
  objects.splice(deletedIndex, 1);
  disposeSolidObject(deletedObject);
  selectedObject = null;
  updateAttachmentFaceVisibility();
  selectObject(objects[Math.min(deletedIndex, objects.length - 1)]);
  updateAttachmentUI();
  document.querySelector("#projectStatus").textContent =
    `Object ${deletedObject.id} deleted.`;
});

function startJoin() {
  clearRouteVisualization();
  cancelJoin();
  joinState = {
    mode: "create",
    phase: "objects",
    objects: [],
    faces: [],
    movingMembers: [],
    basePoses: null,
    attachment: null,
  };
  document.querySelector("#startJoin").classList.add("is-active");
  document.querySelector("#startJoin").textContent = "Selecting objects…";
  setEditorDisabled(true);
  setJoinStatus("Click the first object to keep fixed.");
  refreshObjectColors();
}

function handleJoinPick(hit) {
  const object = hit.object.userData.object;
  if (joinState.phase === "objects") {
    if (joinState.objects.includes(object)) {
      joinState.objects = joinState.objects.filter((item) => item !== object);
      refreshObjectColors();
      setJoinStatus("Object unpicked. Click the first object to keep fixed.");
      return;
    }
    if (
      joinState.objects.length === 1 &&
      connectedObjects(joinState.objects[0]).includes(object)
    ) {
      setJoinStatus("Those objects are already in the same attached group.");
      return;
    }
    joinState.objects.push(object);
    selectObject(object);
    if (joinState.objects.length === 1) {
      setJoinStatus(`Object ${object.id} fixed. Click the object to move.`);
    } else {
      joinState.phase = "faces";
      setJoinStatus(`Click a face on Object ${joinState.objects[0].id}.`);
    }
    refreshObjectColors();
    return;
  }

  const faceIndex = Math.floor(hit.faceIndex / 2);
  const selectedFaceIndex = joinState.faces.findIndex(
    (selection) =>
      selection.object === object && selection.faceIndex === faceIndex,
  );
  if (selectedFaceIndex >= 0) {
    unpickJoinFace(selectedFaceIndex);
    return;
  }

  const existingObjectFaceIndex = joinState.faces.findIndex(
    (selection) => selection.object === object,
  );
  if (existingObjectFaceIndex >= 0) {
    joinState.faces.splice(existingObjectFaceIndex);
    joinState.faces.push({ object, faceIndex });
    refreshObjectColors();
    setJoinStatus(`Face changed. Click a face on Object ${joinState.objects[1].id}.`);
    return;
  }

  const expectedObject = joinState.objects[joinState.faces.length];
  if (object !== expectedObject) {
    setJoinStatus(`Click a face on Object ${expectedObject.id}.`);
    return;
  }

  joinState.faces.push({ object, faceIndex });
  refreshObjectColors();
  if (joinState.faces.length === 1) {
    setJoinStatus(`Click a face on Object ${joinState.objects[1].id}.`);
  } else {
    openJoinPreview();
  }
}

function unpickJoinFace(selectionIndex) {
  if (joinState.phase === "preview") {
    applyPoses(joinState.basePoses);
    document.querySelector("#joinPanel").hidden = true;
    joinState.phase = "faces";
  }

  joinState.faces.splice(selectionIndex);
  if (selectionIndex === 0) joinState.faces.length = 0;
  refreshObjectColors();
  const object = joinState.objects[joinState.faces.length];
  setJoinStatus(
    `Face unpicked. Click a face on Object ${object.id}.`,
  );
}

function setJoinStatus(message) {
  document.querySelector("#joinStatus").textContent = message;
}

function faceFrame(object, faceIndex, worldSpace = false) {
  const vertices = faceQuads[faceIndex].map((index) => object.vertices[index].clone());
  const center = vertices
    .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
    .multiplyScalar(0.25);
  const u = vertices[1].clone().sub(vertices[0]).normalize();
  const normal = new THREE.Vector3()
    .crossVectors(
      vertices[1].clone().sub(vertices[0]),
      vertices[2].clone().sub(vertices[0]),
    )
    .normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  if (worldSpace) {
    center.applyQuaternion(object.root.quaternion).add(object.root.position);
    u.applyQuaternion(object.root.quaternion);
    v.applyQuaternion(object.root.quaternion);
    normal.applyQuaternion(object.root.quaternion);
  }
  return { center, u, v, normal };
}

function openJoinPreview() {
  const moving = joinState.objects[1];
  joinState.phase = "preview";
  joinState.movingMembers = connectedObjects(moving, joinState.attachment);
  joinState.basePoses = capturePoses(joinState.movingMembers);
  document.querySelector("#joinPanel").hidden = false;
  document.querySelector("#joinSummary").textContent =
    `Object ${joinState.objects[0].id} ${faceNames[joinState.faces[0].faceIndex]} ↔ ` +
    `Object ${moving.id} ${faceNames[joinState.faces[1].faceIndex]}`;
  document.querySelector("#joinRotation").value = joinState.attachment?.rotation ?? 0;
  document.querySelector("#joinOffsetU").value = joinState.attachment?.offsetU ?? 0;
  document.querySelector("#joinOffsetV").value = joinState.attachment?.offsetV ?? 0;
  updateJoinPreview();
  setJoinStatus("Adjust the surfaces in the preview, then apply.");
}

function calculateJoinTransform() {
  const target = joinState.objects[0];
  const moving = joinState.objects[1];
  const targetFrame = faceFrame(target, joinState.faces[0].faceIndex, true);
  const movingFrame = faceFrame(moving, joinState.faces[1].faceIndex, false);

  const normalAlignment = new THREE.Quaternion().setFromUnitVectors(
    movingFrame.normal,
    targetFrame.normal.clone().negate(),
  );
  const alignedU = movingFrame.u.clone().applyQuaternion(normalAlignment);
  const baseTwist = Math.atan2(
    targetFrame.normal.dot(new THREE.Vector3().crossVectors(alignedU, targetFrame.u)),
    THREE.MathUtils.clamp(alignedU.dot(targetFrame.u), -1, 1),
  );
  const userTwist = THREE.MathUtils.degToRad(
    Number(document.querySelector("#joinRotation").value),
  );
  const twist = new THREE.Quaternion().setFromAxisAngle(
    targetFrame.normal,
    baseTwist + userTwist,
  );
  const quaternion = twist.multiply(normalAlignment);

  const destinationCenter = targetFrame.center
    .clone()
    .addScaledVector(targetFrame.u, Number(document.querySelector("#joinOffsetU").value))
    .addScaledVector(targetFrame.v, Number(document.querySelector("#joinOffsetV").value));
  const movingCenter = movingFrame.center.clone().applyQuaternion(quaternion);
  const position = destinationCenter.sub(movingCenter);
  return { position, quaternion, targetFrame };
}

function updateJoinPreview() {
  if (joinState?.phase !== "preview") return;
  const moving = joinState.objects[1];
  const transform = calculateJoinTransform();
  const poses = transformedPoses(
    joinState.basePoses,
    moving,
    transform.position,
    transform.quaternion,
  );
  applyPoses(poses);

  const hasOverlap = posesCollide(joinState.movingMembers, poses);
  document.querySelector("#joinError").textContent = hasOverlap
    ? "This placement overlaps another object."
    : "";
  document.querySelector("#applyJoin").disabled = hasOverlap;
  document.querySelector("#joinRotationValue").textContent =
    `${document.querySelector("#joinRotation").value}°`;
  document.querySelector("#joinOffsetUValue").textContent =
    Number(document.querySelector("#joinOffsetU").value).toFixed(1);
  document.querySelector("#joinOffsetVValue").textContent =
    Number(document.querySelector("#joinOffsetV").value).toFixed(1);
  positionPreviewCamera(transform.targetFrame.center);
}

function positionPreviewCamera(center) {
  const target = joinState.objects[0];
  const moving = joinState.objects[1];
  const points = [...worldVertices(target), ...worldVertices(moving)];
  const radius = Math.max(
    3,
    ...points.map((point) => point.distanceTo(center)),
  );
  previewCamera.position.copy(center).add(new THREE.Vector3(radius, -radius, radius));
  previewCamera.lookAt(center);
  previewCamera.near = Math.max(0.01, radius / 100);
  previewCamera.far = radius * 10;
  previewCamera.updateProjectionMatrix();
}

function applyJoin() {
  if (joinState?.phase !== "preview") return;
  const moving = joinState.objects[1];
  const poses = capturePoses(joinState.movingMembers);
  const overlaps = posesCollide(joinState.movingMembers, poses);
  if (overlaps) return;
  clearMeasurement();
  const values = {
    rotation: Number(document.querySelector("#joinRotation").value),
    offsetU: Number(document.querySelector("#joinOffsetU").value),
    offsetV: Number(document.querySelector("#joinOffsetV").value),
  };
  if (joinState.mode === "edit") {
    Object.assign(joinState.attachment, values, {
      a: joinState.objects[0],
      b: joinState.objects[1],
      faceA: joinState.faces[0].faceIndex,
      faceB: joinState.faces[1].faceIndex,
    });
  } else {
    attachments.push({
      id: nextAttachmentId++,
      a: joinState.objects[0],
      b: joinState.objects[1],
      faceA: joinState.faces[0].faceIndex,
      faceB: joinState.faces[1].faceIndex,
      ...values,
    });
  }
  updateAttachmentFaceVisibility();
  selectedObject = moving;
  finishJoin(false);
  selectObject(moving);
}

function cancelJoin() {
  if (joinState?.phase === "preview" && joinState.basePoses) {
    applyPoses(joinState.basePoses);
  }
  finishJoin(true);
}

function finishJoin(cancelled) {
  joinState = null;
  updateAttachmentFaceVisibility();
  document.querySelector("#joinPanel").hidden = true;
  document.querySelector("#startJoin").classList.remove("is-active");
  document.querySelector("#startJoin").textContent = "Connect two objects";
  document.querySelector("#joinLegend").hidden = true;
  setEditorDisabled(false);
  setJoinStatus(cancelled
    ? "Select two objects, then select one face on each."
    : "Surfaces connected. Start another connection when ready.");
  refreshObjectColors();
  updateAttachmentUI();
  updateShapeControlState();
}

function setEditorDisabled(disabled) {
  editorTemporarilyDisabled = disabled;
  applyWorkflowLocks();
}

function applyWorkflowLocks() {
  const modelLocked = editorTemporarilyDisabled || modelConfirmed;
  document.querySelectorAll(
    "#controls input, #addObject, #deleteObject, #reset, #applySlantedTemplate, " +
      "#showAnnotations, #startJoin, #attachmentSelect, #editAttachment, " +
      "#detachAttachment, .group-rotation button",
  ).forEach((element) => {
    element.disabled = modelLocked;
  });
  document.querySelectorAll(
    "#furnitureStage input, #furnitureStage select, #viewFurniture",
  ).forEach((element) => {
    element.disabled = editorTemporarilyDisabled;
  });
  document.querySelectorAll("#runSimulation, #startManual").forEach((element) => {
    element.disabled = editorTemporarilyDisabled || !modelConfirmed;
  });
  document.querySelectorAll("#entranceFace, #exitFace, #pickOpenings").forEach(
    (element) => {
      element.disabled = editorTemporarilyDisabled || modelConfirmed;
    },
  );
  if (objects.length <= 1) {
    document.querySelector("#deleteObject").disabled = true;
  }
  updateShapeControlState();
}

function editSelectedAttachment() {
  const attachment = selectedAttachment();
  if (!attachment) return;
  cancelJoin();
  joinState = {
    mode: "edit",
    phase: "faces",
    objects: [attachment.a, attachment.b],
    faces: [
      { object: attachment.a, faceIndex: attachment.faceA },
      { object: attachment.b, faceIndex: attachment.faceB },
    ],
    movingMembers: [],
    basePoses: null,
    attachment,
  };
  document.querySelector("#startJoin").classList.add("is-active");
  document.querySelector("#startJoin").textContent = "Editing attachment…";
  setEditorDisabled(true);
  attachment.a.materials[attachment.faceA].visible = true;
  attachment.b.materials[attachment.faceB].visible = true;
  refreshObjectColors();
  openJoinPreview();
}

function detachSelectedAttachment() {
  const attachment = selectedAttachment();
  if (!attachment) return;
  clearMeasurement();
  const index = attachments.indexOf(attachment);
  if (index >= 0) attachments.splice(index, 1);
  updateAttachmentFaceVisibility();
  clearRouteVisualization();
  setJoinStatus(
    `Objects ${attachment.a.id} and ${attachment.b.id} are now independent.`,
  );
  refreshObjectColors();
  updateAttachmentUI();
  updateShapeControlState();
  updateOpeningOptions();
}

function rotateSelectedGroup(axisName, degrees) {
  if (!selectedObject || joinState) return;
  const members = connectedObjects(selectedObject);
  if (members.length < 2) return;
  clearMeasurement();
  const axis = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  }[axisName];
  const poses = rotatedGroupPoses(
    members,
    axis,
    THREE.MathUtils.degToRad(degrees),
  );
  if (posesCollide(members, poses)) {
    document.querySelector("#angleError").textContent =
      "Group rotation is blocked by another object.";
    return;
  }
  clearRouteVisualization();
  applyPoses(poses);
  document.querySelector("#angleError").textContent =
    "Attached objects are inspect-only. Edit or detach the attachment first.";
}

function confirmModel() {
  if (joinState) {
    document.querySelector("#workflowStatus").textContent =
      "Finish or cancel the current attachment edit first.";
    return;
  }
  const environment = buildEnvironment();
  if (environment.openings.length < 2) {
    document.querySelector("#workflowStatus").textContent =
      "The model needs at least two exterior faces for an entrance and exit.";
    return;
  }
  const entrance = document.querySelector("#entranceFace").value;
  const exit = document.querySelector("#exitFace").value;
  if (!entrance || !exit || entrance === exit) {
    document.querySelector("#workflowStatus").textContent =
      "Choose two different exterior openings for the entrance and exit first.";
    return;
  }
  modelConfirmed = true;
  setOpeningPickArmed(false);
  clearRouteVisualization();
  setHallwayTransparency(true);
  refreshOpeningHighlights();
  applyWorkflowLocks();
  updateAttachmentFaceVisibility();
  document.querySelector("#confirmModel").hidden = true;
  document.querySelector("#editModel").hidden = false;
  document.querySelector("#simulationActions").hidden = true;
  document.querySelector("#topView").hidden = true;
  document.querySelector("#workflowStatus").textContent =
    "Model locked. Set the furniture size and run the simulation.";
  document.querySelector("#simulationStatus").textContent =
    "Furniture dimensions use the same units as the hallway model.";
}

function editModel() {
  if (manualModeController.isActive()) manualModeController.stopManualChallenge();
  modelConfirmed = false;
  clearRouteVisualization();
  setHallwayTransparency(false);
  applyWorkflowLocks();
  document.querySelector("#confirmModel").hidden = false;
  document.querySelector("#editModel").hidden = true;
  document.querySelector("#simulationActions").hidden = true;
  document.querySelector("#topView").hidden = true;
  document.querySelector("#routeVideoPanel").hidden = true;
  updateOpeningOptions();
  updateAttachmentFaceVisibility();
  refreshOpeningHighlights();
  document.querySelector("#workflowStatus").textContent =
    "Model editing enabled. Confirm again when the hallway is finished.";
}

function readFurnitureInputs() {
  return {
    length: Number(document.querySelector("#furnitureLength").value),
    width: Number(document.querySelector("#furnitureWidth").value),
    height: Number(document.querySelector("#furnitureHeight").value),
  };
}

function selectedSimulationEnvironment() {
  const environment = buildEnvironment();
  const entrance = environment.openings.find(
    (opening) => opening.id === document.querySelector("#entranceFace").value,
  );
  const exit = environment.openings.find(
    (opening) => opening.id === document.querySelector("#exitFace").value,
  );
  return entrance && exit ? { ...environment, entrance, exit } : null;
}

async function runSimulation(startPose = null) {
  if (joinState || !selectedObject) return;
  if (manualModeController.isActive()) {
    manualModeController.stopManualChallenge();
  }
  const status = document.querySelector("#simulationStatus");
  const runButton = document.querySelector("#runSimulation");
  const environment = buildEnvironment();
  const entrance = environment.openings.find(
    (opening) => opening.id === document.querySelector("#entranceFace").value,
  );
  const exit = environment.openings.find(
    (opening) => opening.id === document.querySelector("#exitFace").value,
  );
  if (!entrance || !exit || entrance.id === exit.id) {
    status.textContent = "Choose two different exterior openings.";
    return;
  }

  const furniture = readFurnitureInputs();
  if (Object.values(furniture).some((value) => !Number.isFinite(value) || value <= 0)) {
    status.textContent = "Furniture dimensions must be positive.";
    return;
  }

  clearRouteVisualization();
  simulationEnvironment = { ...environment, entrance, exit };
  simulationFurniture = furniture;
  runButton.disabled = true;
  const solverMode = startPose
    ? "rrt"
    : document.querySelector("#solverMode").value;
  status.textContent = startPose
    ? "Planning from the assisted inside pose…"
    : solverMode === "heuristic"
      ? "Building straight heuristic route…"
      : "Planning 3D route…";
  const sceneSize = environment.bounds.getSize(new THREE.Vector3());
  const positionStep = Math.max(
    0.08,
    Math.min(sceneSize.x, sceneSize.y, sceneSize.z) / 28,
  );
  const maxIterationsInput = document.querySelector("#maxIterations");
  const requestedMaxIterations = Number(maxIterationsInput.value);
  const maxIterations = Number.isFinite(requestedMaxIterations)
    ? Math.min(1000000, Math.max(1000, Math.round(requestedMaxIterations)))
    : DEFAULT_MAX_ITERATIONS;
  maxIterationsInput.value = String(maxIterations);
  const solverOptions = {
    environment,
    furniture,
    entrance,
    exit,
    config: {
      maxIterations,
      positionStep,
      angleStep: THREE.MathUtils.degToRad(4),
      goalBias: 0.18,
      clearance: Number(document.querySelector("#clearance").value) || 0,
      allowRoll: document.querySelector("#allowRoll").checked,
      animationStep: positionStep / 2,
      openingPoseCount: 2000,
    },
  };
  const result = solverMode === "heuristic"
    ? await planHeuristicTraversal({
      ...solverOptions,
      onProgress: (progress) => {
        if (progress.phase === "hybrid-rrt") {
          status.textContent =
            `RRT corner ${progress.transition}: ` +
            `${progress.iteration.toLocaleString()} / ` +
            `${progress.maxIterations.toLocaleString()} iterations`;
        }
      },
    })
    : await planRRTConnect({
      ...solverOptions,
      startPose,
      onProgress: (progress) => {
        if (progress.phase === "opening") {
          status.textContent =
            `Sampling opening poses… ${progress.checked.toLocaleString()} / ` +
            `${progress.total.toLocaleString()} orientations, ` +
            `${progress.candidates.toLocaleString()} candidates`;
          return;
        }
        status.textContent =
          `Planning… ${progress.iteration.toLocaleString()} / ` +
          `${progress.maxIterations.toLocaleString()} iterations, ` +
          `${progress.nodes.toLocaleString()} nodes`;
      },
    });
  runButton.disabled = false;
  simulationResult = result;
  showHeuristicCheckpoints(result.checkpoints ?? []);
  if (!result.possible) {
    if (result.path?.length) {
      status.textContent = `${result.failureReason} Inspect the failed checkpoint.`;
      showRoute(result.path);
      setSimulationActionsEnabled(true);
      setFurniturePose(result.path[0]);
      fitTopCamera(environment.bounds);
      fitRouteVideoCamera(environment.bounds);
      document.querySelector("#simulationActions").hidden = false;
      document.querySelector("#topView").hidden = false;
      document.querySelector("#routeVideoPanel").hidden = false;
      animationPlaying = true;
      setHallwayTransparency(true);
      animationLastTime = performance.now();
      document.querySelector("#playRoute").textContent = "Pause route";
      document.querySelector("#videoPlayRoute").textContent = "Pause";
      updateHeuristicCheckpointState(0);
      return;
    }
    const shownCandidates = showBestEntrancePoses(
      result.bestEntrancePoses ?? [],
    );
    const searchHint = result.failureStage
      ? " Check the opening, furniture dimensions, clearance, and roll setting."
      : " Increase max iterations or rerun the probabilistic search.";
    status.textContent =
      `${result.failureReason}` +
      (shownCandidates ? " Best entrance poses are shown." : "") +
      searchHint;
    return;
  }

  status.textContent = result.solver === "heuristic"
    ? `Heuristic route completed: ${result.path.length} animation frames.`
    : `Route found: ${result.path.length} collision-free animation frames.`;
  showRoute(result.path);
  setSimulationActionsEnabled(true);
  setFurniturePose(result.path[0]);
  fitTopCamera(environment.bounds);
  fitRouteVideoCamera(environment.bounds);
  document.querySelector("#simulationActions").hidden = false;
  document.querySelector("#topView").hidden = false;
  document.querySelector("#routeVideoPanel").hidden = false;
  animationPlaying = true;
  setHallwayTransparency(true);
  animationLastTime = performance.now();
  document.querySelector("#playRoute").textContent = "Pause route";
  document.querySelector("#videoPlayRoute").textContent = "Pause";
  updateHeuristicCheckpointState(0);
}

function clearRouteVisualization() {
  animationPlaying = false;
  setHallwayTransparency(modelConfirmed);
  simulationResult = null;
  furnitureMesh.visible = false;
  routeLine.visible = false;
  routeLine.geometry.dispose();
  routeLine.geometry = new THREE.BufferGeometry();
  clearRouteFrames();
  clearCheckpointFrames();
  const checkpointList = document.querySelector("#heuristicCheckpoints");
  checkpointList.replaceChildren();
  checkpointList.hidden = true;
  document.querySelector("#routeVideoPanel").hidden = true;
  document.querySelector("#simulationActions").hidden = true;
  document.querySelector("#topView").hidden = true;
  document.querySelector("#playRoute").textContent = "Play route";
  document.querySelector("#videoPlayRoute").textContent = "Play";
  setSimulationActionsEnabled(false);
}

function setSimulationActionsEnabled(enabled) {
  ["playRoute", "showRouteFrames", "exportRoute", "routeScrub"].forEach((id) => {
    document.querySelector(`#${id}`).disabled = !enabled;
  });
}

function showRoute(path) {
  const points = path.map((pose) => new THREE.Vector3(pose.x, pose.y, pose.z));
  routeLine.geometry.dispose();
  routeLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
  routeLine.visible = true;
  furnitureMesh.geometry.dispose();
  furnitureMesh.geometry = new THREE.BoxGeometry(
    simulationFurniture.length,
    simulationFurniture.width,
    simulationFurniture.height,
  );
  furnitureMesh.visible = true;
  const scrub = document.querySelector("#routeScrub");
  scrub.max = String(path.length - 1);
  scrub.value = "0";
  const videoScrub = document.querySelector("#videoRouteScrub");
  videoScrub.max = String(path.length - 1);
  videoScrub.value = "0";
  animationFrameIndex = 0;
  rebuildRouteFrames();
}

function showBestEntrancePoses(poses) {
  clearRouteFrames();
  if (!poses.length) return false;
  const geometry = new THREE.BoxGeometry(
    simulationFurniture.length,
    simulationFurniture.width,
    simulationFurniture.height,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0xe29c32,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    depthTest: false,
  });
  poses.forEach((pose) => {
    const frame = new THREE.Mesh(geometry, material);
    frame.position.set(pose.x, pose.y, pose.z);
    frame.quaternion.copy(poseQuaternion(pose));
    frame.renderOrder = 10;
    routeFrames.add(frame);
  });
  setHallwayTransparency(true);
  return true;
}

function setFurniturePose(pose, clearanceOverride = null) {
  furnitureMesh.position.set(pose.x, pose.y, pose.z);
  furnitureMesh.quaternion.copy(poseQuaternion(pose));
  const clearance = clearanceOverride ??
    (Number(document.querySelector("#clearance").value) || 0);
  const inside = isPoseValid(
    pose,
    simulationFurniture,
    simulationEnvironment,
    clearance,
  );
  const portalValid =
    !inside &&
    simulationEnvironment?.entrance &&
    simulationEnvironment?.exit &&
    isPoseValidThroughOpenings(
      pose,
      simulationFurniture,
      simulationEnvironment,
      clearance,
      [
        {
          ...simulationEnvironment.entrance,
          unboundedExterior: true,
        },
        {
          ...simulationEnvironment.exit,
          unboundedExterior: true,
        },
      ],
    );
  const valid = inside || portalValid;
  const roomy = inside && isPoseValid(
    pose,
    simulationFurniture,
    simulationEnvironment,
    clearance * 1.75 + 0.02,
  );
  furnitureMaterial.color.setHex(
    valid ? (roomy ? 0x2eaf68 : 0xe6b83f) : 0xd94d45,
  );
}

function rebuildRouteFrames() {
  clearRouteFrames();
  if (
    !simulationResult?.path?.length ||
    !document.querySelector("#showRouteFrames").checked
  ) {
    return;
  }
  const path = simulationResult.path;
  const stride = Math.max(1, Math.ceil(path.length / 28));
  const geometry = new THREE.BoxGeometry(
    simulationFurniture.length,
    simulationFurniture.width,
    simulationFurniture.height,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0x2f8fbd,
    wireframe: true,
    transparent: true,
    opacity: 0.22,
  });
  for (let index = 0; index < path.length; index += stride) {
    const frame = new THREE.Mesh(geometry, material);
    frame.position.set(path[index].x, path[index].y, path[index].z);
    frame.quaternion.copy(poseQuaternion(path[index]));
    routeFrames.add(frame);
  }
}

function showHeuristicCheckpoints(checkpoints) {
  clearCheckpointFrames();
  const list = document.querySelector("#heuristicCheckpoints");
  list.replaceChildren();
  list.hidden = !checkpoints.length;
  if (!checkpoints.length) return;
  checkpoints.forEach((checkpoint, checkpointIndex) => {
    const item = document.createElement("li");
    item.dataset.checkpointIndex = String(checkpointIndex);
    item.dataset.pathIndex = String(checkpoint.index);
    item.classList.toggle("is-failed", checkpoint.status === "failed");
    const title = document.createElement("strong");
    title.textContent = checkpoint.label;
    const detail = document.createElement("span");
    detail.textContent = ` ${checkpoint.details}`;
    item.append(title, detail);
    item.addEventListener("click", () => {
      animationPlaying = false;
      animationFrameIndex = checkpoint.index;
      document.querySelector("#routeScrub").value = String(checkpoint.index);
      document.querySelector("#videoRouteScrub").value =
        String(checkpoint.index);
      document.querySelector("#playRoute").textContent = "Play route";
      document.querySelector("#videoPlayRoute").textContent = "Play";
      setFurniturePose(checkpoint.pose);
      updateHeuristicCheckpointState(checkpoint.index);
    });
    list.append(item);

    const geometry = new THREE.BoxGeometry(
      simulationFurniture.length,
      simulationFurniture.width,
      simulationFurniture.height,
    );
    const material = new THREE.MeshBasicMaterial({
      color: checkpoint.status === "failed" ? 0xc54b42 : 0x257ca3,
      wireframe: true,
      transparent: true,
      opacity: checkpoint.status === "failed" ? 0.75 : 0.38,
      depthTest: false,
    });
    const frame = new THREE.Mesh(geometry, material);
    frame.position.set(
      checkpoint.pose.x,
      checkpoint.pose.y,
      checkpoint.pose.z,
    );
    frame.quaternion.copy(poseQuaternion(checkpoint.pose));
    frame.renderOrder = 10;
    checkpointFrames.add(frame);
  });
}

function updateHeuristicCheckpointState(pathIndex) {
  const items = [
    ...document.querySelectorAll("#heuristicCheckpoints li"),
  ];
  let active = -1;
  items.forEach((item, index) => {
    if (Number(item.dataset.pathIndex) <= pathIndex) active = index;
  });
  items.forEach((item, index) => {
    item.classList.toggle("is-active", index === active);
  });
  if (active >= 0 && simulationResult?.checkpoints?.[active]) {
    const checkpoint = simulationResult.checkpoints[active];
    document.querySelector("#simulationStatus").textContent =
      `${checkpoint.label}: ${checkpoint.details}`;
  }
}

function clearRouteFrames() {
  clearFrameGroup(routeFrames);
}

function clearCheckpointFrames() {
  clearFrameGroup(checkpointFrames);
}

function clearFrameGroup(group) {
  const geometries = new Set();
  const materials = new Set();
  group.children.forEach((frame) => {
    if (frame.geometry) geometries.add(frame.geometry);
    if (Array.isArray(frame.material)) {
      frame.material.forEach((material) => materials.add(material));
    } else if (frame.material) {
      materials.add(frame.material);
    }
  });
  group.clear();
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function fitTopCamera(bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const half = Math.max(size.x, size.y, 1) * 0.65;
  const aspect = Math.max(1, topViewHost.clientWidth / topViewHost.clientHeight);
  topCamera.left = -half * aspect;
  topCamera.right = half * aspect;
  topCamera.top = half;
  topCamera.bottom = -half;
  topCamera.position.set(center.x, center.y, bounds.max.z + Math.max(20, size.z * 3));
  topCamera.up.set(0, 1, 0);
  topCamera.lookAt(center);
  topCamera.updateProjectionMatrix();
}

function fitRouteVideoCamera(bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(4, size.length() * 0.8);
  routeVideoCamera.position
    .copy(center)
    .add(new THREE.Vector3(radius, -radius, radius * 0.75));
  routeVideoCamera.near = Math.max(0.01, radius / 100);
  routeVideoCamera.far = radius * 10;
  routeVideoCamera.lookAt(center);
  routeVideoCamera.updateProjectionMatrix();
  routeVideoControls.target.copy(center);
  routeVideoControls.update();
}

function toggleRoutePlayback() {
  if (!simulationResult?.path?.length) return;
  animationPlaying = !animationPlaying;
  setHallwayTransparency(modelConfirmed);
  animationLastTime = performance.now();
  document.querySelector("#playRoute").textContent =
    animationPlaying ? "Pause route" : "Play route";
  document.querySelector("#videoPlayRoute").textContent =
    animationPlaying ? "Pause" : "Play";
}

function setHallwayTransparency(active) {
  const shouldFade = modelConfirmed || active;
  objects.forEach((object) => {
    object.materials.forEach((material) => {
      material.transparent = shouldFade;
      material.opacity = shouldFade ? 0.32 : 1;
      material.depthWrite = !shouldFade;
      material.needsUpdate = true;
    });
  });
}

function exportRoute() {
  if (!simulationResult) return;
  const payload = {
    ...simulationResult,
    furniture: simulationFurniture,
    clearance: Number(document.querySelector("#clearance").value) || 0,
    entrance: simulationEnvironment.entrance.name,
    exit: simulationEnvironment.exit.name,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "furniture-route.json";
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelector("#startJoin").addEventListener("click", startJoin);
document.querySelector("#cancelJoin").addEventListener("click", cancelJoin);
document.querySelector("#discardJoin").addEventListener("click", cancelJoin);
document.querySelector("#applyJoin").addEventListener("click", applyJoin);
document.querySelector("#editAttachment").addEventListener("click", editSelectedAttachment);
document.querySelector("#detachAttachment").addEventListener("click", detachSelectedAttachment);
document.querySelectorAll(".group-rotation button").forEach((button) => {
  button.addEventListener("click", () => {
    rotateSelectedGroup(button.dataset.axis, Number(button.dataset.angle));
  });
});
document.querySelector("#runSimulation").addEventListener("click", () => {
  runSimulation();
});
document.querySelector("#measureSurfaces").addEventListener("click", toggleMeasurementMode);
document.querySelector("#clearMeasurement").addEventListener("click", () => {
  measurementMode = false;
  document.querySelector("#measureSurfaces").classList.remove("is-active");
  document.querySelector("#measureSurfaces").textContent =
    "Measure parallel surfaces";
  clearMeasurement();
});
document.querySelector("#manualZ").addEventListener("input", (event) => {
  const manualPose = manualModeController.getPose();
  if (!manualPose) return;
  manualModeController.tryManualPose({
    ...manualPose,
    z: Number(event.target.value),
  });
});
[
  ["manualYaw", "yaw"],
  ["manualPitch", "pitch"],
  ["manualRoll", "roll"],
].forEach(([id, key]) => {
  document.querySelector(`#${id}`).addEventListener("input", (event) => {
    const manualPose = manualModeController.getPose();
    if (!manualPose) return;
    manualModeController.tryManualPose({
      ...manualPose,
      [key]: THREE.MathUtils.degToRad(Number(event.target.value)),
    });
  });
});
document.querySelector("#startManual").addEventListener("click", () => {
  measurementMode = false;
  document.querySelector("#measureSurfaces").classList.remove("is-active");
  document.querySelector("#measureSurfaces").textContent =
    "Measure parallel surfaces";
  manualModeController.startManualChallenge();
});
document.querySelector("#stopManual").addEventListener("click", () => {
  manualModeController.stopManualChallenge();
});
document.querySelector("#resetManual").addEventListener("click", () => {
  manualModeController.resetManualChallenge();
});
document.querySelector("#clearManualTrail").addEventListener("click", () => {
  manualModeController.clearManualTrail();
});
document.querySelector("#continueWithSolver").addEventListener("click", () => {
  const startPose = manualModeController.getInsidePose();
  if (!startPose) {
    document.querySelector("#manualStatus").textContent =
      "Move the furniture fully inside before handing off to the solver.";
    return;
  }
  manualModeController.stopManualChallenge();
  runSimulation(startPose);
});
document.querySelector("#manualIgnoreEntrance").addEventListener("change", () => {
  manualModeController.updateEntranceOption();
});
document.querySelector("#startAutoPilot").addEventListener("click", () => {
  manualModeController.startAutoPilot();
});
document.querySelector("#stopAutoPilot").addEventListener("click", () => {
  manualModeController.stopAutoPilot();
});
[
  ["autoPilotTwist", "twist"],
  ["autoPilotOffsetU", "offsetU"],
  ["autoPilotOffsetV", "offsetV"],
  ["autoPilotTravel", "travel"],
].forEach(([id, key]) => {
  document.querySelector(`#${id}`).addEventListener("input", (event) => {
    manualModeController.applyAutoPilotControl(
      key,
      Number(event.target.value),
    );
  });
});
document.querySelector("#playRoute").addEventListener("click", toggleRoutePlayback);
document.querySelector("#videoPlayRoute").addEventListener("click", toggleRoutePlayback);
document.querySelector("#showRouteFrames").addEventListener("change", rebuildRouteFrames);
document.querySelector("#exportRoute").addEventListener("click", exportRoute);
document.querySelector("#confirmModel").addEventListener("click", confirmModel);
document.querySelector("#editModel").addEventListener("click", editModel);
document.querySelector("#pickOpenings").addEventListener("click", () => {
  setOpeningPickArmed(!openingPickArmed);
});
document.querySelector("#viewFurniture").addEventListener("click", viewFurniture);
document.querySelector("#closeRouteVideo").addEventListener("click", () => {
  animationPlaying = false;
  setHallwayTransparency(modelConfirmed);
  document.querySelector("#playRoute").textContent = "Play route";
  document.querySelector("#videoPlayRoute").textContent = "Play";
  document.querySelector("#routeVideoPanel").hidden = true;
});
function scrubRoute(event) {
  if (!simulationResult?.path?.length) return;
  animationPlaying = false;
  setHallwayTransparency(modelConfirmed);
  document.querySelector("#playRoute").textContent = "Play route";
  document.querySelector("#videoPlayRoute").textContent = "Play";
  animationFrameIndex = Number(event.target.value);
  document.querySelector("#routeScrub").value = String(animationFrameIndex);
  document.querySelector("#videoRouteScrub").value = String(animationFrameIndex);
  setFurniturePose(simulationResult.path[animationFrameIndex]);
  updateHeuristicCheckpointState(animationFrameIndex);
}
document.querySelector("#routeScrub").addEventListener("input", scrubRoute);
document.querySelector("#videoRouteScrub").addEventListener("input", scrubRoute);
document.querySelector("#saveProject").addEventListener("click", saveProject);
document.querySelector("#loadProject").addEventListener("click", () => {
  document.querySelector("#projectFile").click();
});
document.querySelector("#projectFile").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) await loadProjectFile(file);
  event.target.value = "";
});
document.querySelector("#entranceFace").addEventListener("change", () => {
  openingPickRole = "exit";
  refreshOpeningHighlights();
});
document.querySelector("#exitFace").addEventListener("change", () => {
  openingPickRole = "entrance";
  refreshOpeningHighlights();
});
["joinRotation", "joinOffsetU", "joinOffsetV"].forEach((id) => {
  document.querySelector(`#${id}`).addEventListener("input", updateJoinPreview);
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
const dragPoint = new THREE.Vector3();
const lastValidPosition = new THREE.Vector3();
let draggedObject = null;
let draggedMembers = [];
let dragBasePoses = null;
let hoveredLabel = null;

function setPointer(event) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function updateHoveredLabel(event) {
  if (document.querySelector("#showAnnotations").checked || draggedObject) return;

  if (hoveredLabel) {
    hoveredLabel.visible = false;
    hoveredLabel = null;
  }

  const bounds = renderer.domElement.getBoundingClientRect();
  const mouseX = event.clientX - bounds.left;
  const mouseY = event.clientY - bounds.top;
  let closest = null;
  let closestDistance = 12;

  objects.forEach((object) => {
    object.vectors.forEach((vector, index) => {
      const start = object.root.position.clone().project(camera);
      const end = vector
        .clone()
        .applyQuaternion(object.root.quaternion)
        .add(object.root.position)
        .project(camera);
      const startX = (start.x * 0.5 + 0.5) * bounds.width;
      const startY = (-start.y * 0.5 + 0.5) * bounds.height;
      const endX = (end.x * 0.5 + 0.5) * bounds.width;
      const endY = (-end.y * 0.5 + 0.5) * bounds.height;
      const distance = distanceToSegment(
        mouseX,
        mouseY,
        startX,
        startY,
        endX,
        endY,
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = object.vectorLabels[index];
      }
    });
  });

  if (closest) {
    closest.visible = true;
    hoveredLabel = closest;
  }
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
  const t = THREE.MathUtils.clamp(
    ((px - x1) * dx + (py - y1) * dy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (manualModeController.handlePointerDown(event)) return;
  setPointer(event);
  if (measurementMode) {
    const hits = raycaster.intersectObjects(
      objects.map((object) => object.mesh),
      false,
    );
    if (hits.length) {
      selectMeasurementFace(hits[0]);
      event.preventDefault();
    }
    return;
  }
  const hits = raycaster.intersectObjects(objects.map((object) => object.mesh), false);
  if (!hits.length) return;

  if (joinState?.phase === "preview") {
    const hit = hits[0];
    const object = hit.object.userData.object;
    const faceIndex = Math.floor(hit.faceIndex / 2);
    const selectedFaceIndex = joinState.faces.findIndex(
      (selection) =>
        selection.object === object && selection.faceIndex === faceIndex,
    );
    if (selectedFaceIndex >= 0) unpickJoinFace(selectedFaceIndex);
    event.preventDefault();
    return;
  }
  if (joinState) {
    handleJoinPick(hits[0]);
    event.preventDefault();
    return;
  }

  if (!modelConfirmed && openingPickArmed) {
    pickOpeningFromSurface(hits[0]);
    event.preventDefault();
    return;
  }

  if (modelConfirmed) {
    selectObject(hits[0].object.userData.object);
    event.preventDefault();
    return;
  }

  draggedObject = hits[0].object.userData.object;
  clearMeasurement();
  clearRouteVisualization();
  draggedMembers = connectedObjects(draggedObject);
  dragBasePoses = capturePoses(draggedMembers);
  selectObject(draggedObject);
  controls.enabled = false;
  renderer.domElement.classList.add("is-dragging");
  renderer.domElement.setPointerCapture(event.pointerId);
  dragPlane.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()),
    hits[0].point,
  );
  dragOffset.copy(hits[0].point).sub(draggedObject.root.position);
  lastValidPosition.copy(draggedObject.root.position);
  event.preventDefault();
});

renderer.domElement.addEventListener("pointermove", (event) => {
  updateHoveredLabel(event);
  if (manualModeController.handlePointerMove(event)) return;
  if (!draggedObject) return;
  setPointer(event);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;

  const desired = dragPoint.clone().sub(dragOffset);
  const anchorStart = dragBasePoses.get(draggedObject).position;
  const posesAt = (position) =>
    translatedPoses(dragBasePoses, position.clone().sub(anchorStart));
  const collides = (position) =>
    posesCollide(draggedMembers, posesAt(position));
  const travel = lastValidPosition.distanceTo(desired);
  const sampleCount = Math.max(1, Math.ceil(travel / 0.12));
  let firstBlocked = null;
  let safe = lastValidPosition.clone();

  for (let index = 1; index <= sampleCount; index += 1) {
    const sample = lastValidPosition.clone().lerp(desired, index / sampleCount);
    if (collides(sample)) {
      firstBlocked = sample;
      break;
    }
    safe = sample;
  }

  if (!firstBlocked) {
    applyPoses(posesAt(desired));
    lastValidPosition.copy(desired);
    return;
  }

  let blocked = firstBlocked;
  for (let index = 0; index < 18; index += 1) {
    const midpoint = safe.clone().lerp(blocked, 0.5);
    if (collides(midpoint)) blocked = midpoint;
    else safe = midpoint;
  }
  applyPoses(posesAt(safe));
  lastValidPosition.copy(safe);
});

function stopObjectDrag(event) {
  if (manualModeController.handlePointerUp(event)) return;
  if (!draggedObject) return;
  draggedObject = null;
  draggedMembers = [];
  dragBasePoses = null;
  controls.enabled = true;
  renderer.domElement.classList.remove("is-dragging");
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
}

renderer.domElement.addEventListener("pointerup", stopObjectDrag);
renderer.domElement.addEventListener("pointercancel", stopObjectDrag);
renderer.domElement.addEventListener("pointerleave", () => {
  if (hoveredLabel && !document.querySelector("#showAnnotations").checked) {
    hoveredLabel.visible = false;
    hoveredLabel = null;
  }
});

window.addEventListener("keydown", (event) => {
  if (manualModeController.handleKeyDown(event)) return;
});

window.addEventListener("keyup", (event) => {
  if (manualModeController.handleKeyUp(event)) return;
});

window.addEventListener("blur", () => {
  manualModeController.handleBlur();
});

document.querySelector("#reset").addEventListener("click", () => {
  if (!selectedObject) return;
  clearRouteVisualization();
  const geometry = calculateGeometry(defaults);
  const oldGeometry = {
    vectors: selectedObject.vectors,
    vertices: selectedObject.vertices,
  };
  const oldPosition = selectedObject.root.position.clone();
  const oldQuaternion = selectedObject.root.quaternion.clone();
  applyGeometry(selectedObject, geometry);
  selectedObject.root.position.set(0, 0, 0);
  selectedObject.root.quaternion.identity();
  if (objects.some((other) => other !== selectedObject && objectsOverlap(selectedObject, other))) {
    applyGeometry(selectedObject, oldGeometry);
    selectedObject.root.position.copy(oldPosition);
    selectedObject.root.quaternion.copy(oldQuaternion);
    document.querySelector("#angleError").textContent =
      "Reset is blocked because another object occupies that space.";
    return;
  }
  selectedObject.params = { ...defaults };
  syncFields(defaults);
  updateReadout();
  camera.position.set(9, -11, 8);
  controls.target.set(1.7, 1.4, 1.5);
  controls.update();
});

function resize() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  const previewWidth = previewHost.clientWidth || 310;
  const previewHeight = previewHost.clientHeight || 180;
  previewRenderer.setSize(previewWidth, previewHeight, false);
  previewCamera.aspect = previewWidth / previewHeight;
  previewCamera.updateProjectionMatrix();

  const topWidth = topViewHost.clientWidth || 300;
  const topHeight = topViewHost.clientHeight || 130;
  topRenderer.setSize(topWidth, topHeight, false);

  const videoWidth = routeVideoHost.clientWidth || 520;
  const videoHeight = routeVideoHost.clientHeight || 320;
  routeVideoRenderer.setSize(videoWidth, videoHeight, false);
  routeVideoCamera.aspect = videoWidth / videoHeight;
  routeVideoCamera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(sceneHost);
window.addEventListener("resize", resize);

createSolid(defaults);
resize();
applyWorkflowLocks();
updateOpeningOptions();

function animate() {
  const now = performance.now();
  if (animationPlaying && simulationResult?.path?.length) {
    if (now - animationLastTime >= 120) {
      animationLastTime = now;
      animationFrameIndex += 1;
      if (animationFrameIndex >= simulationResult.path.length) {
        animationFrameIndex = simulationResult.path.length - 1;
        animationPlaying = false;
        setHallwayTransparency(modelConfirmed);
        document.querySelector("#playRoute").textContent = "Play route";
        document.querySelector("#videoPlayRoute").textContent = "Play";
      }
      document.querySelector("#routeScrub").value = String(animationFrameIndex);
      document.querySelector("#videoRouteScrub").value = String(animationFrameIndex);
      setFurniturePose(simulationResult.path[animationFrameIndex]);
      updateHeuristicCheckpointState(animationFrameIndex);
    }
  }
  refreshOpeningsWhileEditing(now);
  updateFurniturePreview();
  controls.update();
  routeVideoControls.update();
  renderer.render(scene, camera);
  topRenderer.render(scene, topCamera);
  if (!document.querySelector("#routeVideoPanel").hidden) {
    routeVideoRenderer.render(scene, routeVideoCamera);
  }
  if (!document.querySelector("#joinPanel").hidden) {
    previewRenderer.render(scene, previewCamera);
  }
  requestAnimationFrame(animate);
}

animate();
