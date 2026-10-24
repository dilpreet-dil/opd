import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Compass, Gamepad2, Maximize2, Pause, Play, RotateCcw } from 'lucide-react';
import type { HospitalMap, HospitalRoom } from './pathfinding.mjs';
import { findRoute, routeDistance } from './pathfinding.mjs';

const SCALE = 0.06;
const FLOOR_HEIGHT = 4.2;
const worldPoint = (x: number, z: number, floor: number) => new THREE.Vector3((x - 420) * SCALE, floor * FLOOR_HEIGHT, (z - 320) * SCALE);
const centerOf = (room: HospitalRoom) => ({ x: room.x + room.width / 2, z: room.y + room.height / 2 });
const portalOf = (hospital: HospitalMap, room: HospitalRoom) => {
  const side = hospital.doors.find((door) => door.node === room.node)?.side;
  const center = centerOf(room);
  if (side === 'west') return { x: room.x - 13, z: center.z };
  if (side === 'east') return { x: room.x + room.width + 13, z: center.z };
  if (side === 'north') return { x: center.x, z: room.y - 13 };
  if (side === 'south') return { x: center.x, z: room.y + room.height + 13 };
  return center;
};
const roomColors: Record<string, number> = { entrance: 0xdbeee0, service: 0xe4eafa, emergency: 0xf7dcd6, lab: 0xf7ecd2, amenity: 0xdceee7, vertical: 0xe8e0f2, pharmacy: 0xf6e5d2, opd: 0xdde9f5, ward: 0xebe1f0 };
const roomByNode = (hospital: HospitalMap, node: string) => hospital.rooms.find((room) => room.node === node);
type LiftTravel = { from: THREE.Vector3; to: THREE.Vector3; elapsed: number; targetNode: string; targetFloor: number };

type Props = { hospital: HospitalMap; start: string; destination: string; accessible: boolean; floor: number; autoWalk?: boolean; autoWalkRequest?: number; onGuidedComplete?: () => void; onNodeChange: (node: string) => void; onFloorChange: (floor: number) => void; onProgressChange: (progress: number) => void; onMovementStart: () => void; hindi: boolean };
type Input = { x: number; y: number };

function makeLabel(text: string, background: string, foreground = '#28483e') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = background; context.beginPath(); context.roundRect(8, 8, 496, 112, 28); context.fill();
  context.fillStyle = foreground; context.font = '700 38px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 65, 460);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function addBox(parent: THREE.Group, width: number, height: number, depth: number, x: number, y: number, z: number, color: number, material?: Partial<THREE.MeshStandardMaterial>) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color, roughness: .78, ...material }));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function parseCorridorPath(path: string) {
  const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? []; const segments: Array<[number, number, number, number]> = [];
  let index = 0; let x = 0; let z = 0; let command = '';
  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) command = tokens[index++];
    if (command === 'M' || command === 'L') { const previousCommand = command; const nx = Number(tokens[index++]); const nz = Number(tokens[index++]); if (previousCommand === 'L') segments.push([x, z, nx, nz]); x = nx; z = nz; command = 'L'; }
    else if (command === 'H') { const nx = Number(tokens[index++]); segments.push([x, z, nx, z]); x = nx; }
    else if (command === 'V') { const nz = Number(tokens[index++]); segments.push([x, z, x, nz]); z = nz; }
    else if (!command) index++;
  }
  return segments;
}

