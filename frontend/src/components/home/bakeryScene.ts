/**
 * Procedural night-time bakery for the landing page. Real-time WebGL on the visitor's GPU.
 *
 * Scroll story (progress 0 → 1):
 *   a ₹500 QR payment on the counter → the counter → the declared shop → the street → every payer, mapped.
 * Everything is built from primitives and canvas textures so there are no model downloads.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface SceneFacts { local: number; far: number }
export interface BakeryScene {
  setProgress(p: number): void;
  setPointer(x: number, y: number): void;
  resize(): void;
  dispose(): void;
}

const C = {
  crust: 0xff6a2b, butter: 0xf4c95d, cream: 0xf3e6cf, plaster: 0xd9c7a8, wood: 0x6b4325, woodDark: 0x3a2414,
  loaf: 0xc9772f, loafDark: 0x9a5420, choco: 0x4a2a17, pink: 0xf29bb4, mint: 0x4fd1a1, bad: 0xff4d5e,
  asphalt: 0x15120f, curb: 0x2b2520, night: 0x0d0b09,
};

/* ── tiny helpers ───────────────────────────────────────── */
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })();
const smoother = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const band = (p: number, a: number, b: number, f = 0.04) => Math.min(smoother((p - a + f) / f), 1 - smoother((p - b) / f));

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function qrTexture() {
  return canvasTex(256, 360, g => {
    g.fillStyle = '#fbf6ee'; g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#ff6a2b'; g.fillRect(0, 0, 256, 56);
    g.fillStyle = '#140b05'; g.font = '700 26px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillText('SCAN · PAY', 128, 38);
    const n = 25, s = 7.6, ox = 33, oy = 78;
    g.fillStyle = '#140b05';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (rnd() > 0.52) g.fillRect(ox + x * s, oy + y * s, s, s);
    const finder = (fx: number, fy: number) => {
      g.fillStyle = '#140b05'; g.fillRect(ox + fx * s, oy + fy * s, 7 * s, 7 * s);
      g.fillStyle = '#fbf6ee'; g.fillRect(ox + (fx + 1) * s, oy + (fy + 1) * s, 5 * s, 5 * s);
      g.fillStyle = '#140b05'; g.fillRect(ox + (fx + 2) * s, oy + (fy + 2) * s, 3 * s, 3 * s);
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    g.fillStyle = '#140b05'; g.font = '800 30px "Bricolage Grotesque", sans-serif'; g.fillText('₹500', 128, 318);
    g.font = '500 14px "JetBrains Mono", monospace'; g.fillStyle = '#7a6a58'; g.fillText('SWEET CRUMBS · UPI', 128, 342);
  });
}

function signTexture() {
  return canvasTex(1024, 160, g => {
    g.fillStyle = '#1a120c'; g.fillRect(0, 0, 1024, 160);
    g.strokeStyle = '#f4c95d'; g.lineWidth = 4; g.strokeRect(10, 10, 1004, 140);
    g.fillStyle = '#ffe6b8'; g.textAlign = 'center';
    g.font = 'italic 400 92px "Instrument Serif", Georgia, serif'; g.fillText('Sweet Crumbs', 470, 108);
    g.fillStyle = '#ff6a2b'; g.font = '700 26px "JetBrains Mono", monospace'; g.fillText('BAKERY · EST 2019', 850, 96);
  });
}

function tileTexture() {
  const t = canvasTex(256, 256, g => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#e8dcc6' : '#b4583a'; g.fillRect(x * 32, y * 32, 32, 32);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2.5);
  return t;
}

function windowsTexture(cols: number, rows: number) {
  const t = canvasTex(cols * 16, rows * 22, g => {
    g.fillStyle = '#17120e'; g.fillRect(0, 0, cols * 16, rows * 22);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const lit = rnd();
      g.fillStyle = lit > 0.8 ? '#ffc47a' : lit > 0.7 ? '#ff9a52' : '#211a14';
      g.fillRect(x * 16 + 4, y * 22 + 5, 8, 12);
    }
  });
  return t;
}

function glowSprite() {
  return canvasTex(128, 128, g => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  }, false);
}

