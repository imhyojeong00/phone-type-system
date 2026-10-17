const TARGET_H = 1.2;
const MM = 1 / 100;
const FLAT_MS = 460;
const INFLATE_MS = 1300;
const SETTLE_MS = 1400;
const PARTNER_DELAY = 0.3;

const FOV = 9;
const VIEW_THETA = 0;
const VIEW_PHI = Math.PI / 2;

const DIST_K = Math.tan((14 * Math.PI) / 180) / Math.tan(((FOV / 2) * Math.PI) / 180);

const keyIndex = new Map();
PHONES.forEach((p, i) => keyIndex.set(p.key, i));

const stage = document.getElementById("stage");
const viewW = () => stage.clientWidth || window.innerWidth;
const viewH = () => stage.clientHeight || window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewW(), viewH());
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(FOV, viewW() / viewH(), 0.05, 400);
let camDist = 3.4 * DIST_K;
let zoomK = 1;
const camTarget = new THREE.Vector3(0, 0.5, 0);
let camX = 0;
let camXGoal = 0;

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2.2, 4, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 12;
key.shadow.bias = -0.0005;
key.shadow.radius = 6;
scene.add(key);
scene.add(key.target);
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d6cf, 0.35));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.16 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const XRAY_NOISE = `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                   mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                   mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    return vnoise(p) * 0.55 + vnoise(p * 2.07 + 11.3) * 0.3 + vnoise(p * 4.31 + 27.1) * 0.15;
  }
  float callusAt(vec3 w) {
    float c0 = uJR0 > 0.0 ? 1.0 - smoothstep(0.0, uJR0, distance(w, uJ0)) : 0.0;
    float c1 = uJR1 > 0.0 ? 1.0 - smoothstep(0.0, uJR1, distance(w, uJ1)) : 0.0;
    float c2 = uJR2 > 0.0 ? 1.0 - smoothstep(0.0, uJR2, distance(w, uJ2)) : 0.0;
    return max(max(c0, c1), c2) * uGraft;
  }
`;
const XRAY_UNIFORMS = `
  uniform float uTime;
  uniform float uGraft;
  uniform vec3 uJ0;
  uniform vec3 uJ1;
  uniform float uJR0;
  uniform float uJR1;
  uniform vec3 uJ2;
  uniform float uJR2;
  uniform vec3 uGrowC;
  uniform float uGrowR;
  uniform float uGrain;
`;
const xrayTime = { value: 0 };
const xrayGrainPx = { value: 1 };

