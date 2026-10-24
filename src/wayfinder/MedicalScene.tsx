import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';

type SceneKind = 'home' | 'register' | 'slip' | 'queue' | 'find' | 'emergency' | 'settings' | 'staff';
const palette: Record<SceneKind, { accent: string; pale: string; title: [string, string, string]; note: [string, string, string] }> = {
  home: { accent: '#477fe0', pale: '#e9f1ff', title: ['Care, made easier', 'देखभाल, अब आसान', 'எளிய மருத்துவ சேவை'], note: ['A welcoming hospital, one step at a time', 'आपकी अस्पताल यात्रा, हर कदम पर', 'உங்கள் மருத்துவமனைப் பயணம், ஒவ்வொரு படியிலும்'] },
  register: { accent: '#45a886', pale: '#e7f6ef', title: ['A friendly start', 'आसान शुरुआत', 'எளிய தொடக்கம்'], note: ['A patient and care team, ready to help', 'मरीज और देखभाल टीम आपकी सहायता के लिए', 'நோயாளியும் மருத்துவக் குழுவும் உதவத் தயார்'] },
  slip: { accent: '#6082d8', pale: '#edf0ff', title: ['Your visit, organized', 'आपकी विज़िट व्यवस्थित', 'உங்கள் வருகை ஒழுங்காக'], note: ['Your token and visit details, together', 'टोकन और विज़िट की जानकारी एक जगह', 'டோக்கனும் வருகை விவரங்களும் ஒரே இடத்தில்'] },
  queue: { accent: '#31a68b', pale: '#e7f7f1', title: ['The next step is clear', 'अगला कदम साफ़', 'அடுத்த படி தெளிவாக'], note: ['Your place in line, kept up to date', 'कतार में आपकी जगह की ताज़ा जानकारी', 'வரிசையில் உங்கள் இடம் புதுப்பிக்கப்படும்'] },
  find: { accent: '#3b82e4', pale: '#e8f2ff', title: ['Find your way', 'रास्ता खोजें', 'வழியைக் கண்டறியுங்கள்'], note: ['Explore floors, rooms, and accessible routes', 'मंजिलें, कमरे और सुलभ रास्ते देखें', 'தளங்கள், அறைகள், எளிய வழிகளைப் பாருங்கள்'] },
  emergency: { accent: '#df6865', pale: '#fff0ed', title: ['Help is close by', 'सहायता पास है', 'உதவி அருகில் உள்ளது'], note: ['Emergency staff and ambulance contacts', 'आपातकालीन स्टाफ और एम्बुलेंस संपर्क', 'அவசர மருத்துவக் குழு மற்றும் ஆம்புலன்ஸ்'] },
  settings: { accent: '#9076d1', pale: '#f0ebfc', title: ['Comfort that fits you', 'आपके लिए सुविधाजनक', 'உங்களுக்கு ஏற்ற வசதி'], note: ['Make the experience easier to use', 'ऐप को अपनी सुविधा के अनुसार बदलें', 'உங்கள் வசதிக்கேற்ப அமைக்கலாம்'] },
  staff: { accent: '#418e9b', pale: '#e5f3f5', title: ['Care team at a glance', 'देखभाल टीम एक नज़र में', 'மருத்துவக் குழு ஒரே பார்வையில்'], note: ['People and services working together', 'लोग और सेवाएँ साथ मिलकर', 'மருத்துவக் குழுவும் சேவைகளும் இணைந்து'] },
};