/* ── scene ──────────────────────────────────────────────── */
export async function createBakeryScene(canvas: HTMLCanvasElement, facts: SceneFacts): Promise<BakeryScene> {
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch { /* fonts optional */ }

  const mobile = window.innerWidth < 768;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.night);
  const fog = new THREE.FogExp2(C.night, 0.03);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 600);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o }));
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(keep(geo), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);

  /* lights */
  scene.add(new THREE.HemisphereLight(0x3a4a6a, 0x1a100a, 0.55));
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.55); moon.position.set(-30, 40, 30); scene.add(moon);
  const warm = (x: number, y: number, z: number, i: number, d = 9) => { const l = new THREE.PointLight(0xffa860, i, d, 1.6); l.position.set(x, y, z); scene.add(l); return l; };
  const key = new THREE.SpotLight(0xffb878, 9, 14, 0.9, 0.7, 1.4); key.position.set(0.5, 4.2, -1.2); key.target.position.set(0.8, 1, -2.6);
  key.castShadow = !mobile; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; scene.add(key, key.target);
  warm(-2.4, 3.6, -3.2, 7.5); warm(2.6, 3.6, -3.4, 6); warm(1.9, 1.6, -1.9, 0.35, 1.6);

  /* ── shop shell: interior x[-4.5,4.5] z[-6,0] y[0,4.5] ── */
  const plaster = std(C.plaster), plasterIn = std(0xe9d6b6), trim = std(C.woodDark, { roughness: 0.55 });
  mesh(new THREE.PlaneGeometry(9, 6), std(0xffffff, { map: keep(tileTexture()), roughness: 0.45 }), 0, 0.001, -3).rotation.x = -Math.PI / 2;
  box(9, 4.5, 0.2, plasterIn, 0, 2.25, -6.1);
  box(0.2, 4.5, 6.2, plasterIn, -4.6, 2.25, -3); box(0.2, 4.5, 6.2, plasterIn, 4.6, 2.25, -3);
  box(9.4, 0.2, 6.4, std(0x2a1d14), 0, 4.6, -3);
  // wainscot
  box(8.9, 1.1, 0.05, std(0x8a5a35, { roughness: 0.6 }), 0, 0.55, -5.98);
  // front wall with window (x[-3.9,0.9], y[0.75,3.25]) and door (x[1.7,3.5], y[0,3.1])
  const fz = 0;
  box(0.6, 4.5, 0.3, plaster, -4.25, 2.25, fz); box(0.8, 4.5, 0.3, plaster, 1.3, 2.25, fz); box(0.9, 4.5, 0.3, plaster, 4.05, 2.25, fz);
  box(4.8, 0.75, 0.3, plaster, -1.5, 0.375, fz); box(4.8, 1.25, 0.3, plaster, -1.5, 3.875, fz); box(1.8, 1.4, 0.3, plaster, 2.6, 3.8, fz);
  box(4.9, 0.08, 0.42, trim, -1.5, 0.78, fz + 0.05); box(4.9, 0.08, 0.36, trim, -1.5, 3.25, fz); box(0.08, 2.5, 0.36, trim, -1.5, 2, fz);
  box(1.9, 0.08, 0.36, trim, 2.6, 3.1, fz); box(0.08, 3.1, 0.36, trim, 1.7, 1.55, fz); box(0.08, 3.1, 0.36, trim, 3.5, 1.55, fz);
  const glass = keep(new THREE.MeshPhysicalMaterial({ color: 0xffe2c0, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, depthWrite: false }));
  const pane = mesh(new THREE.PlaneGeometry(4.8, 2.5), glass, -1.5, 2, fz + 0.02); pane.castShadow = false;
  // door, swung open inward
  const door = new THREE.Group(); door.position.set(3.5, 0, fz); door.rotation.y = 1.25; scene.add(door);
  box(1.75, 3.05, 0.06, trim, -0.88, 1.53, 0, door);
  mesh(new THREE.PlaneGeometry(1.3, 1.9), glass, -0.88, 1.9, 0.04, door);
  // upper storey with lit flats
  const flats = keep(windowsTexture(10, 5)); flats.repeat.set(1, 1);
  box(9.4, 3.8, 6.4, std(0x3a2c22), 0, 6.6, -3);
  mesh(new THREE.PlaneGeometry(8.6, 3.2), std(0x222222, { map: flats, emissiveMap: flats, emissive: 0xffffff, emissiveIntensity: 0.9 }), 0, 6.6, 0.21);
  box(9.8, 0.3, 0.6, std(0x4a3628), 0, 8.6, 0);
  // sign
  const sign = keep(signTexture());
  box(5.6, 0.95, 0.14, std(0x1a120c, { map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 1.25 }), -1.2, 4.4, 0.3);
  // striped awning
  const stripeA = std(C.crust, { roughness: 0.9, side: THREE.DoubleSide }), stripeB = std(C.cream, { roughness: 0.9, side: THREE.DoubleSide });
  const awning = new THREE.Group(); awning.position.set(-1.5, 3.55, 0.25); awning.rotation.x = 0.42; scene.add(awning);
  for (let i = 0; i < 10; i++) {
    box(0.52, 0.03, 1.35, i % 2 ? stripeA : stripeB, -2.34 + i * 0.52, 0, 0.62, awning);
    const sc = mesh(new THREE.CircleGeometry(0.26, 18, Math.PI, Math.PI), i % 2 ? stripeA : stripeB, -3.84 + i * 0.52, 3.02, 1.46);
    sc.scale.y = 0.62;
  }

  /* ── interior: counter, display, shelves, lamps ── */
  const wood = std(C.wood, { roughness: 0.55 });
  box(5.4, 1.0, 0.95, wood, 0.6, 0.5, -2.6);
  box(5.6, 0.07, 1.05, std(0xa89478, { roughness: 0.55 }), 0.6, 1.035, -2.6);
  for (let i = 0; i < 6; i++) box(0.04, 0.8, 0.02, trim, -1.7 + i * 0.9, 0.48, -2.11);
  // glass display case
  box(2.6, 0.04, 0.85, std(0xf6efe4), -0.9, 1.1, -2.6);
  const caseGlass = mesh(new THREE.BoxGeometry(2.6, 0.62, 0.85), glass, -0.9, 1.42, -2.6); caseGlass.castShadow = false;
  box(2.6, 0.03, 0.85, std(0xf6efe4), -0.9, 1.74, -2.6);
  const caseGlow = new THREE.PointLight(0xffc890, 0.9, 2.2, 1.5); caseGlow.position.set(-0.9, 1.68, -2.6); scene.add(caseGlow);

  const loafMat = std(C.loaf, { roughness: 0.62 }), loafDark = std(C.loafDark, { roughness: 0.7 });
  const loaf = (x: number, y: number, z: number, s = 1, rot = 0, mat = loafMat) => {
    const m = mesh(new THREE.CapsuleGeometry(0.11 * s, 0.22 * s, 6, 14), mat, x, y, z); m.rotation.set(0, rot, Math.PI / 2); m.scale.set(1, 1, 0.78);
    for (let k = -1; k <= 1; k++) { const cut = mesh(new THREE.BoxGeometry(0.014, 0.012, 0.15 * s), std(0xf1d9a6), x + k * 0.09 * s * Math.cos(rot), y + 0.09 * s, z - k * 0.09 * s * Math.sin(rot)); cut.rotation.y = rot + 0.6; }
    return m;
  };
  const croissant = (x: number, y: number, z: number, r = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = r; scene.add(g);
    const m = mesh(new THREE.TorusGeometry(0.09, 0.045, 10, 22, Math.PI * 1.25), loafMat, 0, 0, 0, g); m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.PI * 0.12;
    for (let k = 0; k < 4; k++) { const ring = mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 16), loafDark, Math.cos(k * 0.95) * 0.09, 0, -Math.sin(k * 0.95) * 0.09, g); ring.rotation.y = k * 0.95; }
    return g;
  };
  const donut = (x: number, y: number, z: number, icing: number) => {
    const d = mesh(new THREE.TorusGeometry(0.07, 0.035, 12, 24), std(0xd08a45), x, y, z); d.rotation.x = -Math.PI / 2;
    const i = mesh(new THREE.TorusGeometry(0.07, 0.03, 10, 24, Math.PI * 2), std(icing, { roughness: 0.35 }), x, y + 0.016, z); i.rotation.x = -Math.PI / 2; i.scale.z = 0.7;
  };
  // inside the display
  for (let i = 0; i < 5; i++) croissant(-2.0 + i * 0.27, 1.17, -2.45, i * 0.5);
  for (let i = 0; i < 6; i++) donut(-1.95 + i * 0.22, 1.16, -2.78, [C.pink, C.choco, C.butter, 0xf6efe4, C.pink, C.choco][i]);
  for (let i = 0; i < 3; i++) loaf(-0.35 + i * 0.0, 1.22, -2.4 - i * 0.18, 0.9, 0.2);
  // cake stand on the counter
  mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24), std(0xf6efe4), 2.75, 1.13, -2.7);
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 32), std(0xf6efe4), 2.75, 1.2, -2.7);
  mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.22, 32), std(0xf6d4dc), 2.75, 1.32, -2.7);
  mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.04, 32), std(C.choco, { roughness: 0.35 }), 2.75, 1.44, -2.7);
  for (let i = 0; i < 8; i++) mesh(new THREE.SphereGeometry(0.025, 10, 8), std(0xd2283c, { roughness: 0.3 }), 2.75 + Math.cos(i * 0.785) * 0.17, 1.48, -2.7 + Math.sin(i * 0.785) * 0.17);

  // the payment: QR stand on the counter, facing the customer
  const qr = keep(qrTexture());
  const stand = new THREE.Group(); stand.position.set(1.85, 1.07, -2.35); stand.rotation.set(-0.18, -0.12, 0); scene.add(stand);
  box(0.28, 0.025, 0.16, std(0x1c1410), 0, 0, -0.02, stand);
  box(0.25, 0.36, 0.012, std(0x1c1410), 0, 0.19, -0.01, stand).rotation.x = -0.1;
  const card = mesh(new THREE.PlaneGeometry(0.22, 0.31), std(0xffffff, { map: qr, emissiveMap: qr, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.5 }), 0, 0.19, 0.0, stand);
  card.rotation.x = -0.1; card.castShadow = false;
  // a phone hovering in front of it, mid-scan
  const phone = new THREE.Group(); phone.position.set(2.2, 1.3, -2.02); phone.rotation.set(-0.2, 0.42, -0.08); scene.add(phone);
  box(0.15, 0.3, 0.012, std(0x0f0f12, { roughness: 0.3, metalness: 0.4 }), 0, 0, 0, phone);
  const screenTex = canvasTex(150, 300, g => {
    const gr = g.createLinearGradient(0, 0, 0, 300); gr.addColorStop(0, '#1b120b'); gr.addColorStop(1, '#2d1a0e'); g.fillStyle = gr; g.fillRect(0, 0, 150, 300);
    g.strokeStyle = '#4fd1a1'; g.lineWidth = 5; g.beginPath(); g.arc(75, 112, 30, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(60, 113); g.lineTo(71, 124); g.lineTo(92, 100); g.stroke();
    g.fillStyle = '#f6efe4'; g.textAlign = 'center'; g.font = '800 30px "Bricolage Grotesque", sans-serif'; g.fillText('₹500', 75, 186);
    g.font = '500 11px "JetBrains Mono", monospace'; g.fillStyle = '#b7aa98'; g.fillText('PAID · 23:41', 75, 210); g.fillText('payer: MH → ??', 75, 230);
  });
  keep(screenTex);
  const screen = mesh(new THREE.PlaneGeometry(0.135, 0.28), keep(new THREE.MeshBasicMaterial({ map: screenTex })), 0, 0, 0.0075, phone); screen.castShadow = false;

  // shelves on the back wall
  for (let s = 0; s < 3; s++) {
    const y = 1.5 + s * 0.75;
    box(7.6, 0.06, 0.45, wood, 0, y, -5.75);
    for (let i = 0; i < 11; i++) {
      const x = -3.4 + i * 0.68 + (rnd() - 0.5) * 0.1;
      if (s === 1 && i % 3 === 0) { const b = mesh(new THREE.CapsuleGeometry(0.05, 0.6, 4, 10), loafMat, x, y + 0.08, -5.72); b.rotation.z = Math.PI / 2 - 0.12; }
      else if (s === 2) mesh(new THREE.SphereGeometry(0.15, 16, 12), (i % 2 ? loafMat : loafDark), x, y + 0.13, -5.72).scale.set(1, 0.72, 1);
      else loaf(x, y + 0.1, -5.72, 1.05, 1.57 + (rnd() - 0.5) * 0.4, i % 4 ? loafMat : loafDark);
    }
  }
  // chalk menu board
  const menuTex = canvasTex(512, 320, g => {
    g.fillStyle = '#1e2620'; g.fillRect(0, 0, 512, 320); g.strokeStyle = '#8a5a35'; g.lineWidth = 16; g.strokeRect(0, 0, 512, 320);
    g.fillStyle = '#f3ecdc'; g.font = 'italic 46px "Instrument Serif", Georgia, serif'; g.textAlign = 'center'; g.fillText('Today', 256, 64);
    g.font = '400 22px "JetBrains Mono", monospace'; g.textAlign = 'left';
    [['Croissant', '₹120'], ['Sourdough', '₹260'], ['Doughnut', '₹90'], ['Celebration cake', '₹1,150'], ['Filter coffee', '₹60']].forEach(([a, b], i) => {
      g.fillText(a, 44, 116 + i * 40); g.textAlign = 'right'; g.fillText(b, 468, 116 + i * 40); g.textAlign = 'left';
    });
  });
  box(2.2, 1.38, 0.05, std(0xffffff, { map: keep(menuTex), emissiveMap: menuTex, emissive: 0xffffff, emissiveIntensity: 0.18 }), 2.8, 3.55, -5.95);
  // pendant lamps
  const shadeMat = std(C.crust, { roughness: 0.5, side: THREE.DoubleSide }), bulbMat = keep(new THREE.MeshBasicMaterial({ color: 0xffe0a8 }));
  [-2.2, 0.6, 3.0].forEach(x => {
    mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 6), trim, x, 4.05, -2.6);
    mesh(new THREE.ConeGeometry(0.28, 0.26, 24, 1, true), shadeMat, x, 3.5, -2.6);
    mesh(new THREE.SphereGeometry(0.08, 14, 10), bulbMat, x, 3.4, -2.6).castShadow = false;
  });

  /* ── street ── */
  box(80, 0.16, 3.4, std(0x2a2420, { roughness: 0.9 }), 0, 0.08, 1.7);
  box(80, 0.18, 0.18, std(C.curb), 0, 0.09, 3.45);
  const road = mesh(new THREE.PlaneGeometry(400, 400), std(C.asphalt, { roughness: 0.95 }), 0, 0, 0); road.rotation.x = -Math.PI / 2; road.position.y = -0.01;
  for (let i = -12; i <= 12; i++) { const d = mesh(new THREE.PlaneGeometry(1.6, 0.12), std(0x6a5d4c), i * 3.2, 0.005, 7.5); d.rotation.x = -Math.PI / 2; d.castShadow = false; }
  box(80, 0.16, 3.4, std(0x2a2420, { roughness: 0.9 }), 0, 0.08, 13.2);
  // lamp posts
  const lampMat = std(0x1c1814, { metalness: 0.5, roughness: 0.4 });
  [-7, 9, 22, -20].forEach(x => {
    mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 10), lampMat, x, 2.3, 3.1);
    box(0.7, 0.06, 0.06, lampMat, x, 4.55, 2.8);
    mesh(new THREE.SphereGeometry(0.14, 14, 10), bulbMat, x, 4.45, 2.5).castShadow = false;
    warm(x, 4.3, 2.6, 5, 11);
  });
  // a bench and a planter outside the door
  box(1.6, 0.08, 0.45, wood, -3.2, 0.62, 1.6); box(0.08, 0.45, 0.4, lampMat, -3.9, 0.38, 1.6); box(0.08, 0.45, 0.4, lampMat, -2.5, 0.38, 1.6);
  box(0.6, 0.6, 0.6, std(0x5a3a26), 4.3, 0.46, 1.1);
  mesh(new THREE.IcosahedronGeometry(0.5, 1), std(0x2f5a3a, { flatShading: true }), 4.3, 1.15, 1.1);

  // neighbouring buildings on both sides of the street
  const neighbour = (x: number, z: number, w: number, h: number, d: number, face: 1 | -1) => {
    const t = keep(windowsTexture(Math.max(3, Math.round(w * 1.4)), Math.max(3, Math.round(h * 0.9))));
    box(w, h, d, std(0x231b15), x, h / 2, z);
    const f = mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.86), std(0x111111, { map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.6 }), x, h * 0.53, z + face * (d / 2 + 0.01));
    if (face < 0) f.rotation.y = Math.PI;
    f.castShadow = false;
  };
  let xl = -5.2; while (xl > -45) { const w = 5 + rnd() * 4; neighbour(xl - w / 2, -3, w - 0.2, 6 + rnd() * 9, 6, 1); xl -= w; }
  let xr = 5.2; while (xr < 45) { const w = 5 + rnd() * 4; neighbour(xr + w / 2, -3, w - 0.2, 6 + rnd() * 9, 6, 1); xr += w; }
  let xo = -44; while (xo < 44) { const w = 5 + rnd() * 5; if (xo + w < -2 || xo > 26) neighbour(xo + w / 2, 18.5, w - 0.2, 5 + rnd() * 12, 6, -1); xo += w; }
  // a small square opposite the shop, so the camera has room to rise
  for (let i = 0; i < 9; i++) { const tx = 1 + (i % 3) * 8 + rnd() * 2, tz = 16 + Math.floor(i / 3) * 3.2; mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.6, 8), std(0x3a2a1e), tx, 0.8, tz); mesh(new THREE.IcosahedronGeometry(0.9 + rnd() * 0.4, 1), std(0x274a33, { flatShading: true }), tx, 2.2, tz); }

  /* ── the wider city: instanced blocks with window lights ── */
  const blocks = 520, cityGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const city = new THREE.InstancedMesh(cityGeo, std(0x1d1712, { roughness: 0.9 }), blocks);
  const dummy = new THREE.Object3D(); const winPts: number[] = [];
  let n = 0;
  for (let gx = -16; gx <= 16 && n < blocks; gx++) for (let gz = -16; gz <= 16 && n < blocks; gz++) {
    const x = gx * 11 + (rnd() - 0.5) * 3, z = gz * 11 + (rnd() - 0.5) * 3;
    if (Math.abs(x) < 50 && z > -12 && z < 26) continue;
    const r = Math.hypot(x, z); if (r > 175 || rnd() < 0.18) continue;
    const h = 4 + rnd() * (r < 60 ? 22 : 12), w = 5 + rnd() * 4, d = 5 + rnd() * 4;
    dummy.position.set(x, h / 2, z); dummy.scale.set(w, h, d); dummy.updateMatrix(); city.setMatrixAt(n++, dummy.matrix);
    for (let k = 0; k < h * 1.2; k++) winPts.push(x + (rnd() - 0.5) * w, 1 + rnd() * (h - 1.5), z + (rnd() > 0.5 ? d / 2 : -d / 2) + 0.05);
  }
  city.count = n; scene.add(city);
  const glow = keep(glowSprite());
  const winGeo = keep(new THREE.BufferGeometry()); winGeo.setAttribute('position', new THREE.Float32BufferAttribute(winPts, 3));
  const winMat = keep(new THREE.PointsMaterial({ color: 0xffb46a, size: 0.55, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  scene.add(new THREE.Points(winGeo, winMat));

  /* ── payment arcs: who actually pays this bakery ── */
  const origin = new THREE.Vector3(0.6, 1.2, -2.6);
  interface Arc { curve: THREE.QuadraticBezierCurve3; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; pulse: THREE.Sprite; start: number; speed: number; ring: THREE.Mesh }
  const arcs: Arc[] = [];
  const addArc = (to: THREE.Vector3, color: number, start: number, radius: number) => {
    const dist = origin.distanceTo(to);
    const mid = origin.clone().lerp(to, 0.5); mid.y += dist * 0.24 + 2;
    const curve = new THREE.QuadraticBezierCurve3(origin.clone(), mid, to);
    const geo = keep(new THREE.TubeGeometry(curve, 64, radius, 6, false));
    const mat = keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; geo.setDrawRange(0, 0); scene.add(m);
    const pulse = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    pulse.scale.setScalar(radius * 22); pulse.visible = false; scene.add(pulse);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(0.6, 0.9, 32)), keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(to).setY(0.06); ring.scale.setScalar(radius * 14); scene.add(ring);
    arcs.push({ curve, mesh: m, mat, pulse, start, speed: 0.18 + rnd() * 0.22, ring });
  };
  for (let i = 0; i < facts.local; i++) {
    // keep local arcs out of the camera's side of the street (azimuth ~10°–115°)
    let a = rnd() * Math.PI * 2; while (a > 0.17 && a < 2.0) a = rnd() * Math.PI * 2;
    const r = 9 + rnd() * 30;
    addArc(new THREE.Vector3(Math.cos(a) * r, 0.2, Math.sin(a) * r - 4), i % 3 ? C.mint : C.cream, 0.6 + (i / facts.local) * 0.12, 0.07);
  }
  for (let i = 0; i < facts.far; i++) {
    const a = -Math.PI * 0.85 + (rnd() - 0.5) * 1.3, r = 95 + rnd() * 70;
    addArc(new THREE.Vector3(Math.cos(a) * r, 0.2, Math.sin(a) * r), C.bad, 0.7 + (i / facts.far) * 0.14, 0.14);
  }
  const beacon = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glow, color: C.crust, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })));
  beacon.position.copy(origin).setY(5); beacon.scale.setScalar(10); scene.add(beacon);

  /* steam above the display and the QR "ping" */
  const steam: THREE.Sprite[] = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glow, color: 0xfff2e0, transparent: true, opacity: 0, depthWrite: false })));
    s.userData = { x: -1.9 + rnd() * 2.2, z: -2.6 + (rnd() - 0.5) * 0.4, o: rnd() }; scene.add(s); steam.push(s);
  }
  const ping = new THREE.Mesh(keep(new THREE.RingGeometry(0.1, 0.112, 48)), keep(new THREE.MeshBasicMaterial({ color: C.mint, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
  ping.position.set(1.85, 1.27, -2.32); ping.rotation.set(-0.28, -0.12, 0); scene.add(ping);

  /* ── camera path ── */
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const KEYS: { t: number; pos: THREE.Vector3; look: THREE.Vector3 }[] = [
    { t: 0.0, pos: V(1.98, 1.5, -1.2), look: V(1.9, 1.24, -2.35) },
    { t: 0.22, pos: V(3.15, 2.0, -0.55), look: V(0.0, 1.25, -3.1) },
    { t: 0.33, pos: V(2.65, 2.05, 1.6), look: V(0.2, 1.8, -2.6) },
    { t: 0.48, pos: V(0.6, 2.4, 9.2), look: V(-0.4, 2.7, -1.0) },
    { t: 0.68, pos: V(12, 10, 14.2), look: V(0, 2.2, -2) },
    { t: 0.93, pos: V(14, 70, 62), look: V(-8, 0, -22) },
    { t: 1.0, pos: V(14, 72, 64), look: V(-8, 0, -22) },
  ];
  const posCurve = new THREE.CatmullRomCurve3(KEYS.map(k => k.pos), false, 'centripetal');
  const lookCurve = new THREE.CatmullRomCurve3(KEYS.map(k => k.look), false, 'centripetal');
  const pathAt = (p: number) => {
    let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const u = smoother((p - a.t) / (b.t - a.t));
    return (i + u) / (KEYS.length - 1);
  };

  let target = 0, progress = 0, mx = 0, my = 0, pmx = 0, pmy = 0, raf = 0, last = performance.now(), time = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  let composer: EffectComposer | null = null, bloom: UnrealBloomPass | null = null;
  if (!mobile) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); composer?.setSize(w, h); bloom?.setSize(w, h);
    camera.aspect = w / h; camera.fov = w / h < 0.8 ? 58 : 42; camera.updateProjectionMatrix();
  };
  resize();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += reduce ? 0 : dt;
    progress += (target - progress) * Math.min(1, dt * 6);
    pmx += (mx - pmx) * Math.min(1, dt * 3); pmy += (my - pmy) * Math.min(1, dt * 3);
    const p = progress, q = pathAt(p);

    posCurve.getPoint(q, camPos); lookCurve.getPoint(q, camLook);
    const reach = 0.08 + Math.min(1, camPos.y / 20) * 2.4;
    right.subVectors(camLook, camPos).cross(up).normalize();
    camera.position.copy(camPos).addScaledVector(right, pmx * reach).addScaledVector(up, -pmy * reach * 0.5);
    camera.lookAt(camLook);

    fog.density = THREE.MathUtils.lerp(0.035, 0.0055, smoother((p - 0.3) / 0.55));
    winMat.opacity = smoother((p - 0.55) / 0.2) * 0.9;
    beacon.material.opacity = smoother((p - 0.72) / 0.12) * 0.8;
    beacon.scale.setScalar(9 + Math.sin(time * 2) * 1.2);

    // the scan: phone pulse in the first chapter
    const pingT = (time * 0.7) % 1;
    (ping.material as THREE.MeshBasicMaterial).opacity = (1 - pingT) * band(p, -0.1, 0.2) * 0.45;
    ping.scale.setScalar(1 + pingT * 0.6);
    phone.position.y = 1.3 + Math.sin(time * 1.6) * 0.008;

    steam.forEach(s => {
      const u = (time * 0.18 + s.userData.o) % 1;
      s.position.set(s.userData.x + Math.sin(u * 6 + s.userData.o * 9) * 0.05, 1.8 + u * 1.1, s.userData.z);
      s.scale.setScalar(0.12 + u * 0.35);
      s.material.opacity = Math.sin(u * Math.PI) * 0.14 * (1 - smoother((p - 0.4) / 0.1));
    });

    arcs.forEach(a => {
      const k = smoother((p - a.start) / 0.12);
      const idx = a.mesh.geometry.index!.count;
      a.mesh.geometry.setDrawRange(0, Math.floor(idx * k / 36) * 36);
      a.mat.opacity = 0.85 * k;
      const ringMat = a.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = k >= 1 ? 0.55 + Math.sin(time * 3 + a.start * 50) * 0.25 : 0;
      a.pulse.visible = k >= 1;
      if (a.pulse.visible) a.curve.getPoint(1 - ((time * a.speed + a.start * 7) % 1), a.pulse.position);
    });

    if (composer) composer.render(); else renderer.render(scene, camera);
  };
  renderer.compile(scene, camera);
  raf = requestAnimationFrame(frame);

  return {
    setProgress: p => { target = Math.min(1, Math.max(0, p)); },
    setPointer: (x, y) => { mx = x; my = y; },
    resize,
    dispose: () => {
      cancelAnimationFrame(raf);
      disposables.forEach(d => d.dispose());
      city.dispose(); composer?.dispose(); renderer.dispose();
    },
  };
}