function makeGraftUniforms() {
  return {
    uTime: xrayTime,
    uGrain: xrayGrainPx,
    uGraft: { value: 1 },
    uJ0: { value: new THREE.Vector3() },
    uJ1: { value: new THREE.Vector3() },
    uJ2: { value: new THREE.Vector3() },
    uJR0: { value: 0 },
    uJR1: { value: 0 },
    uJR2: { value: 0 },
    uGrowC: { value: new THREE.Vector3() },
    uGrowR: { value: 1000 }
  };
}
function makeXrayMat(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: XRAY_UNIFORMS + XRAY_NOISE + `
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vV;
      varying float vCallus;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        float c = callusAt(wp.xyz);
        float n = fbm(wp.xyz * 16.0 + uTime * 0.12) - 0.5;
        vec3 jitter = vec3(vnoise(wp.xyz * 23.0 + 3.1), vnoise(wp.xyz * 23.0 + 7.7), vnoise(wp.xyz * 23.0 + 13.9)) - 0.5;
        wp.xyz += wn * (n * 0.07 + 0.012) * c + jitter * 0.03 * c;
        wp.xyz += wn * (vnoise(wp.xyz * 60.0) - 0.5) * 0.0025;
        vW = wp.xyz;
        vCallus = c;
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * wn);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: XRAY_UNIFORMS + XRAY_NOISE + `
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vV;
      varying float vCallus;
      float hash2(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        float edgeN = fbm(vW * 28.0);
        float reach = uGrowR * (0.7 + 0.6 * edgeN);
        float dG = distance(vW, uGrowC);
        if (dG > reach) discard;
        float front = 1.0 - smoothstep(0.0, 0.08, reach - dG);
        if (uGrowR > 100.0) front = 0.0;
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float mottle = fbm(vW * 14.0);
        float lump = fbm(vW * 9.0 + 5.0);
        float d = 0.11 + f * 0.5;
        d *= 0.6 + 0.8 * mottle;
        d += vCallus * (0.25 + 0.6 * lump);
        d += front * 0.7;
        vec2 cell = floor(gl_FragCoord.xy / uGrain);
        float seed = mod(floor(uTime * 10.0), 64.0);
        float g = hash2(cell + seed * vec2(37.0, 91.0));
        if (g > d) discard;
        vec3 ink = vec3(0.10, 0.10, 0.09);
        vec3 col = ink;
        if (g < d * 0.04 && mottle > 0.6) col = vec3(0.93, 0.92, 0.86);
        gl_FragColor = vec4(col, 0.42 + vCallus * 0.25);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

const MESSY_VERT = `
  vec4 gW = modelMatrix * vec4(transformed, 1.0);
  vec3 gN = normalize(mat3(modelMatrix) * normal);
  float gC = callusAt(gW.xyz);
  if (gC > 0.0) {
    float gn = fbm(gW.xyz * 16.0 + uTime * 0.12) - 0.5;
    vec3 gj = vec3(vnoise(gW.xyz * 23.0 + 3.1), vnoise(gW.xyz * 23.0 + 7.7), vnoise(gW.xyz * 23.0 + 13.9)) - 0.5;
    gW.xyz += gN * (gn * 0.06 + 0.01) * gC + gj * 0.025 * gC;
  }
  vGW = gW.xyz;
  vGC = gC;
  vec4 mvPosition = viewMatrix * gW;
  gl_Position = projectionMatrix * mvPosition;
`;
const MESSY_FRAG_START = `
  if (vGC > 0.03) {
    float hn = fbm(vGW * 42.0);
    if (hn < vGC * 0.62 - 0.06) discard;
  }
`;
const MESSY_FRAG_COLOR = `
  if (vGC > 0.001) {
    float grime = fbm(vGW * 30.0 + 2.0);
    float speck = vnoise(vGW * 140.0);
    vec3 dirty = diffuseColor.rgb * (0.2 + 0.6 * grime);
    dirty = mix(dirty, vec3(0.08, 0.075, 0.065), step(0.78, speck) * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, dirty, clamp(vGC * 1.15, 0.0, 1.0));
  }
`;
function makeMessy(orig, u) {
  const m = orig.clone();
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    const head = XRAY_UNIFORMS + XRAY_NOISE + "varying vec3 vGW;\nvarying float vGC;\n";
    shader.vertexShader = head + shader.vertexShader.replace("#include <project_vertex>", MESSY_VERT);
    shader.fragmentShader = head + shader.fragmentShader
      .replace("void main() {", "void main() {\n" + MESSY_FRAG_START)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + MESSY_FRAG_COLOR);
  };
  m.customProgramCacheKey = () => "messy-graft";
  return m;
}

const loader = new THREE.GLTFLoader();
if (window.MeshoptDecoder) loader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map();
const loadingEl = document.getElementById("loading");

const scriptCache = new Map();
function loadScript(id) {
  if (scriptCache.has(id)) return scriptCache.get(id);
  const pr = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = `assets/models/${id}.js`;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`missing assets/models/${id}.js`));
    document.head.appendChild(el);
  });
  scriptCache.set(id, pr);
  return pr;
}

const phoneById = new Map(PHONES.filter((p) => !p.combo).map((p) => [p.id, p]));

function finishRoot(root, p) {
  if (p.rotY) root.rotation.y = (p.rotY * Math.PI) / 180;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let s;
  if (p.fit) s = (p.fit[1] * MM) / size[p.fit[0]];
  else if (p.size_mm) s = (p.size_mm[1] * MM) / size.y;
  else s = TARGET_H / size.y;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);

  if (p.thick && p.size_mm) {
    const dz = box.getSize(new THREE.Vector3()).z;
    root.scale.z *= (p.size_mm[2] * MM) / dz;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
  }
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= box.min.y;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  root.updateMatrixWorld(true);
  const dims = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return { root, dims };
}

function loadPhone(p) {
  if (modelCache.has(p.id)) return modelCache.get(p.id);
  const pr = (async () => {
    await loadScript(p.id);

    if (p.image) {
      const url = window.PHONE_IMAGES && window.PHONE_IMAGES[p.id];
      const tex = await new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
      tex.encoding = THREE.sRGBEncoding;
      const w = p.size_mm[0] * MM;
      const h = w * (tex.image.height / tex.image.width);
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.y = h / 2;
      const root = new THREE.Group();
      root.add(mesh);
      return finishRoot(root, { size_mm: [p.size_mm[0], h / MM, 0] });
    }
    const b64 = window.PHONE_MODELS && window.PHONE_MODELS[p.id];
    if (!b64) throw new Error(`no 3D for ${p.id}`);
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const gltf = await new Promise((res, rej) => loader.parse(buf.buffer, "", res, rej));
    return finishRoot(gltf.scene, p);
  })();
  pr.catch((err) => console.error(err));
  modelCache.set(p.id, pr);
  return pr;
}

