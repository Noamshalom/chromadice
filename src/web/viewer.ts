/**
 * Three.js viewer: every die is a real cube with pip textures, placed at its
 * lattice centre with its chosen rotation. Snapped cameras reproduce the
 * three axis views exactly (orthographic, along the face normals).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AXES, CANON_FACE, ORIENTATIONS, pipCentres3D, type DieType, type Lattice, type Vec3 } from '../core';

/** Canvas right/up vectors (local die axes) for BoxGeometry material index 0..5 (+x,-x,+y,-y,+z,-z). */
const FACE_FRAME: { right: Vec3; up: Vec3 }[] = [
  { right: [0, 0, -1], up: [0, 1, 0] },
  { right: [0, 0, 1], up: [0, 1, 0] },
  { right: [1, 0, 0], up: [0, 0, -1] },
  { right: [1, 0, 0], up: [0, 0, 1] },
  { right: [1, 0, 0], up: [0, 1, 0] },
  { right: [-1, 0, 0], up: [0, 1, 0] },
];

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function faceTexture(type: DieType, materialIndex: number, pipRadius: number, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = type.body;
  g.fillRect(0, 0, size, size);
  // soft edge bevel
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
  grad.addColorStop(0, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const { right, up } = FACE_FRAME[materialIndex];
  const r = pipRadius * size;
  for (const p of pipCentres3D(materialIndex, 0.3)) {
    const x = (0.5 + dot(p, right)) * size, y = (0.5 - dot(p, up)) * size;
    // recessed pip: a soft dark rim (ambient occlusion of the dimple), then the painted pip
    g.save(); g.globalAlpha = 0.45; g.fillStyle = '#000'; g.beginPath(); g.arc(x, y + r * 0.08, r * 1.22, 0, Math.PI * 2); g.fill(); g.restore();
    g.fillStyle = type.pip; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    // dimple shading: shadow at the top of the hollow, light catching the bottom
    const sh = g.createLinearGradient(x, y - r, x, y + r);
    sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(255,255,255,0.22)');
    g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip(); g.fillStyle = sh; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Self-check: the pip pattern drawn on material i must be the canonical face value of axis i. */
export function faceValueOfMaterial(i: number): number { return CANON_FACE[i]; }

export class DiceViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  private meshes: THREE.InstancedMesh[] = [];
  private jig?: THREE.Mesh;
  private lattice?: Lattice;
  private anim?: { from: THREE.Vector3; to: THREE.Vector3; upFrom: THREE.Vector3; upTo: THREE.Vector3; t0: number; dur: number; zoomFrom: number; zoomTo: number };
  private extent = 20;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#0f1f19');
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.OrthographicCamera(-20 * aspect, 20 * aspect, 20, -20, 0.1, 2000);
    this.camera.position.set(60, 60, 60);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#334', 1.0));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.1);
    sun.position.set(30, 80, 40);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#dde8ff', 0.4);
    fill.position.set(-50, 20, -30);
    this.scene.add(fill);
    // soft studio reflections on the plastic
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const e = this.extent;
    this.camera.left = -e * aspect; this.camera.right = e * aspect; this.camera.top = e; this.camera.bottom = -e;
    this.camera.updateProjectionMatrix();
  }

  /** levelColour(t, n): when given, each face is drawn flat in that colour (face-level view) instead of with pips. */
  setMosaic(lattice: Lattice, types: DieType[], typeOf: Int16Array, orientOf: Int8Array, pipRadius: number, levelColour?: (t: number, n: number) => string, keepCamera = false) {
    for (const m of this.meshes) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material[]).forEach((x) => x.dispose()); }
    this.meshes = [];
    if (this.jig) { this.scene.remove(this.jig); this.jig.geometry.dispose(); }
    this.lattice = lattice;
    const counts = new Array(types.length).fill(0);
    for (let i = 0; i < typeOf.length; i++) counts[typeOf[i]]++;
    // real dice: rounded edges and corners (BoxGeometry groups are kept, so per-face materials still work)
    const geo = levelColour ? new THREE.BoxGeometry(0.985, 0.985, 0.985) : new RoundedBoxGeometry(0.975, 0.975, 0.975, 2, 0.11);
    const mat4 = new THREE.Matrix4();
    // centre the block on the origin (the camera orbits and fits around the origin)
    const off = new THREE.Vector3();
    for (const c of lattice.cells) off.add(new THREE.Vector3(...c.pos));
    off.multiplyScalar(-1 / Math.max(1, lattice.cells.length));
    for (let t = 0; t < types.length; t++) {
      if (counts[t] === 0) continue;
      const mats = [0, 1, 2, 3, 4, 5].map((i) => levelColour
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(levelColour(t, CANON_FACE[i])).convertSRGBToLinear() })
        : new THREE.MeshPhysicalMaterial({ map: faceTexture(types[t], i, pipRadius), roughness: 0.32, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
      const mesh = new THREE.InstancedMesh(geo, mats, counts[t]);
      let k = 0;
      for (const cell of lattice.cells) {
        if (typeOf[cell.index] !== t) continue;
        const R = ORIENTATIONS[orientOf[cell.index]].R;
        mat4.set(R[0], R[1], R[2], cell.pos[0] + off.x, R[3], R[4], R[5], cell.pos[1] + off.y, R[6], R[7], R[8], cell.pos[2] + off.z, 0, 0, 0, 1);
        mesh.setMatrixAt(k++, mat4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    // jig: a thin dark slab just below the dice
    const up = new THREE.Vector3(...lattice.up);
    let maxR = 1;
    for (const c of lattice.cells) maxR = Math.max(maxR, Math.hypot(c.pos[0] + off.x, c.pos[1] + off.y, c.pos[2] + off.z));
    let jigGeo: THREE.BufferGeometry;
    if (lattice.mode === 'single') {
      let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const c of lattice.cells) { minY = Math.min(minY, c.pos[1]); maxY = Math.max(maxY, c.pos[1]); minZ = Math.min(minZ, c.pos[2]); maxZ = Math.max(maxZ, c.pos[2]); }
      jigGeo = new THREE.BoxGeometry(0.6, maxY - minY + 3, maxZ - minZ + 3);
      this.jig = new THREE.Mesh(jigGeo, new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.9 }));
      this.jig.position.set(-0.5 - 0.35 + off.x, (minY + maxY) / 2 + off.y, (minZ + maxZ) / 2 + off.z);
    } else {
      // rectangular slab in the table plane, aligned with its own axes:
      // corner: a = (1,-1,0)/√2, b = (1,1,-2)/√6; edge: a = (0,0,1) along the edge, b = (1,-1,0)/√2
      const corner = lattice.mode === 'corner';
      const a = corner ? new THREE.Vector3(1, -1, 0).normalize() : new THREE.Vector3(0, 0, 1);
      const bb = corner ? new THREE.Vector3(1, 1, -2).normalize() : new THREE.Vector3(1, -1, 0).normalize();
      const depth = corner ? Math.sqrt(3) / 2 : Math.SQRT2 / 2; // lowest die corner below the centre plane
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const c of lattice.cells) { const p = new THREE.Vector3(...c.pos); const pa = p.dot(a), pb = p.dot(bb); minA = Math.min(minA, pa); maxA = Math.max(maxA, pa); minB = Math.min(minB, pb); maxB = Math.max(maxB, pb); }
      jigGeo = new THREE.BoxGeometry(maxA - minA + 2.2, 0.6, maxB - minB + 2.2);
      this.jig = new THREE.Mesh(jigGeo, new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.9 }));
      // BoxGeometry(x = along a, y = thickness along up, z = along b)
      // right-handed triple: a × up = -bb, so use -bb as the box's Z axis
      const basis = new THREE.Matrix4().makeBasis(a, up.clone(), bb.clone().negate());
      this.jig.quaternion.setFromRotationMatrix(basis);
      const centre = a.clone().multiplyScalar((minA + maxA) / 2).add(bb.clone().multiplyScalar((minB + maxB) / 2));
      // dice centres are in the plane; their lowest corner is √3/2 below it; put the slab's top just under that
      this.jig.position.copy(centre.add(off).add(up.clone().multiplyScalar(-depth - 0.3)));
      this.jig.renderOrder = -1;
    }
    this.scene.add(this.jig);
    this.extent = maxR * 0.75 + 2;
    this.resize();
    if (!keepCamera) {
      this.camera.up.copy(up);
      this.controls.target.set(0, 0, 0);
      this.snapTo('free', false);
    }
  }

  /** Snap the camera: 'view1'..'view3', 'top', or 'free' (a pleasant oblique angle). */
  snapTo(which: 'view1' | 'view2' | 'view3' | 'top' | 'free', animate = true) {
    if (!this.lattice) return;
    const L = this.lattice;
    const D = 400;
    let pos: THREE.Vector3, up: THREE.Vector3, zoom = 1;
    const upL = new THREE.Vector3(...L.up);
    if (which.startsWith('view')) {
      const v = L.views[Number(which.slice(4)) - 1];
      if (!v) return;
      pos = new THREE.Vector3(...v.forward).multiplyScalar(-D);
      up = new THREE.Vector3(...v.up);
      // fit the whole picture: half-extent of this view in die units (+1 for the die itself)
      const halfW = (v.maxSx - v.minSx) / 2 + 1, halfH = (v.maxSy - v.minSy) / 2 + 1;
      const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
      zoom = 0.97 * Math.min((this.extent * aspect) / halfW, this.extent / halfH);
    } else if (which === 'top') {
      if (L.mode === 'single') { this.snapTo('view1', animate); return; }
      pos = upL.clone().multiplyScalar(D);
      const ref = L.mode === 'corner' ? new THREE.Vector3(1, -1, 0).normalize() : new THREE.Vector3(0, 0, 1);
      up = new THREE.Vector3().crossVectors(upL, ref).normalize();
      zoom = 1.1;
    } else {
      // oblique: between view 1 and top (single: a slight tilt off the face normal)
      const v = L.views[0];
      const f = new THREE.Vector3(...v.forward).multiplyScalar(-1);
      if (L.mode === 'single') { pos = f.clone().add(new THREE.Vector3(0, 0.35, 0.25)).normalize().multiplyScalar(D); up = new THREE.Vector3(0, 0, 1); zoom = 0.9; }
      else { pos = f.clone().lerp(upL, 0.45).normalize().multiplyScalar(D); up = upL.clone(); zoom = 0.95; }
    }
    if (!animate) {
      this.camera.position.copy(pos); this.camera.up.copy(up); this.camera.zoom = zoom; this.camera.updateProjectionMatrix();
      this.controls.update();
      return;
    }
    this.controls.enabled = false;
    this.anim = { from: this.camera.position.clone(), to: pos, upFrom: this.camera.up.clone(), upTo: up, t0: performance.now(), dur: 650, zoomFrom: this.camera.zoom, zoomTo: zoom };
    setTimeout(() => { this.controls.enabled = true; }, 700);
  }

  private tick() {
    if (this.anim) {
      const a = this.anim;
      const s = Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
      // slerp the direction so the camera swings around the mosaic
      const from = a.from.clone().normalize(), to = a.to.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(from, to);
      const qi = new THREE.Quaternion().slerp(q, e);
      const dir = from.clone().applyQuaternion(qi);
      this.camera.position.copy(dir.multiplyScalar(a.from.length() + (a.to.length() - a.from.length()) * e));
      this.camera.up.copy(a.upFrom.clone().lerp(a.upTo, e).normalize());
      this.camera.zoom = a.zoomFrom + (a.zoomTo - a.zoomFrom) * e;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      if (s >= 1) { this.anim = undefined; this.controls.update(); }
    } else {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** The face value seen along world axis `axisIdx` for a given orientation (for the self-test). */
  static faceAlong(orient: number, axisIdx: number): number { return ORIENTATIONS[orient].faces[axisIdx]; }
  static axes = AXES;
}