export default function HospitalGame3D({ hospital, start, destination, accessible, floor, autoWalk = false, autoWalkRequest = 0, onGuidedComplete, onNodeChange, onFloorChange, onProgressChange, onMovementStart, hindi }: Props) {
  const mountRef = useRef<HTMLDivElement>(null); const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null); const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const actorRef = useRef<THREE.Group | null>(null); const routeGroupRef = useRef<THREE.Group | null>(null);
  const inputRef = useRef<Input>({ x: 0, y: 0 }); const keysRef = useRef<Set<string>>(new Set()); const yawRef = useRef(0); const pitchRef = useRef(.48); const distanceRef = useRef(12);
  const currentNodeRef = useRef(start); const activeEdgeRef = useRef<string | null>(null); const liftTravelRef = useRef<LiftTravel | null>(null); const nodeChangeRef = useRef(onNodeChange); const floorChangeRef = useRef(onFloorChange);
  const progressChangeRef = useRef(onProgressChange);
  const destinationRef = useRef(destination); const accessibleRef = useRef(accessible); const floorRef = useRef(floor); const cameraModeRef = useRef<'third' | 'top'>('third');
  const destinationDoors = useRef(new Map<string, THREE.Object3D>()); const playingRef = useRef(false); const sprintRef = useRef(false);
  const guideActiveRef = useRef(false);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>()); const lastPinch = useRef(0); const lookPointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const legRefs = useRef<THREE.Group[]>([]); const [playing, setPlaying] = useState(false); const [liftMoving, setLiftMoving] = useState(false); const [cameraMode, setCameraMode] = useState<'third' | 'top'>('third');
  const [joystick, setJoystick] = useState({ x: 0, y: 0 }); const [nearNode, setNearNode] = useState(start); const [zoom, setZoom] = useState(12); const [heading, setHeading] = useState(0);
  nodeChangeRef.current = onNodeChange; floorChangeRef.current = onFloorChange; progressChangeRef.current = onProgressChange; destinationRef.current = destination; accessibleRef.current = accessible; floorRef.current = floor; cameraModeRef.current = cameraMode; playingRef.current = playing;
  const route = findRoute(hospital, start, destination, accessible);
  const routeRef = useRef(route); routeRef.current = route;
  const guidedCompleteRef = useRef(onGuidedComplete); guidedCompleteRef.current = onGuidedComplete;

  useEffect(() => {
    if (autoWalk) {
      guideActiveRef.current = true; activeEdgeRef.current = null; inputRef.current = { x: 0, y: 0 }; keysRef.current.clear();
      playingRef.current = true; setPlaying(true);
    } else if (guideActiveRef.current) {
      guideActiveRef.current = false; playingRef.current = false; inputRef.current = { x: 0, y: 0 }; activeEdgeRef.current = null; setPlaying(false);
    }
  }, [autoWalk, autoWalkRequest]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#dcebe0'); scene.fog = new THREE.Fog('#dcebe0', 42, 110); sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, .1, 150); cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(mount.clientWidth, mount.clientHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; mount.appendChild(renderer.domElement); rendererRef.current = renderer;
    scene.add(new THREE.HemisphereLight(0xf4fbff, 0x82937b, 2));
    const sun = new THREE.DirectionalLight(0xfff0d6, 3.5); sun.position.set(-18, 35, -18); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -35; sun.shadow.camera.right = 35; sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35; scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 58), new THREE.MeshStandardMaterial({ color: 0xc9ddc8, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -.45, 0); ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(72, 48, 0xaec7b2, 0xd6e4d3); grid.position.y = -.42; scene.add(grid);
    const allBuildings = new THREE.Group(); scene.add(allBuildings); const floorGroups = new Map<number, THREE.Group>(); const doorPivots = new Map<string, THREE.Object3D>();

    for (const level of hospital.floors) {
      const fy = level.level * FLOOR_HEIGHT; const floorGroup = new THREE.Group(); floorGroup.position.y = fy; allBuildings.add(floorGroup); floorGroups.set(level.level, floorGroup);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(52, .28, 40), new THREE.MeshStandardMaterial({ color: level.level % 2 ? 0xd4e0d8 : 0xdce7dd, roughness: .88 })); slab.position.y = -.18; slab.receiveShadow = true; floorGroup.add(slab);
      for (const [x1, z1, x2, z2] of hospital.corridors.filter((corridor) => corridor.floor === level.level).flatMap((corridor) => parseCorridorPath(corridor.path))) {
        const a = worldPoint(x1, z1, 0); const b = worldPoint(x2, z2, 0); const length = Math.hypot(b.x - a.x, b.z - a.z); if (length < .1) continue;
        const pathFloor = new THREE.Mesh(new THREE.BoxGeometry(length, .025, 2.5), new THREE.MeshStandardMaterial({ color: 0xf5f4e9, roughness: .72 }));
        pathFloor.position.set((a.x + b.x) / 2, -.015, (a.z + b.z) / 2); pathFloor.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); pathFloor.receiveShadow = true; floorGroup.add(pathFloor);
        const seam = new THREE.Mesh(new THREE.BoxGeometry(length, .015, .035), new THREE.MeshStandardMaterial({ color: 0xd5e0d7, roughness: .9 })); seam.position.copy(pathFloor.position); seam.position.y += .02; seam.rotation.y = pathFloor.rotation.y; floorGroup.add(seam);
      }
      for (const room of hospital.rooms.filter((item) => item.floor === level.level)) {
        const c = centerOf(room); const p = worldPoint(c.x, c.z, 0); const w = room.width * SCALE; const d = room.height * SCALE; const wallH = 2.5; const wallT = .16;
        const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(w, .07, d), new THREE.MeshStandardMaterial({ color: roomColors[room.type] ?? 0xe8eeea, roughness: .92 })); floorMesh.position.set(p.x, .01, p.z); floorMesh.receiveShadow = true; floorGroup.add(floorMesh);
        const doorSide = hospital.doors.find((door) => door.node === room.node)?.side; const gap = 1.4;
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xf3f4e9, roughness: .82 });
        const addWallPiece = (width: number, depth: number, x: number, z: number) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, wallH, depth), wallMat); mesh.position.set(p.x + x, wallH / 2 + .04, p.z + z); mesh.castShadow = true; mesh.receiveShadow = true; floorGroup.add(mesh); };
        if (doorSide === 'north' || doorSide === 'south') {
          const segment = Math.max(.15, (w - gap) / 2); const sign = doorSide === 'north' ? -1 : 1; const z = sign * d / 2;
          addWallPiece(segment, wallT, -((w + gap) / 4), z); addWallPiece(segment, wallT, (w + gap) / 4, z); addBox(floorGroup, gap, wallH - 2.1, wallT, p.x, wallH - 1.05, p.z + z, 0xf3f4e9);
          const doorX = p.x; const doorZ = p.z + z; const hinge = new THREE.Group(); hinge.position.set(doorX - gap / 2, .04, doorZ); floorGroup.add(hinge);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(gap, 2.1, .09), new THREE.MeshStandardMaterial({ color: 0x9b7958, roughness: .65 })); leaf.position.set(gap / 2, 1.05, 0); leaf.castShadow = true; hinge.add(leaf); doorPivots.set(room.node, hinge);
          addBox(floorGroup, .08, 2.25, .14, p.x - gap / 2, 1.16, doorZ, 0xb69a77); addBox(floorGroup, .08, 2.25, .14, p.x + gap / 2, 1.16, doorZ, 0xb69a77); addBox(floorGroup, gap, .12, .14, p.x, 2.28, doorZ, 0xc5ab86);
        } else if (doorSide === 'west' || doorSide === 'east') {
          const segment = Math.max(.15, (d - gap) / 2); const sign = doorSide === 'west' ? -1 : 1; const x = sign * w / 2;
          addWallPiece(wallT, segment, x, -((d + gap) / 4)); addWallPiece(wallT, segment, x, (d + gap) / 4);
          const doorX = p.x + x; const doorZ = p.z; const hinge = new THREE.Group(); hinge.position.set(doorX, .04, doorZ - gap / 2); floorGroup.add(hinge);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(.09, 2.1, gap), new THREE.MeshStandardMaterial({ color: 0x9b7958, roughness: .65 })); leaf.position.set(0, 1.05, gap / 2); leaf.castShadow = true; hinge.add(leaf); doorPivots.set(room.node, hinge);
          addBox(floorGroup, .14, 2.25, .08, doorX, 1.16, p.z - gap / 2, 0xb69a77); addBox(floorGroup, .14, 2.25, .08, doorX, 1.16, p.z + gap / 2, 0xb69a77); addBox(floorGroup, .14, .12, gap, doorX, 2.28, p.z, 0xc5ab86);
        } else { addWallPiece(w, wallT, 0, -d / 2); addWallPiece(w, wallT, 0, d / 2); addWallPiece(wallT, d, -w / 2, 0); addWallPiece(wallT, d, w / 2, 0); }

        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabel(room.name, '#ffffffed'), depthWrite: false, transparent: true })); label.position.set(p.x, 2.85, p.z); label.scale.set(Math.min(6.3, Math.max(3.2, w + .4)), .9, 1); floorGroup.add(label);
        if (room.type === 'ward') {
          const bed = new THREE.Group(); bed.position.set(p.x, .15, p.z + .18); floorGroup.add(bed);
          addBox(bed, 1.25, .3, .48, 0, .28, 0, 0xf4f3eb); addBox(bed, 1.32, .09, .58, 0, .12, 0, 0x7ba99a); addBox(bed, 1.3, .55, .06, 0, .36, -.27, 0xb2c6b9);
          for (const wheelX of [-.48, .48]) for (const wheelZ of [-.2, .2]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .06, 10), new THREE.MeshStandardMaterial({ color: 0x536a62 })); wheel.rotation.z = Math.PI / 2; wheel.position.set(wheelX, .07, wheelZ); bed.add(wheel); }
        } else if (room.type === 'service' || room.type === 'pharmacy' || room.type === 'lab') {
          addBox(floorGroup, Math.min(w * .65, 2.6), .78, .48, p.x, .43, p.z + d * .18, room.type === 'lab' ? 0xd7e9e1 : 0xc9bda7);
          if (room.type === 'lab') addBox(floorGroup, .5, .72, .5, p.x - .6, .92, p.z - .12, 0x8ba99d);
        }
        if (room.node === 'emergency') {
          addBox(floorGroup, 1.3, .24, .62, p.x + .35, .55, p.z - .15, 0xf6f5ee); addBox(floorGroup, 1.34, .08, .66, p.x + .35, .38, p.z - .15, 0x70a797);
          addBox(floorGroup, .38, .72, .24, p.x - .82, .92, p.z - .4, 0x78918c); addBox(floorGroup, .31, .38, .07, p.x - .82, 1.06, p.z - .25, 0x8bc4b6);
        }
        if (room.node === 'waitingA') for (let seat = -1; seat <= 1; seat++) { addBox(floorGroup, .5, .1, .42, p.x + seat * .72, .52, p.z, 0x5d8d7e); addBox(floorGroup, .5, .48, .08, p.x + seat * .72, .78, p.z + .18, 0x84a99c); }
        if (room.node.startsWith('toilet')) { addBox(floorGroup, .48, .82, .42, p.x, .45, p.z, 0xfaf9f2); addBox(floorGroup, .5, .08, .46, p.x, .88, p.z, 0xe0e9e4); }
        if (room.type === 'opd') { addBox(floorGroup, .62, .76, .48, p.x - .72, .42, p.z - .18, 0xb4c2b7); addBox(floorGroup, .5, .48, .06, p.x - .72, .97, p.z + .06, 0x6a9f91); }
        if (room.type === 'ward' || room.type === 'opd') addBox(floorGroup, Math.min(2.6, w * .42), .7, .06, p.x, 1.72, p.z - d / 2 - .06, 0xb8d8e1, { roughness: .3, metalness: .08 });
      }

      for (const room of hospital.rooms.filter((item) => item.floor === level.level && item.type === 'vertical')) {
        const c = centerOf(room); const p = worldPoint(c.x, c.z, 0);
        if (room.node.startsWith('stairs')) {
          const stair = new THREE.Group(); stair.position.set(p.x, .05, p.z); floorGroup.add(stair);
          for (let step = 0; step < 7; step++) addBox(stair, 1.1, .12, .35, 0, step * .16, -.95 + step * .31, 0xc9d4cb);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x91a79b, metalness: .2, roughness: .5 })); rail.position.set(.62, .65, 0); stair.add(rail);
        } else {
          const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.1, 1.6), new THREE.MeshStandardMaterial({ color: 0xdbe6ed, roughness: .3, metalness: .14, transparent: true, opacity: .62 })); shaft.position.set(p.x, 1.45, p.z); floorGroup.add(shaft);
          addBox(floorGroup, 1.25, 2.1, .07, p.x, 1.08, p.z + .81, 0x819a9b);
          for (const lightX of [-.35, .35]) { const light = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0x63c3a5, emissive: 0x28694e })); light.position.set(p.x + lightX, 2.55, p.z + .86); floorGroup.add(light); }
        }
      }
    }
    destinationDoors.current = doorPivots;

    const edgeGroup = new THREE.Group(); scene.add(edgeGroup);
    for (const [from, to] of hospital.edges) {
      const aRoom = roomByNode(hospital, from); const bRoom = roomByNode(hospital, to); if (!aRoom || !bRoom) continue;
      const a = portalOf(hospital, aRoom); const b = portalOf(hospital, bRoom); const a3 = worldPoint(a.x, a.z, aRoom.floor); const b3 = worldPoint(b.x, b.z, bRoom.floor);
      const points = [a3.clone().setY(a3.y + .08), b3.clone().setY(b3.y + .08)]; const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: from.startsWith('lift') || to.startsWith('lift') ? 0x97aab6 : 0xa9beb1, dashSize: .4, gapSize: .22, transparent: true, opacity: .6 })); line.computeLineDistances(); edgeGroup.add(line);
      if (aRoom.floor === bRoom.floor) { const dx = b3.x - a3.x; const dz = b3.z - a3.z; const length = Math.hypot(dx, dz); const walkway = new THREE.Mesh(new THREE.BoxGeometry(length, .03, 1.2), new THREE.MeshStandardMaterial({ color: 0xe7eee5, roughness: .86 })); walkway.position.set((a3.x + b3.x) / 2, a3.y + .035, (a3.z + b3.z) / 2); walkway.rotation.y = -Math.atan2(dz, dx); edgeGroup.add(walkway); }
    }

    const actor = new THREE.Group(); scene.add(actor); actorRef.current = actor; legRefs.current = [];
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.62, 24), new THREE.MeshBasicMaterial({ color: 0x24453f, transparent: true, opacity: .2 })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .05; actor.add(shadow);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.34, .76, 5, 9), new THREE.MeshStandardMaterial({ color: 0x2c73a5, roughness: .68 })); torso.position.y = 1.12; torso.castShadow = true; actor.add(torso);
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(.5, .55, .22), new THREE.MeshStandardMaterial({ color: 0xe7a34b, roughness: .8 })); backpack.position.set(0, 1.2, .32); backpack.castShadow = true; actor.add(backpack);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.25, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf0bd92, roughness: .8 })); head.position.y = 1.82; head.castShadow = true; actor.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.255, 16, 8, 0, Math.PI * 2, 0, Math.PI * .55), new THREE.MeshStandardMaterial({ color: 0x3c302c })); hair.position.y = 1.87; actor.add(hair);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.105, .48, 4, 7), new THREE.MeshStandardMaterial({ color: 0x2c73a5 })); arm.position.set(side * .42, 1.2, 0); arm.rotation.z = side * -.12; arm.castShadow = true; actor.add(arm);
      const legGroup = new THREE.Group(); legGroup.position.set(side * .16, .63, 0); const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.13, .55, 4, 7), new THREE.MeshStandardMaterial({ color: 0x263b43 })); leg.position.y = -.28; leg.castShadow = true; legGroup.add(leg); actor.add(legGroup); legRefs.current.push(legGroup);
    }
    const routeGroup = new THREE.Group(); scene.add(routeGroup); routeGroupRef.current = routeGroup;

    const resize = () => { if (!mount || !rendererRef.current || !cameraRef.current) return; const width = Math.max(mount.clientWidth, 1); const height = Math.max(mount.clientHeight, 1); rendererRef.current.setSize(width, height); cameraRef.current.aspect = width / height; cameraRef.current.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(mount);
    let frame = 0; let previous = performance.now(); let gaitTime = 0; let lastProgressUpdate = 0;
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate); const dt = Math.min(.05, (now - previous) / 1000); previous = now;
      const currentActor = actorRef.current; const currentCamera = cameraRef.current; const currentRenderer = rendererRef.current;
      if (!currentActor || !currentCamera || !currentRenderer) return;
      const keys = keysRef.current; const keyboardX = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0); const keyboardY = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      let raw = Math.hypot(inputRef.current.x, inputRef.current.y) > .08 ? inputRef.current : { x: keyboardX, y: keyboardY };
      if (guideActiveRef.current) {
        const activeRoute = routeRef.current; const routeIndex = activeRoute.indexOf(currentNodeRef.current); const nextRoom = routeIndex >= 0 ? roomByNode(hospital, activeRoute[routeIndex + 1] ?? '') : undefined; const currentRoom = roomByNode(hospital, currentNodeRef.current);
        if (!nextRoom || !currentRoom) {
          if (currentNodeRef.current === destinationRef.current) { guideActiveRef.current = false; playingRef.current = false; setPlaying(false); progressChangeRef.current(1); guidedCompleteRef.current?.(); }
          raw = { x: 0, y: 0 };
        } else if (nextRoom.floor !== currentRoom.floor) {
          raw = { x: 0, y: Math.sign(nextRoom.floor - currentRoom.floor) };
        } else {
          const from = worldPoint(portalOf(hospital, currentRoom).x, portalOf(hospital, currentRoom).z, currentRoom.floor); const to = worldPoint(portalOf(hospital, nextRoom).x, portalOf(hospital, nextRoom).z, nextRoom.floor); const dx = to.x - from.x; const dz = to.z - from.z; const c = Math.cos(yawRef.current); const s = Math.sin(yawRef.current); raw = { x: c * dx + s * dz, y: s * dx - c * dz };
        }
      }
      const magnitude = Math.min(1, Math.hypot(raw.x, raw.y));
      const liftTravel = liftTravelRef.current;
      if (liftTravel) {
        liftTravel.elapsed += dt;
        const t = Math.min(1, liftTravel.elapsed / .95); const eased = t * t * (3 - 2 * t);
        currentActor.position.lerpVectors(liftTravel.from, liftTravel.to, eased);
        if (t >= 1) { const target = liftTravel.targetNode; currentNodeRef.current = target; setNearNode(target); nodeChangeRef.current(target); floorChangeRef.current(liftTravel.targetFloor); progressChangeRef.current(0); activeEdgeRef.current = null; liftTravelRef.current = null; setLiftMoving(false); inputRef.current = { x: 0, y: 0 }; setPlaying(false); playingRef.current = false; }
      } else if (playingRef.current && magnitude > .08) {
        let direction = new THREE.Vector3(Math.cos(yawRef.current) * raw.x + Math.sin(yawRef.current) * raw.y, 0, Math.sin(yawRef.current) * raw.x - Math.cos(yawRef.current) * raw.y).normalize();
        const node = currentNodeRef.current; const room = roomByNode(hospital, node);
        const neighbors = hospital.edges.flatMap(([a, b, , kind]) => accessibleRef.current && kind === 'stairs' ? [] : a === node ? [b] : b === node ? [a] : []);
        if (!activeEdgeRef.current) {
          const guidedRoute = routeRef.current[0] === node ? routeRef.current : guideActiveRef.current ? findRoute(hospital, node, destinationRef.current, accessibleRef.current) : routeRef.current;
          const guidedNext = guideActiveRef.current ? guidedRoute[1] : undefined;
          if (guidedNext && neighbors.includes(guidedNext)) activeEdgeRef.current = guidedNext;
          else {
            const candidate = neighbors.map((next) => { const nextRoom = roomByNode(hospital, next); if (!room || !nextRoom) return { next, score: -1 }; const here = portalOf(hospital, room); const there = portalOf(hospital, nextRoom); const from = worldPoint(here.x, here.z, room.floor); const to = worldPoint(there.x, there.z, nextRoom.floor); const v = new THREE.Vector3(to.x - from.x, 0, to.z - from.z); if (v.lengthSq() < .01 && room.floor !== nextRoom.floor) return { next, score: Math.sign(nextRoom.floor - room.floor) * raw.y }; return { next, score: v.normalize().dot(direction) }; }).sort((a, b) => b.score - a.score)[0];
            if (candidate && candidate.score > .22) activeEdgeRef.current = candidate.next;
          }
        }
        const nextNode = activeEdgeRef.current; const nextRoom = nextNode ? roomByNode(hospital, nextNode) : undefined; const currentRoom = roomByNode(hospital, node);
        if (nextRoom && currentRoom) {
          const p = portalOf(hospital, currentRoom); const q = portalOf(hospital, nextRoom); const from = worldPoint(p.x, p.z, currentRoom.floor); const to = worldPoint(q.x, q.z, nextRoom.floor);
          const diff = to.clone().sub(from); const lengthSq = Math.max(.01, diff.lengthSq());
          const isVertical = Math.abs(diff.y) > Math.abs(diff.x) + Math.abs(diff.z); const movementSpeed = guideActiveRef.current ? 1.05 : sprintRef.current || keys.has('shift') ? 5.2 : 3.2;
          const adjustedMovement = isVertical ? new THREE.Vector3(0, Math.sign(diff.y) * raw.y * magnitude * movementSpeed * dt, 0) : direction.clone().multiplyScalar(movementSpeed * magnitude * dt);
          const candidatePos = currentActor.position.clone().add(adjustedMovement); const rawProgress = candidatePos.clone().sub(from).dot(diff) / lengthSq; const nextProgress = Math.max(0, Math.min(1, rawProgress));
          if (rawProgress >= 0 && rawProgress <= 1) currentActor.position.copy(from.clone().add(diff.clone().multiplyScalar(nextProgress)));
          else if (rawProgress > 1) currentActor.position.copy(to);
          else { currentActor.position.copy(from); activeEdgeRef.current = null; }
          const activeRoute = routeRef.current; const isOnSuggestedRoute = activeRoute[0] === node && activeRoute[1] === nextNode;
          if (isOnSuggestedRoute && now - lastProgressUpdate > 100) { const routeLength = routeDistance(hospital, activeRoute); const edgeLength = hospital.edges.find(([a, b]) => (a === node && b === nextNode) || (a === nextNode && b === node))?.[2] ?? 0; progressChangeRef.current(routeLength > 0 ? Math.max(0, Math.min(.99, nextProgress * edgeLength / routeLength)) : 0); lastProgressUpdate = now; }
          currentActor.rotation.y = Math.atan2(-direction.x, -direction.z); gaitTime += dt * (4 + magnitude * 9) * (sprintRef.current || keys.has('shift') ? 1.25 : 1); legRefs.current.forEach((leg, index) => { leg.rotation.x = Math.sin(gaitTime + index * Math.PI) * .55 * magnitude; }); setPlaying(true);
          if (nextProgress >= 1) { currentNodeRef.current = nextNode!; setNearNode(nextNode!); activeEdgeRef.current = null; progressChangeRef.current(0); nodeChangeRef.current(nextNode!); if (nextRoom.floor !== currentRoom.floor) floorChangeRef.current(nextRoom.floor); if (guideActiveRef.current && nextNode === destinationRef.current) { guideActiveRef.current = false; playingRef.current = false; setPlaying(false); progressChangeRef.current(1); guidedCompleteRef.current?.(); } }
        }
      } else {
        legRefs.current.forEach((leg) => { leg.rotation.x *= .72; });
      }
      const targetDoor = destinationDoors.current.get(destinationRef.current); if (targetDoor) targetDoor.rotation.y = THREE.MathUtils.damp(targetDoor.rotation.y, currentNodeRef.current === destinationRef.current ? -Math.PI * .48 : 0, 3.4, dt);
      const yaw = yawRef.current; const follow = currentActor.position;
      const topMode = cameraModeRef.current === 'top'; const selectedFloorY = floorRef.current * FLOOR_HEIGHT; const actorFloor = roomByNode(hospital, currentNodeRef.current)?.floor ?? 0; const visibleFloor = topMode ? floorRef.current : actorFloor;
      const travellingFloor = liftTravelRef.current?.targetFloor; floorGroups.forEach((group, level) => { group.visible = level === visibleFloor || level === travellingFloor; }); currentActor.visible = !topMode || actorFloor === floorRef.current || travellingFloor === floorRef.current;
      const horizontalDistance = distanceRef.current * Math.cos(pitchRef.current); const desired = topMode ? new THREE.Vector3(follow.x, selectedFloorY + 24, follow.z + .1) : new THREE.Vector3(follow.x + Math.sin(yaw) * horizontalDistance, follow.y + 3 + Math.sin(pitchRef.current) * distanceRef.current, follow.z + Math.cos(yaw) * horizontalDistance);
      currentCamera.position.lerp(desired, 1 - Math.exp(-dt * 7)); currentCamera.lookAt(follow.x, topMode ? selectedFloorY : follow.y + 1.05, follow.z);
      currentRenderer.render(scene, currentCamera);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); scene.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => { if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); }); } }); mount.removeChild(renderer.domElement); rendererRef.current = null; sceneRef.current = null; cameraRef.current = null; actorRef.current = null; routeGroupRef.current = null; };
  // Static architecture is rebuilt only when a different JSON map is loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospital]);

  useEffect(() => { currentNodeRef.current = start; setNearNode(start); activeEdgeRef.current = null; const room = roomByNode(hospital, start); if (room && actorRef.current) { const p = portalOf(hospital, room); actorRef.current.position.copy(worldPoint(p.x, p.z, room.floor)); } }, [start, hospital]);
  useEffect(() => { if (actorRef.current) actorRef.current.rotation.y = yawRef.current; }, [start]);
  useEffect(() => {
    const group = routeGroupRef.current; if (!group) return; group.clear();
    for (let i = 0; i < route.length - 1; i++) {
      const aRoom = roomByNode(hospital, route[i]); const bRoom = roomByNode(hospital, route[i + 1]); if (!aRoom || !bRoom) continue;
      const a = portalOf(hospital, aRoom); const b = portalOf(hospital, bRoom); const from = worldPoint(a.x, a.z, aRoom.floor); const to = worldPoint(b.x, b.z, bRoom.floor); from.y += .18; to.y += .18;
      const delta = to.clone().sub(from); const geometry = new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 20, .14, 7, false); const routeLine = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x2389ee, emissive: 0x123f78, emissiveIntensity: .35, roughness: .4 })); group.add(routeLine);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(.26, .58, 6), new THREE.MeshStandardMaterial({ color: 0xffb442, emissive: 0x6a3d08, emissiveIntensity: .22 })); arrow.position.copy(from).add(delta.multiplyScalar(.68)); arrow.position.y += .18; arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()); group.add(arrow);
    }
    const targetRoom = roomByNode(hospital, destination); if (targetRoom) { const p = portalOf(hospital, targetRoom); const pin = new THREE.Group(); const point = worldPoint(p.x, p.z, targetRoom.floor); pin.position.set(point.x, point.y + 2.4, point.z); const marker = new THREE.Mesh(new THREE.SphereGeometry(.32, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe25951, emissive: 0x5b1e19, emissiveIntensity: .25 })); const stem = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.5, 8), new THREE.MeshStandardMaterial({ color: 0xe25951 })); stem.position.y = -.7; pin.add(marker, stem); group.add(pin); }
  }, [hospital, route.join('|'), destination]);

  useEffect(() => { const onDown = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return; const key = event.key.toLowerCase(); if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(key)) { event.preventDefault(); keysRef.current.add(key); if (key !== 'shift') { onMovementStart(); playingRef.current = true; setPlaying(true); } } }; const onUp = (event: KeyboardEvent) => { keysRef.current.delete(event.key.toLowerCase()); }; window.addEventListener('keydown', onDown); window.addEventListener('keyup', onUp); return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); }; }, [onMovementStart]);

  const lookDown = (event: React.PointerEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest('.h3d-hud,.h3d-joystick,.h3d-floor-menu')) return; event.currentTarget.setPointerCapture(event.pointerId); touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (touchPoints.current.size === 1) lookPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; else if (touchPoints.current.size === 2) { const points = [...touchPoints.current.values()]; lastPinch.current = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); lookPointer.current = null; } };
  const lookMove = (event: React.PointerEvent<HTMLDivElement>) => { if (!touchPoints.current.has(event.pointerId)) return; touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (touchPoints.current.size >= 2) { const points = [...touchPoints.current.values()]; const gap = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); if (lastPinch.current) distanceRef.current = THREE.MathUtils.clamp(distanceRef.current + (lastPinch.current - gap) * .035, 6, 28); lastPinch.current = gap; setZoom(distanceRef.current); } else if (lookPointer.current?.id === event.pointerId) { const dx = event.clientX - lookPointer.current.x; const dy = event.clientY - lookPointer.current.y; yawRef.current -= dx * .006; pitchRef.current = THREE.MathUtils.clamp(pitchRef.current - dy * .004, -.12, 1.05); setHeading(Math.round(THREE.MathUtils.euclideanModulo(yawRef.current, Math.PI * 2) * 180 / Math.PI)); lookPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; } };
  const lookUp = (event: React.PointerEvent<HTMLDivElement>) => { touchPoints.current.delete(event.pointerId); if (lookPointer.current?.id === event.pointerId) lookPointer.current = null; if (touchPoints.current.size < 2) lastPinch.current = 0; };
  const joystickDown = (event: React.PointerEvent<HTMLDivElement>) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onMovementStart(); playingRef.current = true; setPlaying(true); joystickMove(event); };
  const joystickMove = (event: React.PointerEvent<HTMLDivElement>) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); const radius = Math.min(rect.width, rect.height) * .36; const dx = event.clientX - (rect.left + rect.width / 2); const dy = event.clientY - (rect.top + rect.height / 2); const length = Math.hypot(dx, dy); const factor = length > radius ? radius / length : 1; const x = dx * factor / radius; const y = -dy * factor / radius; inputRef.current = { x, y }; setJoystick({ x, y }); };
  const joystickUp = (event: React.PointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); inputRef.current = { x: 0, y: 0 }; setJoystick({ x: 0, y: 0 }); };
  const sprintDown = (event: React.PointerEvent<HTMLButtonElement>) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); sprintRef.current = true; onMovementStart(); playingRef.current = true; setPlaying(true); };
  const sprintUp = (event: React.PointerEvent<HTMLButtonElement>) => { sprintRef.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const toggleGame = () => { const next = !playingRef.current; playingRef.current = next; setPlaying(next); onMovementStart(); if (!next) { inputRef.current = { x: 0, y: 0 }; keysRef.current.clear(); setJoystick({ x: 0, y: 0 }); } };
  const rideLift = (direction: -1 | 1) => {
    if (liftTravelRef.current) return;
    const current = roomByNode(hospital, currentNodeRef.current); if (!current?.node.startsWith('lift')) return;
    const targetNode = hospital.edges.flatMap(([a, b, , kind]) => kind === 'lift' ? (a === current.node ? [b] : b === current.node ? [a] : []) : []).find((id) => { const room = roomByNode(hospital, id); return room && Math.sign(room.floor - current.floor) === direction; });
    const target = targetNode ? roomByNode(hospital, targetNode) : undefined; const actor = actorRef.current; if (!target || !actor) return;
    const portal = portalOf(hospital, target); liftTravelRef.current = { from: actor.position.clone(), to: worldPoint(portal.x, portal.z, target.floor), elapsed: 0, targetNode: target.node, targetFloor: target.floor };
    activeEdgeRef.current = target.node; inputRef.current = { x: 0, y: 0 }; playingRef.current = true; setPlaying(true); setLiftMoving(true); onMovementStart();
  };
  const liftNeighbors = hospital.edges.flatMap(([a, b, , kind]) => kind === 'lift' ? (a === nearNode ? [b] : b === nearNode ? [a] : []) : []).map((id) => roomByNode(hospital, id)).filter((room): room is HospitalRoom => Boolean(room));

  return <section className="hospital-3d-game" aria-label={hindi ? 'खेल शैली 3D अस्पताल नक्शा' : 'Playable 3D hospital map'}>
    <div className="h3d-viewport" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} onWheel={(event) => { distanceRef.current = THREE.MathUtils.clamp(distanceRef.current + event.deltaY * .012, 6, 28); setZoom(distanceRef.current); }}>
      <div className="h3d-canvas" ref={mountRef}/>
      <div className="h3d-hud h3d-hud-top"><div className="h3d-game-tag"><span className="h3d-live-dot"/>{hindi ? 'अस्पताल मिशन' : 'HOSPITAL MISSION'}<small>{hindi ? 'सिम्युलेटेड गेम' : 'SIMULATED GAME'}</small></div><div className="h3d-compass"><Compass size={17}/><span>N</span><i>·</i><span>{heading}°</span></div><div className="h3d-floor-menu">{hospital.floors.map((item) => <button key={item.level} className={floor === item.level ? 'active' : ''} onClick={() => { onFloorChange(item.level); setCameraMode('top'); }}>{item.label.replace(' floor', '').replace('Ground', 'G').replace('First', '1').replace('Second', '2')}</button>)}</div></div>
      <div className="h3d-destination"><span>{hindi ? 'मिशन गंतव्य' : 'MISSION DESTINATION'}</span><b>{roomByNode(hospital, destination)?.name}</b><small>{routeDistance(hospital, route)} m · {accessible ? (hindi ? 'सुलभ रास्ता' : 'Accessible path') : (hindi ? 'सबसे छोटा रास्ता' : 'Shortest path')}</small></div>
      <div className="h3d-hud h3d-hud-bottom"><div className="h3d-joystick" onPointerDown={joystickDown} onPointerMove={joystickMove} onPointerUp={joystickUp} onPointerCancel={joystickUp} aria-label={hindi ? 'चलने के लिए जॉयस्टिक खींचें' : 'Drag joystick to move'}><span className="h3d-stick" style={{ transform: `translate(${joystick.x * 25}px, ${-joystick.y * 25}px)` }}/><ArrowUp className="joy-up" size={15}/><ArrowDown className="joy-down" size={15}/><ArrowLeft className="joy-left" size={15}/><ArrowRight className="joy-right" size={15}/></div><button className="h3d-run-button" onPointerDown={sprintDown} onPointerUp={sprintUp} onPointerCancel={sprintUp} onLostPointerCapture={() => { sprintRef.current = false; }}>RUN</button><div className="h3d-player-card"><span className="h3d-player-dot"/><div><b>{roomByNode(hospital, nearNode)?.name ?? roomByNode(hospital, start)?.name}</b><small>{hindi ? 'आपका खिलाड़ी' : 'YOUR PLAYER'} · {Math.round(zoom)}m camera</small></div></div><div className="h3d-view-tools"><button onClick={() => setCameraMode((mode) => mode === 'third' ? 'top' : 'third')} aria-label={cameraMode === 'third' ? 'Top-down view' : 'Third-person view'}><Camera size={18}/><span>{cameraMode === 'third' ? '3rd person' : 'Top view'}</span></button><button onClick={() => { distanceRef.current = 12; yawRef.current = 0; setZoom(12); }} aria-label="Reset camera"><Maximize2 size={18}/></button></div></div>
      {liftNeighbors.length > 0 && <div className="h3d-lift-controls" aria-label={hindi ? 'लिफ्ट नियंत्रण' : 'Lift controls'}>{[-1, 1].map((direction) => { const currentFloor = roomByNode(hospital, nearNode)?.floor ?? 0; const available = liftNeighbors.some((room) => Math.sign(room.floor - currentFloor) === direction); return available ? <button key={direction} disabled={liftMoving} onClick={() => rideLift(direction as -1 | 1)}><span>{direction > 0 ? '↑' : '↓'}</span>{liftMoving ? (hindi ? 'लिफ्ट चल रही है' : 'Moving…') : direction > 0 ? (hindi ? 'ऊपर जाएँ' : 'Ride up') : (hindi ? 'नीचे जाएँ' : 'Ride down')}</button> : null; })}</div>}
      <div className="h3d-hint">{hindi ? 'एक उंगली से कैमरा घुमाएँ · दो से ज़ूम करें · जॉयस्टिक से चलें' : 'Drag to orbit · pinch or scroll to zoom · joystick or WASD to walk'}</div>
    </div>
    <div className="h3d-game-bar"><div className="h3d-progress"><i style={{ width: `${Math.max(5, (route.indexOf(nearNode) / Math.max(1, route.length - 1)) * 100)}%` }}/></div><button className="h3d-game-button primary" onClick={toggleGame}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? 'Pause game' : 'Start game'}</button><button className="h3d-game-button" onClick={() => { inputRef.current = { x: 0, y: 0 }; keysRef.current.clear(); currentNodeRef.current = start; activeEdgeRef.current = null; const room = roomByNode(hospital, start); if (room && actorRef.current) { const p = portalOf(hospital, room); actorRef.current.position.copy(worldPoint(p.x, p.z, room.floor)); } setNearNode(start); onNodeChange(start); onFloorChange(roomByNode(hospital, start)?.floor ?? 0); }}><RotateCcw size={17}/> Replay</button><span className="h3d-route-state"><Gamepad2 size={17}/>{roomByNode(hospital, nearNode)?.name ?? 'At start'}</span></div>
  </section>;
}