async function loadCombo(p) {
  const ids = p.combo === "all"
    ? PHONES.filter((q) => !q.combo && !q.image).map((q) => q.id)
    : p.combo;
  let done = 0;
  const parts = await Promise.all(ids.map((id) => loadPhone(phoneById.get(id)).then((r) => {
    done++;
    loadingEl.textContent = `${ko("LOADING 3D", "3D 불러오는 중")} ${done} / ${ids.length}`;
    return r;
  })));
  loadingEl.textContent = "";
  const root = new THREE.Group();
  const dims = new THREE.Vector3();
  parts.forEach((r) => {
    const cl = r.root.clone(true);
    root.add(cl);
    dims.max(r.dims);
  });
  return { root, dims, members: ids.map((id) => phoneById.get(id)) };
}

function applyMode(it) {
  it.body.traverse((o) => {
    if (!o.isMesh) return;
    o.material = xrayMode ? it.xmat : o.__messy;
    o.castShadow = !xrayMode;
  });
}

let items = [];
let focusIdx = -1;

const seeded = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
const tagsEl = document.getElementById("tags");
const maxDim = (d) => Math.max(d.x, d.y, d.z);

async function loadParts(p) {
  if (p.combo) {
    const r = await loadCombo(p);
    return [{ root: r.root, dims: r.dims, phone: p, members: r.members }];
  }
  const ids = [p.id];
  if (p.with && phoneById.has(p.with) && p.with !== p.id) ids.push(p.with);
  let done = 0;
  const rs = await Promise.all(ids.map((id) => loadPhone(phoneById.get(id)).then((r) => {
    done++;
    if (loadingEl.textContent) loadingEl.textContent = `${ko("LOADING 3D", "3D 불러오는 중")} ${done} / ${ids.length}`;
    return r;
  })));
  return rs.map((r, k) => ({ root: r.root.clone(true), dims: r.dims, phone: phoneById.get(ids[k]) }));
}