function material(color: string, roughness = .52) { return new THREE.MeshStandardMaterial({ color, roughness, metalness: .03 }); }
function addMesh(group: THREE.Group, geometry: THREE.BufferGeometry, color: string, position: [number, number, number], scale?: [number, number, number], rotation?: [number, number, number]) {
  const mesh = new THREE.Mesh(geometry, material(color)); mesh.position.set(...position); if (scale) mesh.scale.set(...scale); if (rotation) mesh.rotation.set(...rotation); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function bone(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, color: string) {
  const direction = new THREE.Vector3().subVectors(b, a); const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * .8, radius, direction.length(), 12), material(color)); mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); mesh.castShadow = true; group.add(mesh); return mesh;
}
function person(group: THREE.Group, x: number, base: number, clothes: string, coat?: string) {
  const human = new THREE.Group(); human.position.set(x, base, 0); group.add(human);
  addMesh(human, new THREE.CapsuleGeometry(.15, .45, 4, 10), clothes, [0, .55, 0]);
  if (coat) addMesh(human, new THREE.CapsuleGeometry(.17, .46, 4, 10), coat, [0, .57, -.015]);
  addMesh(human, new THREE.SphereGeometry(.15, 18, 14), '#f0bf9b', [0, 1.02, 0]);
  addMesh(human, new THREE.SphereGeometry(.153, 16, 9, 0, Math.PI * 2, 0, Math.PI * .62), '#463b38', [0, 1.08, 0]);
  bone(human, new THREE.Vector3(-.09, .38, 0), new THREE.Vector3(-.11, .05, .01), .055, '#324564');
  bone(human, new THREE.Vector3(.09, .38, 0), new THREE.Vector3(.12, .05, .01), .055, '#324564');
  return human;
}
function createModel(kind: SceneKind) {
  const root = new THREE.Group(); const floating: THREE.Object3D[] = [];
  const floor = addMesh(root, new THREE.CylinderGeometry(1.6, 1.78, .15, 64), '#ffffff', [0, -.2, 0]); floor.material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .55, metalness: .04 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, .018, 8, 72), material(palette[kind].accent)); ring.rotation.x = Math.PI / 2; ring.position.y = -.1; root.add(ring);
  if (kind === 'home') {
    addMesh(root, new THREE.BoxGeometry(1.7, 1.1, .8), '#f4f7fc', [0, .48, 0]);
    addMesh(root, new THREE.BoxGeometry(1.86, .16, .9), '#82a9ed', [0, 1.11, 0]);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) addMesh(root, new THREE.BoxGeometry(.2, .19, .025), '#83b8ee', [-.59 + col * .39, .71 - row * .36, .416]);
    addMesh(root, new THREE.BoxGeometry(.16, .58, .035), '#e6676c', [0, .76, .44]); addMesh(root, new THREE.BoxGeometry(.48, .13, .035), '#e6676c', [0, .76, .44]);
    const tree = new THREE.Group(); tree.position.set(-1.05, 0, .18); root.add(tree); addMesh(tree, new THREE.CylinderGeometry(.06, .09, .46, 8), '#987855', [0, .12, 0]); addMesh(tree, new THREE.IcosahedronGeometry(.3, 1), '#83c5a6', [0, .55, 0]); floating.push(tree);
  } else if (kind === 'register' || kind === 'staff') {
    const patient = person(root, -.42, -.11, '#3977c6'); patient.rotation.y = -.18; floating.push(patient);
    const clinician = person(root, .48, -.11, '#fffdf6', kind === 'staff' ? '#4e83da' : '#74bca4'); clinician.rotation.y = .2;
    addMesh(clinician, new THREE.TorusGeometry(.12, .018, 8, 24, Math.PI), '#428f8b', [0, .49, .12], undefined, [0, 0, Math.PI]);
    const clipboard = new THREE.Group(); clipboard.position.set(.84, .24, .25); clipboard.rotation.set(.08, -.25, -.18); root.add(clipboard); addMesh(clipboard, new THREE.BoxGeometry(.39, .52, .05), '#cda66e', [0, 0, 0]); addMesh(clipboard, new THREE.BoxGeometry(.3, .42, .02), '#fffdf6', [0, -.015, .04]); addMesh(clipboard, new THREE.BoxGeometry(.12, .035, .025), '#7ea2dc', [0, .12, .06]); floating.push(clipboard);
  } else if (kind === 'slip' || kind === 'queue') {
    const file = new THREE.Group(); file.position.set(-.28, .18, .06); file.rotation.set(-.08, .16, -.11); root.add(file);
    addMesh(file, new THREE.BoxGeometry(.86, 1.05, .08), kind === 'queue' ? '#74c6a7' : '#7396e3', [0, 0, 0]); addMesh(file, new THREE.BoxGeometry(.37, .1, .11), kind === 'queue' ? '#74c6a7' : '#7396e3', [-.2, .57, 0]); addMesh(file, new THREE.BoxGeometry(.67, .78, .025), '#fff', [0, -.08, .057]); addMesh(file, new THREE.BoxGeometry(.42, .045, .018), '#7794bf', [0, .16, .076]);
    for (let i = 0; i < 3; i++) addMesh(file, new THREE.BoxGeometry(.5 - i * .04, .018, .018), '#c8d3e6', [0, .02 - i * .11, .077]);
    const token = new THREE.Mesh(new THREE.CylinderGeometry(.43, .43, .055, 48), material('#fff')); token.position.set(.66, .28, .35); token.castShadow = true; root.add(token); addMesh(root, new THREE.TorusGeometry(.43, .025, 9, 48), palette[kind].accent, [.66, .28, .35], undefined, [Math.PI / 2, 0, 0]); addMesh(root, new THREE.BoxGeometry(.34, .055, .04), palette[kind].accent, [.66, .28, .39]); floating.push(token);
  } else if (kind === 'emergency') {
    const kit = new THREE.Group(); kit.position.set(-.25, .2, 0); kit.rotation.y = -.28; root.add(kit); addMesh(kit, new THREE.BoxGeometry(1.05, .7, .58), '#f27874', [0, 0, 0]); addMesh(kit, new THREE.BoxGeometry(.4, .14, .12), '#a9444c', [0, .43, 0]); addMesh(kit, new THREE.BoxGeometry(.16, .49, .045), '#fff', [0, .02, .31]); addMesh(kit, new THREE.BoxGeometry(.48, .15, .045), '#fff', [0, .02, .31]); floating.push(kit);
    const syringe = new THREE.Group(); syringe.position.set(.8, .18, .22); syringe.rotation.z = -.54; root.add(syringe); addMesh(syringe, new THREE.CylinderGeometry(.13, .13, .64, 24), '#e7f4f2', [0, 0, 0], undefined, [0, 0, Math.PI / 2]); addMesh(syringe, new THREE.CylinderGeometry(.18, .18, .08, 24), '#58a89c', [-.3, 0, 0], undefined, [0, 0, Math.PI / 2]); addMesh(syringe, new THREE.CylinderGeometry(.03, .012, .44, 12), '#98aab8', [.5, 0, 0], undefined, [0, 0, Math.PI / 2]); addMesh(syringe, new THREE.BoxGeometry(.1, .3, .06), '#519e95', [-.48, 0, 0]); floating.push(syringe);
  } else if (kind === 'settings') {
    const tubePoints = [new THREE.Vector3(-.65, .55, .12), new THREE.Vector3(-.69, -.22, .12), new THREE.Vector3(-.43, -.58, .12), new THREE.Vector3(0, -.43, .12), new THREE.Vector3(.3, -.02, .12), new THREE.Vector3(.42, .28, .12)];
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tubePoints), 50, .04, 10, false), material('#318c91')); tube.castShadow = true; root.add(tube);
    for (const x of [-.69, -.46]) addMesh(root, new THREE.TorusGeometry(.11, .025, 10, 28), '#4589ac', [x, .69, .12]);
    addMesh(root, new THREE.CylinderGeometry(.08, .08, .09, 24), '#d5a56b', [.42, -.17, .12]); addMesh(root, new THREE.TorusGeometry(.13, .035, 9, 32), '#d5a56b', [.42, -.17, .12], undefined, [Math.PI / 2, 0, 0]);
    const gear = new THREE.Group(); gear.position.set(.68, .55, 0); root.add(gear); addMesh(gear, new THREE.CylinderGeometry(.39, .39, .14, 12), '#9076d1', [0, 0, 0]); addMesh(gear, new THREE.TorusGeometry(.21, .055, 12, 32), '#f7f4ff', [0, 0, .09]); addMesh(gear, new THREE.CylinderGeometry(.08, .08, .17, 24), '#f7f4ff', [0, 0, .09]); for (let i = 0; i < 8; i++) addMesh(gear, new THREE.BoxGeometry(.13, .16, .13), '#9076d1', [Math.cos(i * Math.PI / 4) * .38, Math.sin(i * Math.PI / 4) * .38, 0]); floating.push(gear);
  } else {
    const hospital = new THREE.Group(); hospital.position.y = .15; root.add(hospital); addMesh(hospital, new THREE.BoxGeometry(1.35, .9, .82), '#f8fbff', [0, .38, 0]); addMesh(hospital, new THREE.BoxGeometry(1.48, .12, .9), '#83a8e6', [0, .86, 0]);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) addMesh(hospital, new THREE.BoxGeometry(.18, .17, .025), '#6cb4d7', [-.42 + col * .42, .52 - row * .33, .416]);
    addMesh(hospital, new THREE.BoxGeometry(.13, .43, .04), '#e36e72', [0, .58, .44]); addMesh(hospital, new THREE.BoxGeometry(.36, .12, .04), '#e36e72', [0, .58, .44]); floating.push(hospital);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.12, .34, 16), material('#3b82e4')); arrow.position.set(.98, .38, .3); arrow.rotation.z = -Math.PI / 2; root.add(arrow); floating.push(arrow);
  }
  return { root, floating };
}