let placeChain = Promise.resolve();
let placeGen = 0;
function placePhone(p, index) {
  const gen = placeGen;
  placeChain = placeChain.then(() => (gen === placeGen ? placePhoneNow(p, index, gen) : null)).catch(() => {});
  return placeChain;
}
async function placePhoneNow(p, index, gen) {
  const showLoad = setTimeout(() => { if (!loadingEl.textContent) loadingEl.textContent = ko("LOADING 3D…", "3D 불러오는 중…"); }, 120);
  let res;
  try {
    res = await loadParts(p);
  } catch (err) {
    clearTimeout(showLoad);
    loadingEl.textContent = ko("Could not load the 3D file", "3D 파일을 불러오지 못했습니다");
    return;
  }
  clearTimeout(showLoad);
  loadingEl.textContent = "";
  if (gen !== placeGen) return;

  const body = new THREE.Group();
  const parts = res.map((r, k) => {
    const model = r.root;
    model.position.y -= r.dims.y / 2;
    const spin = new THREE.Group();
    spin.add(model);
    const node = new THREE.Group();
    node.add(spin);
    body.add(node);
    return { node, spin, model, dims: r.dims, phone: r.phone, delay: k === 0 ? 0 : PARTNER_DELAY };
  });
  const rnd = (k) => seeded(index + 1, k) - 0.5;
  let jLocal = null;
  let jR = 0;
  if (parts.length === 2) {
    const A = parts[0].dims;
    const B = parts[1].dims;
    const side = rnd(0) > 0 ? 1 : -1;

    parts[1].node.position.set(
      side * (A.x + B.x) * (0.14 + 0.12 * (rnd(1) + 0.5)),
      rnd(2) * A.y * 0.5,
      rnd(3) * Math.max(A.z, B.z) * 0.8
    );
  }

  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const c = box.getCenter(new THREE.Vector3());
  parts.forEach((pt) => pt.node.position.sub(c));
  const dims = box.getSize(new THREE.Vector3());
  if (parts.length === 2) {
    jLocal = parts[0].node.position.clone().lerp(parts[1].node.position, 0.5);
    jR = 0.5 * Math.min(maxDim(parts[0].dims), maxDim(parts[1].dims));
  } else if (p.combo) {
    jLocal = new THREE.Vector3();
    jR = 0.35 * maxDim(dims);
  }

  const pivot = new THREE.Group();
  body.position.y = dims.y / 2;
  pivot.add(body);
  const group = new THREE.Group();
  group.add(pivot);

  const n = items.length;
  let cur;
  if (n === 0) cur = { x: 0, y: dims.y / 2, z: 0, rx: 0, ry: 0, rz: 0 };
  else {
    const pv = items[n - 1];
    const pg = pv.cur;
    const pd = pv.dims;
    const r = (k) => seeded(n + 1 + index * 0.37, k) - 0.5;
    cur = {
      x: pg.x + (pd.x + dims.x) * 0.3,
      y: Math.max(dims.y / 2, pg.y + r(1) * pd.y * 0.5),
      z: pg.z + r(2) * Math.max(pd.z, dims.z) * 0.8,
      rx: 0,
      ry: 0,
      rz: 0
    };
  }
  group.position.set(cur.x, cur.y - dims.y / 2, cur.z);
  body.rotation.set(cur.rx, cur.ry, cur.rz);
  scene.add(group);

  const members = res[0].members || parts.map((pt) => pt.phone);
  const w_g = res[0].members
    ? Math.max(...members.map((m) => m.weight_g || 0))
    : members.reduce((a, m) => a + (m.weight_g || 0), 0);
  const weight = w_g ? Math.min(1.8, w_g / 170) : Math.min(1.6, (dims.x * dims.y * dims.z) / 0.22);

  const tag = document.createElement("button");
  tag.type = "button";
  tag.className = "tag";
  tag.textContent = p.key;
  tag.dataset.item = String(items.length);
  tagsEl.appendChild(tag);

  const u = makeGraftUniforms();

  body.traverse((o) => { if (o.isMesh) o.__messy = makeMessy(o.material, u); });
  const it = { group, pivot, body, parts, p, index, cur, dims, born: performance.now(), weight, tag,
    members, u, jLocal, jR, center: new THREE.Vector3(cur.x, cur.y, cur.z),
    xmat: makeXrayMat(u),
    inflateMs: INFLATE_MS + weight * 420,
    reach: dims.length() * 1.15 };
  items.push(it);
  applyMode(it);

  freeScroll = false;
  focusOn(items.length - 1);
  Sound.appear(it);
}

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function animateItem(it, now) {
  const t = Math.max(0, now - it.born);
  const t1 = FLAT_MS;
  const t2 = t1 + it.inflateMs;
  const t3 = t2 + SETTLE_MS;
  const h = it.dims.y;
  let sink = 0;
  let lift = 0;
  const u = clamp01((t - t1) / it.inflateMs);
  it.parts.forEach((pt) => {
    const v = clamp01((u - pt.delay) / (1 - pt.delay));
    pt.spin.scale.set(1, 1, 0.015 + 0.985 * easeInOutSine(v));
  });
  if (t < t1) lift = h * 0.06;
  else if (t < t2) lift = h * 0.06 * (1 - Math.pow(u, 2.6));
  else if (t < t3) {
    const w = (t - t2) / SETTLE_MS;

    sink = 0.03 * it.weight * Math.min(1, w * 14) * Math.pow(1 - w, 2.4);
  }
  it.pivot.position.y = lift;
  it.pivot.scale.set(1 + sink * 0.3, 1 - sink, 1 + sink * 0.3);
}

const landAt = (it) => it.born + FLAT_MS + it.inflateMs;

function growRadius(it, now) {
  const u = (now - it.born) / (FLAT_MS + it.inflateMs * 0.9);
  if (u >= 1) return 1000;
  return it.reach * (1 - Math.pow(1 - Math.max(0, u), 2.2));
}