export default function MedicalScene({ kind, language = 'en' }: { kind: SceneKind; language?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const accent = palette[kind].accent;
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const scene = new THREE.Scene(); scene.background = null;
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 30); camera.position.set(3.15, 2.2, 5.4); camera.lookAt(0, .42, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08; renderer.setClearColor(0x000000, 0); mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xf7fbff, 0x8ba0b8, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.1); key.position.set(-3, 5, 4); key.castShadow = true; scene.add(key);
    const fill = new THREE.PointLight(accent, 38, 10); fill.position.set(2.4, 2.2, 1.8); scene.add(fill);
    const model = createModel(kind); scene.add(model.root); const floatBaseY = model.floating.map((object) => object.position.y);
    const floaters: THREE.Mesh[] = [];
    for (let i = 0; i < 9; i++) { const dot = new THREE.Mesh(new THREE.IcosahedronGeometry(.035 + (i % 3) * .012, 1), material(i % 2 ? '#ffffff' : accent)); const angle = i * Math.PI * 2 / 9; dot.position.set(Math.cos(angle) * (1.4 + (i % 2) * .16), .4 + Math.sin(i * 1.8) * .78, Math.sin(angle) * .55); scene.add(dot); floaters.push(dot); }
    const resize = () => { const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    const clock = new THREE.Clock(); let frame = 0;
    const animate = () => { frame = requestAnimationFrame(animate); const time = clock.getElapsedTime(); model.root.position.x = Math.sin(time * .55) * .1; model.root.position.y = Math.sin(time * .8) * .065; model.root.rotation.y = Math.sin(time * .38) * .16; model.floating.forEach((object, index) => { object.position.y = floatBaseY[index] + Math.sin(time * 1.2 + index) * .06; object.rotation.y += .002 * (index % 2 ? 1 : -1); }); floaters.forEach((dot, index) => { dot.position.y = .4 + Math.sin(index * 1.8) * .78 + Math.sin(time * .9 + index) * .06; dot.rotation.x += .003; }); renderer.render(scene, camera); };
    animate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((entry) => entry.dispose()); } }); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, [kind, accent]);
  const copy = palette[kind]; const localeIndex = language === 'hi' ? 1 : language === 'ta' ? 2 : 0;
  return <aside className="medical-scene" data-scene={kind} style={{ '--scene-accent': accent, '--scene-pale': copy.pale } as CSSProperties} aria-label={copy.title[localeIndex]}><div className="medical-scene-glow"/><div className="medical-scene-orbit orbit-one"/><div className="medical-scene-orbit orbit-two"/><div className="medical-scene-model" ref={mountRef}/><div className="medical-scene-copy"><span><i/>{language === 'hi' ? 'ओपीडी साथी · आपका साथी' : language === 'ta' ? 'OPD சாத்தி · உங்கள் துணை' : 'OPD SAATHI · YOUR CARE COMPANION'}</span><h2>{copy.title[localeIndex]}</h2><p>{copy.note[localeIndex]}</p></div><div className="medical-scene-caption">{language === 'hi' ? 'अस्पताल की देखभाल, एक जगह' : language === 'ta' ? 'மருத்துவமனை சேவைகள், ஒரே இடத்தில்' : 'Hospital care, all in one place'} <b>✦</b></div></aside>;
}