const mainLabel = document.getElementById("main-label");
let LANG = (() => { try { return localStorage.getItem("phone-lang") === "ko" ? "ko" : "en"; } catch (e) { return "en"; } })();
const ko = (en, k) => (LANG === "ko" ? k : en);
const nameOf = (m) => (LANG === "ko" && m.name_ko ? m.name_ko : m.name);
const noteOf = (m) => (LANG === "ko" && m.note_ko ? m.note_ko : m.note);
function showPrompt() { mainLabel.textContent = ko("TYPE A–Z", "A–Z 입력"); }
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-ko]").forEach((el) => {
    if (el.dataset.en === undefined) el.dataset.en = el.textContent;
    el.textContent = LANG === "ko" ? el.dataset.ko : el.dataset.en;
  });
  const btn = document.getElementById("lang-toggle");
  if (btn) {
    btn.textContent = LANG === "ko" ? "EN" : "KR";
    btn.setAttribute("aria-label", LANG === "ko" ? "English" : "한국어");
  }
  if (focusIdx >= 0 && items[focusIdx]) mainLabel.innerHTML = labelFor(items[focusIdx]);
  else showPrompt();
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const MAX_THICK = 90;
const MAX_WEIGHT = 800;
const bar = (v, max) => `<span class="thick-bar"><i style="width:${Math.min(100, (v / max) * 100).toFixed(0)}%"></i></span>`;

function labelFor(it) {
  const p = it.p;
  const ms = it.members.filter((m) => m.size_mm);
  let head = `<span class="lb-key">${esc(p.key)}</span>`;
  if (p.combo) head += esc(nameOf(p));
  else head += it.members.map((m) => esc(nameOf(m))).join(` <span class="lb-x">×</span> `);
  const years = [...new Set(it.members.map((m) => m.year))];
  head += `<span class="lb-year">${esc(years.length > 2 ? `${years[0]}–${years[years.length - 1]}` : years.join(" · "))}</span>`;
  const notes = it.members.filter((m) => m.note).map((m) => `${m.key}: ${noteOf(m)}`);
  if (notes.length && !p.combo) head += `<span class="lb-year">${esc(notes.join(" / "))}</span>`;
  let out = `<div class="lb-head">${head}</div>`;
  if (p.combo && it.members.length > 3) {
    out += `<div class="lb-dims">${ko(`${it.members.length} phones`, `${it.members.length}대`)} · ${it.members[0].year}–${it.members[it.members.length - 1].year}</div>`;
  }
  if (!ms.length) return out;
  if (ms.length <= 3) {
    out += ms.map((m) => `<div class="lb-dims">${esc(m.key)} ${ko("thickness", "두께")} <b>${m.size_mm[2]}</b> mm ${bar(m.size_mm[2], MAX_THICK)}` +
      (m.weight_g ? ` ${ko("weight", "무게")} <b>${m.weight_g}</b> g ${bar(m.weight_g, MAX_WEIGHT)}` : "") + `</div>`).join("");
    return out + `<div class="lb-dims"><span class="lb-note">${ko("(approximate)", "(대략값)")}</span></div>`;
  }
  const thick = ms.reduce((a, m) => (m.size_mm[2] > a.size_mm[2] ? m : a));
  const thin = ms.reduce((a, m) => (m.size_mm[2] < a.size_mm[2] ? m : a));
  return out + `<div class="lb-dims">${ko("thickest", "가장 두꺼움")} ${esc(nameOf(thick))} <b>${thick.size_mm[2]}</b> mm ${bar(thick.size_mm[2], MAX_THICK)}` +
    `  ${ko("thinnest", "가장 얇음")} ${esc(nameOf(thin))} <b>${thin.size_mm[2]}</b> mm ${bar(thin.size_mm[2], MAX_THICK)}</div>`;
}

function focusOn(i, pan = true) {
  if (i < 0 || i >= items.length) return;
  focusIdx = i;
  items.forEach((it, k) => it.tag.classList.toggle("is-focus", k === i));
  mainLabel.innerHTML = labelFor(items[i]);
  if (pan) freeScroll = false;
}

let xrayMode = false;
const xrayBtn = document.getElementById("xray-toggle");
function setXray(on) {
  xrayMode = on;
  document.body.classList.toggle("xray-mode", on);
  xrayBtn.setAttribute("aria-pressed", String(on));
  items.forEach((it) => applyMode(it));
  floor.visible = !on;
  Sound.shutter(on);
}
xrayBtn.addEventListener("click", (e) => { e.stopPropagation(); setXray(!xrayMode); keyCapture.focus(); });

let freeScroll = false;
let viewTheta = VIEW_THETA;
let viewThetaGoal = VIEW_THETA;
let viewPhi = VIEW_PHI;
let viewPhiGoal = VIEW_PHI;
const lerp = (a, b, t) => a + (b - a) * t;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
function frame() {
  const now = performance.now();
  xrayTime.value = now / 1000;
  xrayGrainPx.value = renderer.getPixelRatio() * 1.15;

  items.forEach((it) => {
    animateItem(it, now);
    it.group.updateMatrixWorld(true);
    it.body.getWorldPosition(it.center);
  });

  items.forEach((it, i) => {
    const u = it.u;
    const prev = items[i - 1];
    const next = items[i + 1];
    if (prev) {
      u.uJ0.value.copy(it.center).lerp(prev.center, 0.5);
      u.uJR0.value = 0.42 * Math.min(maxDim(it.dims), maxDim(prev.dims));
    } else {
      u.uJ0.value.copy(it.center);
      u.uJR0.value = 0;
    }
    if (next) {
      u.uJ1.value.copy(it.center).lerp(next.center, 0.5);
      u.uJR1.value = 0.42 * Math.min(maxDim(it.dims), maxDim(next.dims));
    } else u.uJR1.value = 0;
    if (it.jLocal) {
      u.uJ2.value.copy(it.jLocal);
      it.body.localToWorld(u.uJ2.value);
      u.uJR2.value = it.jR;
    } else u.uJR2.value = 0;

    u.uGrowC.value.copy(prev ? u.uJ0.value : (it.jLocal ? u.uJ2.value : it.center));
    u.uGrowR.value = growRadius(it, now);
  });

  const fIt = focusIdx >= 0 ? items[focusIdx] : null;
  if (fIt && !freeScroll) camXGoal = fIt.center.x;
  camX += (camXGoal - camX) * 0.07;
  viewTheta += (viewThetaGoal - viewTheta) * 0.16;
  viewPhi += (viewPhiGoal - viewPhi) * 0.16;
  const fd = fIt ? fIt.dims : null;

  const narrow = Math.min(1, camera.aspect);
  const goalDist = (fd ? Math.max(fd.y, (fd.x * 0.9) / narrow, fd.z) * 2.9 + 0.9 : 3.4) * DIST_K * zoomK;
  camDist += (goalDist - camDist) * 0.07;
  camTarget.x = camX;
  camTarget.y += ((fIt ? fIt.center.y : 0.5) - camTarget.y) * 0.07;
  camTarget.z += ((fIt ? fIt.center.z : 0) - camTarget.z) * 0.07;

  let dip = 0;
  if (fIt) {
    const s = now - landAt(fIt);
    if (s > 0 && s < 900) dip = 0.005 * fIt.weight * Math.exp(-s / 220) * (2 * camDist * Math.tan((FOV * Math.PI) / 360));
  }
  camera.position.set(
    camTarget.x + camDist * Math.sin(viewPhi) * Math.sin(viewTheta),
    camTarget.y - dip + camDist * Math.cos(viewPhi),
    camTarget.z + camDist * Math.sin(viewPhi) * Math.cos(viewTheta)
  );
  camera.up.set(0, 1, 0);
  tmpA.set(camTarget.x, camTarget.y - dip, camTarget.z);
  camera.lookAt(tmpA);
  key.position.set(camX + 2.2, 4, 3);
  key.target.position.set(camX, 0, 0);

  floor.material.opacity = 0.16 * THREE.MathUtils.smoothstep(Math.abs(Math.PI / 2 - viewPhi), 0.04, 0.25);

  renderer.render(scene, camera);
  placeTags();
  requestAnimationFrame(frame);
}

const tmpV = new THREE.Vector3();
function placeTags() {
  items.forEach((it) => {
    tmpV.set(it.cur.x, it.cur.y - it.dims.y / 2 - 0.08, it.cur.z).project(camera);
    const sx = (tmpV.x * 0.5 + 0.5) * viewW();
    const sy = (-tmpV.y * 0.5 + 0.5) * viewH();
    it.tag.style.left = `${sx}px`;
    it.tag.style.top = `${sy}px`;
    it.tag.style.display = tmpV.z < 1 && sx > -60 && sx < viewW() + 60 ? "" : "none";
  });
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  camera.aspect = viewW() / viewH();
  camera.updateProjectionMatrix();
  renderer.setSize(viewW(), viewH());
});

function nearestItem() {
  let best = -1;
  let bd = Infinity;
  items.forEach((it, i) => {
    const d = Math.abs(it.cur.x - camXGoal);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function clampCam() {
  if (!items.length) return;
  const xs = items.map((it) => it.cur.x);
  camXGoal = Math.max(Math.min(...xs) - 0.8, Math.min(Math.max(...xs) + 0.8, camXGoal));
}
function browse() {
  const i = nearestItem();
  if (i >= 0 && i !== focusIdx) focusOn(i, false);
}
let snapTimer = null;
function snapSoon(ms = 260) {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const i = nearestItem();
    if (i >= 0) focusOn(i);
  }, ms);
}

const pxToWorld = () => (2 * camDist * Math.tan((camera.fov * Math.PI) / 360)) / viewH();

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    zoomK = Math.max(0.35, Math.min(4, zoomK * (1 + e.deltaY * 0.01)));
    return;
  }
  const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerWidth : 1;
  const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!freeScroll) camXGoal = camX;
  freeScroll = true;
  camXGoal += d * unit * pxToWorld();
  clampCam();
  browse();
  snapSoon();
}, { passive: false });

let dragging = false;
let dragX = 0;
let dragY = 0;
const activePointers = new Set();
stage.addEventListener("pointerdown", (e) => {
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) { endDrag(); return; }
  dragging = true;
  dragX = e.clientX;
  dragY = e.clientY;
  stage.classList.add("dragging");
  stage.setPointerCapture(e.pointerId);
  keyCapture.focus();
  Sound.init();
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging || activePointers.size > 1) return;
  const dx = e.clientX - dragX;
  const dy = e.clientY - dragY;
  dragX = e.clientX;
  dragY = e.clientY;
  viewThetaGoal -= dx * 0.008;
  viewPhiGoal = Math.max(0.03, Math.min(Math.PI - 0.03, viewPhiGoal - dy * 0.008));
});
function endDrag() {
  dragging = false;
  stage.classList.remove("dragging");
}
stage.addEventListener("pointerup", (e) => { activePointers.delete(e.pointerId); endDrag(); });
stage.addEventListener("pointercancel", (e) => { activePointers.delete(e.pointerId); endDrag(); });
let pinchD0 = 0;
let pinchK0 = 1;
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
stage.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) { pinchD0 = touchDist(e.touches); pinchK0 = zoomK; }
}, { passive: true });
stage.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && pinchD0) zoomK = Math.max(0.35, Math.min(4, pinchK0 * (pinchD0 / touchDist(e.touches))));
}, { passive: true });
stage.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinchD0 = 0; });
stage.addEventListener("dblclick", () => {
  viewThetaGoal = VIEW_THETA + Math.round((viewThetaGoal - VIEW_THETA) / (Math.PI * 2)) * Math.PI * 2;
  viewPhiGoal = VIEW_PHI;
});

tagsEl.addEventListener("click", (e) => {
  const t = e.target.closest(".tag");
  if (!t) return;
  e.stopPropagation();
  focusOn(Number(t.dataset.item));
  keyCapture.focus();
});

const Sound = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = true;
  function init() {
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch (e) {}
    if (ctx) { if (ctx.state !== "running" && ctx.state !== "closed") ctx.resume(); return ctx; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 240;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.045, ctx.currentTime, 1.5);
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return ctx;
  }
  function burst(t, freq, q, dur, gain, type = "bandpass") {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(e); e.connect(master);
    s.start(t, Math.random() * 0.5, dur + 0.05);
  }
  function tone(t, freq, dur, gain, drop = 1, type = "sine") {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function appear(it) {
    if (!init()) return;
    const t0 = ctx.currentTime + 0.02;

    burst(t0, 380, 0.8, 0.09, 0.08, "lowpass");

    const inflate = ctx.createBufferSource(); inflate.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.9;
    const ta = t0 + FLAT_MS / 1000;
    const tb = ta + it.inflateMs / 1000;
    f.frequency.setValueAtTime(180, ta);
    f.frequency.exponentialRampToValueAtTime(900 / (0.6 + it.weight * 0.5), tb);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, ta);
    e.gain.exponentialRampToValueAtTime(0.08, tb - 0.1);
    e.gain.exponentialRampToValueAtTime(0.0001, tb);
    inflate.connect(f); f.connect(e); e.connect(master);
    inflate.loop = true;
    inflate.start(ta, 0, it.inflateMs / 1000 + 0.1);
    const tr = tb;

    tone(tr, 72 / (0.6 + it.weight * 0.35), 0.55, 0.34 + it.weight * 0.12, 0.6);
    burst(tr, 260, 0.9, 0.22, 0.26, "lowpass");

    const tv = tr + 0.35;
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 110;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
    const ve = ctx.createGain();
    ve.gain.setValueAtTime(0.0001, tv);
    ve.gain.exponentialRampToValueAtTime(0.09, tv + 0.02);
    ve.gain.setValueAtTime(0.09, tv + 0.16);
    ve.gain.exponentialRampToValueAtTime(0.0001, tv + 0.22);
    o.connect(lp); lp.connect(ve); ve.connect(master); o.start(tv); o.stop(tv + 0.25);
  }
  function shutter(on) {
    if (!init()) return;
    const t = ctx.currentTime + 0.01;
    burst(t, on ? 1500 : 1100, 2, 0.05, 0.22);
    tone(t, on ? 95 : 80, 0.1, 0.1);
  }
  function setEnabled(on) {
    enabled = on;
    if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
  }
  return { init, appear, shutter, setEnabled, get enabled() { return enabled; } };
})();

const keyCapture = document.getElementById("key-capture");
const typedDisplay = document.getElementById("typed-display");
let typed = [];

function typeKey(raw) {
  const k = raw.toUpperCase();
  if (!keyIndex.has(k)) {
    return;
    return;
  }
  const index = keyIndex.get(k);
  typed.push(k);
  typedDisplay.textContent = typed.join("");
  typedDisplay.scrollLeft = typedDisplay.scrollWidth;
  placePhone(PHONES[index], index);
}

function undoLast() {
  if (!typed.length) return;
  typed.pop();
  typedDisplay.textContent = typed.join("");
  const gen = placeGen;
  placeChain = placeChain.then(() => {
    if (gen !== placeGen || !items.length) return;
    const it = items.pop();
    scene.remove(it.group);
    it.tag.remove();
    it.xmat.dispose();
    it.body.traverse((o) => { if (o.isMesh && o.__messy) o.__messy.dispose(); });
    freeScroll = false;
    if (!items.length) { focusIdx = -1; camXGoal = 0; showPrompt(); return; }
    focusOn(items.length - 1);
  });
}

function clearAll() {
  placeGen++;
  items.forEach((it) => {
    scene.remove(it.group);
    it.tag.remove();
    it.xmat.dispose();
    it.body.traverse((o) => { if (o.isMesh && o.__messy) o.__messy.dispose(); });
  });
  items = [];
  focusIdx = -1;
  camXGoal = 0;
  freeScroll = false;
  typed = [];
  typedDisplay.textContent = "";
  showPrompt();
}

function letterOf(e) {
  if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toUpperCase();
  return null;
}

function handleKeydown(e) {
  Sound.init();
  if (e.key === "Tab") { e.preventDefault(); setXray(!xrayMode); return; }
  if (e.key === "Escape") { e.preventDefault(); clearAll(); return; }
  if (e.key === "Backspace") { e.preventDefault(); undoLast(); return; }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    if (!items.length) return;
    const cur = focusIdx < 0 ? items.length - 1 : focusIdx;
    const next = Math.max(0, Math.min(items.length - 1, cur + (e.key === "ArrowLeft" ? -1 : 1)));
    focusOn(next);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const L = letterOf(e);
  if (!L) return;
  e.preventDefault();
  typeKey(L);
}
keyCapture.addEventListener("keydown", handleKeydown);
keyCapture.addEventListener("input", () => { keyCapture.value = ""; });
keyCapture.addEventListener("compositionend", () => { keyCapture.value = ""; });
window.addEventListener("keydown", (e) => {
  if (document.activeElement === keyCapture) return;
  keyCapture.focus();
  handleKeydown(e);
});
document.body.addEventListener("click", () => keyCapture.focus());
document.getElementById("clear-btn").addEventListener("click", (e) => { e.stopPropagation(); clearAll(); keyCapture.focus(); });
const langBtn = document.getElementById("lang-toggle");
if (langBtn) langBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  LANG = LANG === "ko" ? "en" : "ko";
  try { localStorage.setItem("phone-lang", LANG); } catch (err) {}
  applyLang();
  keyCapture.focus();
});
applyLang();
const soundBtn = document.getElementById("sound-toggle");
if (soundBtn) soundBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  Sound.init();
  Sound.setEnabled(!Sound.enabled);
  soundBtn.setAttribute("aria-pressed", String(Sound.enabled));
  keyCapture.focus();
});

(async () => {
  for (const p of PHONES) {
    if (p.combo) continue;
    try { await loadPhone(p); } catch (e) {  }
    await new Promise((r) => setTimeout(r, 30));
  }
})();