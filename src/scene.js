// 3D 放映厅：放映间里的放映机 → 光束 → 观众席 → 银幕。
// 坐标单位为米；放映机镜头朝 -Z，银幕在 z = SCREEN.z。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const SCREEN = { x: 0, y: 1.25, z: -30, w: 13.6, h: 7.65 };
const LENS = new THREE.Vector3(0.05, 1.2, -0.66);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

export function createTheater(container, { lowPower }) {
  const renderer = new THREE.WebGLRenderer({ antialias: !lowPower, powerPreference: "high-performance" });
  const maxRatio = Math.min(devicePixelRatio, lowPower ? 1.5 : 2);
  let pixelRatio = maxRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  RectAreaLightUniformsLib.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040302);
  scene.fog = new THREE.FogExp2(0x040302, 0.022);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.16;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 120);

  /* ---------------- 灯光 ---------------- */

  scene.add(new THREE.HemisphereLight(0x3a302a, 0x050403, 0.35));

  // 放映间的工作灯：从右上方打在放映机上
  const work = new THREE.SpotLight(0xffc98f, 40, 9, 0.6, 0.85, 1.6);
  work.position.set(-1.8, 3.3, 1.4);
  work.target.position.set(0, 1.1, -0.1);
  work.castShadow = !lowPower;
  work.shadow.mapSize.set(1024, 1024);
  work.shadow.bias = -0.0004;
  scene.add(work, work.target);

  // 冷色轮廓光，让机身从黑暗里分出来
  const rim = new THREE.DirectionalLight(0x8ea4c8, 0.55);
  rim.position.set(3, 2.5, -5);
  scene.add(rim);

  // 银幕反光：颜色取当前影片封面的平均色，照亮座椅、幕布和放映机正面
  const screenLight = new THREE.RectAreaLight(0xffffff, 0, SCREEN.w, SCREEN.h);
  screenLight.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.05);
  screenLight.lookAt(0, SCREEN.y, 0);
  scene.add(screenLight);

  // 镜头口的灯光
  const lensLight = new THREE.PointLight(0xffd9a0, 0, 2.2, 2);
  lensLight.position.copy(LENS).add(new THREE.Vector3(0, 0, -0.08));
  scene.add(lensLight);

  /* ---------------- 放映厅 ---------------- */

  const dark = new THREE.MeshStandardMaterial({ color: 0x0f0c0a, roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.9 });

  // 放映间地面与前方矮墙
  const boothFloor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 5), dark);
  boothFloor.position.set(0, -0.1, 0.8);
  boothFloor.receiveShadow = true;
  // 放映间前沿：矮墙 + 黄铜栏杆，能越过它看到观众席
  const parapet = new THREE.Mesh(new RoundedBoxGeometry(8, 0.42, 0.28, 3, 0.04), wallMat);
  parapet.position.set(0, 0.21, -1.55);
  parapet.receiveShadow = true;
  scene.add(boothFloor, parapet);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9a7a45, metalness: 1, roughness: 0.35 });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 8, 16).rotateZ(Math.PI / 2), railMat);
  rail.position.set(0, 0.98, -1.55);
  scene.add(rail);
  for (let i = -4; i <= 4; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.56, 10), railMat);
    post.position.set(i * 0.95, 0.7, -1.55);
    scene.add(post);
  }

  // 观众席：阶梯地面 + 座椅（InstancedMesh）
  const ROWS = 11;
  const PER_SIDE = 8;
  const seatGeo = (() => {
    const back = new RoundedBoxGeometry(0.5, 0.62, 0.1, 2, 0.04);
    back.rotateX(-0.12);
    back.translate(0, 0.78, 0.22);
    const cushion = new RoundedBoxGeometry(0.5, 0.12, 0.46, 2, 0.04);
    cushion.translate(0, 0.42, 0);
    const armL = new THREE.BoxGeometry(0.05, 0.42, 0.5);
    armL.translate(-0.28, 0.42, 0.02);
    const armR = armL.clone();
    armR.translate(0.56, 0, 0);
    return mergeGeometries([back, cushion, armL, armR].map((g) => (g.index ? g.toNonIndexed() : g)));
  })();
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x7a1c1f, roughness: 0.8 });
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, ROWS * PER_SIDE * 2);
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 0.9 });
  const m = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    const z = -24 + r * 1.85;
    const y = -4.2 + r * 0.34;
    const step = new THREE.Mesh(new THREE.BoxGeometry(20, 0.34, 1.85), stepMat);
    step.position.set(0, y - 0.17, z + 0.1);
    step.receiveShadow = true;
    scene.add(step);
    for (let s = 0; s < PER_SIDE * 2; s++) {
      const side = s < PER_SIDE ? -1 : 1;
      const k = s % PER_SIDE;
      const x = side * (1.0 + k * 0.6) + (r % 2) * 0.15;
      m.makeTranslation(x, y, z);
      seats.setMatrixAt(n++, m);
    }
  }
  scene.add(seats);
  const frontFloor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.2, 8), stepMat);
  frontFloor.position.set(0, -4.5, -29);
  scene.add(frontFloor);

  // 侧墙与天花
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(36, 16), wallMat);
    wall.position.set(side * 11, 2, -14);
    wall.rotation.y = -side * Math.PI / 2;
    scene.add(wall);
    // 墙面竖向装饰板
    for (let i = 0; i < 9; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 9, 1.6), wallMat);
      panel.position.set(side * 10.95, 1.5, -28 + i * 3.6);
      scene.add(panel);
    }
  }

  // 银幕：黑色遮幅框 + 两侧丝绒幕布
  const masking = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w + 3, SCREEN.h + 2), new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 1 }));
  masking.position.set(SCREEN.x, SCREEN.y, SCREEN.z - 0.05);
  scene.add(masking);
  const curtainGeo = new THREE.PlaneGeometry(3.4, 12, 80, 1);
  const cp = curtainGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 9) * 0.12 + Math.sin(cp.getX(i) * 23) * 0.03);
  curtainGeo.computeVertexNormals();
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x6b1418, roughness: 0.85, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const c = new THREE.Mesh(curtainGeo, curtainMat);
    c.position.set(side * (SCREEN.w / 2 + 1.9), SCREEN.y + 0.8, SCREEN.z + 0.4);
    scene.add(c);
  }

  // 银幕画面：画在 canvas 上（封面 / 倒计时片头），按画幅留黑边
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = lowPower ? 1024 : 1600;
  screenCanvas.height = lowPower ? 576 : 900;
  const sctx = screenCanvas.getContext("2d");
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 4;
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, color: 0x000000, toneMapped: false, fog: false });
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screenMat);
  screenMesh.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
  scene.add(screenMesh);

  // 影片层：mp4 直接投放时，视频画面贴在这块和画面区域等大的平面上
  const filmMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false }); // 不受雾影响，保持原片亮度
  const filmMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), filmMat);
  filmMesh.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.02);
  filmMesh.visible = false;
  scene.add(filmMesh);

  /* ---------------- 放映机 ---------------- */

  const projector = buildProjector(lowPower);
  scene.add(projector.group);

  /* ---------------- 光束与灰尘 ---------------- */

  // 光束是从镜头点到画面四角的棱锥；四角随画幅（横 / 竖）变化
  const beamUniforms = {
    uLens: { value: LENS.clone() },
    uC: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uLevel: { value: 0 },
    uTime: { value: 0 },
    uGain: { value: lowPower ? 1.7 : 1 }, // 手机上没有泛光，光束补亮一些
  };
  const pyramidPos = (u, v, t) => [u, v, t]; // 实际位置在着色器里由 uLens / uC 计算
  const beamGeo = new THREE.BufferGeometry();
  {
    // 每个侧面：顶点(镜头) + 两个角；aUVT = (画面 u, 画面 v, 沿光束 t)，aS = 侧面横向坐标
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const uvt = [];
    const s = [];
    for (let f = 0; f < 4; f++) {
      const a = corners[f];
      const b = corners[(f + 1) % 4];
      uvt.push(...pyramidPos(0.5, 0.5, 0), ...pyramidPos(a[0], a[1], 1), ...pyramidPos(b[0], b[1], 1));
      s.push(0.5, 0, 1);
    }
    beamGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Array(36).fill(0), 3));
    beamGeo.setAttribute("aUVT", new THREE.Float32BufferAttribute(uvt, 3));
    beamGeo.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1));
  }
  const pyramidGLSL = /* glsl */ `
    uniform vec3 uLens;
    uniform vec3 uC[4];
    vec3 pyramid(vec3 uvt) {
      vec3 bottom = mix(uC[0], uC[1], uvt.x);
      vec3 top = mix(uC[3], uC[2], uvt.x);
      vec3 onScreen = mix(bottom, top, uvt.y);
      return mix(uLens, onScreen, uvt.z);
    }
  `;
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${pyramidGLSL}
      attribute vec3 aUVT;
      attribute float aS;
      varying float vT;
      varying float vS;
      varying vec3 vWorld;
      void main() {
        vT = aUVT.z;
        vS = aS;
        vec4 w = modelMatrix * vec4(pyramid(aUVT), 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      uniform float uTime;
      uniform float uGain;
      varying float vT;
      varying float vS;
      varying vec3 vWorld;
      void main() {
        float t = max(vT, 0.0005);
        float s = (vS - 0.5) / t + 0.5;              // 侧面横向位置，消除向顶点收拢的影响
        float edge = smoothstep(0.0, 0.22, s) * smoothstep(1.0, 0.78, s);
        float along = smoothstep(0.0, 0.025, vT) * (1.0 - 0.6 * vT);
        float rays = 0.78 + 0.22 * sin(s * 41.0 + uTime * 0.35) * sin(s * 17.0 - uTime * 0.22);
        float flicker = 0.93 + 0.07 * sin(uTime * 47.0) * sin(uTime * 13.0);
        float a = uLevel * edge * along * rays * flicker * 0.1 * uGain;
        gl_FragColor = vec4(1.0, 0.9, 0.74, a); // AdditiveBlending 会再乘一次 alpha
      }
    `,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 2;
  scene.add(beam);

  const DUST = lowPower ? 900 : 3200;
  const dustGeo = new THREE.BufferGeometry();
  {
    const uvt = new Float32Array(DUST * 3);
    const seed = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      uvt[i * 3] = Math.random();
      uvt[i * 3 + 1] = Math.random();
      uvt[i * 3 + 2] = 0.03 + 0.97 * Math.cbrt(Math.random()); // 按棱锥体积均匀分布
      seed[i] = Math.random();
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
    dustGeo.setAttribute("aUVT", new THREE.BufferAttribute(uvt, 3));
    dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  }
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { ...beamUniforms, uScale: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${pyramidGLSL}
      uniform float uTime;
      uniform float uLevel;
      uniform float uScale;
      attribute vec3 aUVT;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec3 uvt = aUVT;
        // 缓慢漂浮：在画面坐标里游走，始终留在光束内
        uvt.x = fract(uvt.x + sin(uTime * 0.05 + aSeed * 31.0) * 0.04 + uTime * 0.004 * (aSeed - 0.5));
        uvt.y = fract(uvt.y + uTime * 0.006 * (0.4 + aSeed) + sin(uTime * 0.11 + aSeed * 17.0) * 0.02);
        vec3 p = pyramid(uvt);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uScale * (1.5 + aSeed * 3.5) * (7.0 / -mv.z), uScale * 7.0);
        float edge = smoothstep(0.0, 0.18, uvt.x) * smoothstep(1.0, 0.82, uvt.x) * smoothstep(0.0, 0.18, uvt.y) * smoothstep(1.0, 0.82, uvt.y);
        float twinkle = 0.45 + 0.55 * sin(uTime * (0.8 + aSeed * 2.4) + aSeed * 60.0);
        vA = uLevel * edge * twinkle * (1.0 - 0.55 * uvt.z);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(1.0, 0.93, 0.8, a);
      }
    `,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  /* ---------------- 后期：泛光（手机上省掉，直接渲染） ---------------- */

  let composer = null;
  const BLOOM = 0.5; // 放映间里的泛光强度；影片在银幕上走时降到 0，避免亮画面蒙上一层白雾
  let bloom = null;
  if (!lowPower) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM, 0.6, 0.88);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  // 后期管线会对整帧做 ACES 色调映射，白色会被压灰、偏冷；
  // 影片在银幕上走、泛光已经关掉时直接渲染，影片层（toneMapped: false）就能保持原片颜色
  const draw = () => (composer && bloom.enabled ? composer.render() : renderer.render(scene, camera));

  /* ---------------- 状态 ---------------- */

  const state = {
    lamp: 0, // 0 关灯，0.55 待机预映，1 正式放映
    lampTarget: 0,
    reelSpeed: 0,
    reelTarget: 0,
    aspect: 16 / 9,
    image: null,
    title: "",
    video: null, // 正在投放的 <video>（mp4 直接投到银幕上）
    rolling: false, // 倒计时结束、影片正在银幕上走
    sampleAt: 0,
    countdown: null, // { start }
    flash: 0,
    hover: false,
    calm: 1, // 到达银幕后把光束和灰尘收淡，避免干扰观看
    calmTarget: 1,
  };

  // 画面区域（世界坐标）：按影片宽高比放进 16:9 的银幕，居中
  const imageRect = (aspect = state.aspect) => {
    let h = SCREEN.h;
    let w = h * aspect;
    if (w > SCREEN.w) {
      w = SCREEN.w;
      h = w / aspect;
    }
    return { x: SCREEN.x, y: SCREEN.y, z: SCREEN.z + 0.01, w, h };
  };

  const setBeamShape = () => {
    const r = imageRect();
    const c = beamUniforms.uC.value;
    c[0].set(r.x - r.w / 2, r.y - r.h / 2, r.z);
    c[1].set(r.x + r.w / 2, r.y - r.h / 2, r.z);
    c[2].set(r.x + r.w / 2, r.y + r.h / 2, r.z);
    c[3].set(r.x - r.w / 2, r.y + r.h / 2, r.z);
    screenLight.width = r.w;
    screenLight.height = r.h;
    filmMesh.scale.set(r.w, r.h, 1);
  };

  const canvasRegion = () => {
    const CW = screenCanvas.width;
    const CH = screenCanvas.height;
    let h = CH;
    let w = h * state.aspect;
    if (w > CW) {
      w = CW;
      h = w / state.aspect;
    }
    return { x: (CW - w) / 2, y: (CH - h) / 2, w, h };
  };

  // 没有封面时的片名卡
  const drawTitleCard = (r) => {
    const g = sctx.createRadialGradient(r.x + r.w / 2, r.y + r.h * 0.45, 0, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75);
    g.addColorStop(0, "#3a3127");
    g.addColorStop(1, "#0e0b09");
    sctx.fillStyle = g;
    sctx.fillRect(r.x, r.y, r.w, r.h);
    sctx.strokeStyle = "rgba(233,178,76,.5)";
    sctx.lineWidth = Math.max(2, r.w * 0.004);
    const m = Math.min(r.w, r.h) * 0.06;
    sctx.strokeRect(r.x + m, r.y + m, r.w - m * 2, r.h - m * 2);
    let size = Math.min(r.w, r.h) * 0.11;
    sctx.font = `600 ${size}px "Songti SC", "Noto Serif SC", serif`;
    while (sctx.measureText(state.title).width > r.w * 0.8 && size > 12) {
      size *= 0.9;
      sctx.font = `600 ${size}px "Songti SC", "Noto Serif SC", serif`;
    }
    sctx.fillStyle = "rgba(245,238,226,.92)";
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.fillText(state.title, r.x + r.w / 2, r.y + r.h / 2);
  };

  const drawPoster = () => {
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    const img = state.image;
    const r = canvasRegion();
    if (!img) {
      drawTitleCard(r);
      screenTex.needsUpdate = true;
      return;
    }
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    const scale = Math.max(r.w / iw, r.h / ih);
    const w = iw * scale;
    const h = ih * scale;
    sctx.save();
    sctx.beginPath();
    sctx.rect(r.x, r.y, r.w, r.h);
    sctx.clip();
    sctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
    sctx.restore();
    screenTex.needsUpdate = true;
  };

  // 学院派倒计时片头：灰底、圆环、扫针、十字线、数字
  const drawCountdown = (elapsed) => {
    const r = canvasRegion();
    const sec = elapsed / 0.6;
    const num = Math.max(1, 3 - Math.floor(sec));
    const frac = sec % 1;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const R = Math.min(r.w, r.h) * 0.36;
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    const g = sctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.max(r.w, r.h) * 0.7);
    g.addColorStop(0, "#8d8478");
    g.addColorStop(1, "#2b2620");
    sctx.fillStyle = g;
    sctx.fillRect(r.x, r.y, r.w, r.h);
    sctx.fillStyle = "rgba(20,18,15,.35)";
    sctx.beginPath();
    sctx.moveTo(cx, cy);
    sctx.arc(cx, cy, R * 1.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    sctx.closePath();
    sctx.fill();
    sctx.strokeStyle = "rgba(240,232,220,.85)";
    sctx.lineWidth = 6;
    for (const k of [1, 0.84]) {
      sctx.beginPath();
      sctx.arc(cx, cy, R * k, 0, Math.PI * 2);
      sctx.stroke();
    }
    sctx.lineWidth = 3;
    sctx.beginPath();
    sctx.moveTo(r.x, cy);
    sctx.lineTo(r.x + r.w, cy);
    sctx.moveTo(cx, r.y);
    sctx.lineTo(cx, r.y + r.h);
    sctx.stroke();
    sctx.fillStyle = "rgba(245,238,226,.95)";
    sctx.font = `600 ${Math.round(R * 1.05)}px "Songti SC", "Noto Serif SC", serif`;
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.fillText(String(num), cx, cy + R * 0.04);
    // 胶片划痕与颗粒
    sctx.fillStyle = "rgba(255,255,255,.08)";
    for (let i = 0; i < 3; i++) sctx.fillRect(r.x + Math.random() * r.w, r.y, 1.5, r.h);
    screenTex.needsUpdate = true;
  };

  const sampler = document.createElement("canvas");
  sampler.width = sampler.height = 8;
  const sctx8 = sampler.getContext("2d", { willReadFrequently: true });
  const averageColor = (img) => {
    if (!img) return new THREE.Color(0xd9b98a);
    sctx8.drawImage(img, 0, 0, 8, 8);
    const d = sctx8.getImageData(0, 0, 8, 8).data;
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
    const col = new THREE.Color(rr / 64 / 255, gg / 64 / 255, bb / 64 / 255);
    const hsl = {};
    col.getHSL(hsl);
    return col.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), 0.55);
  };

  /* ---------------- 镜头 ---------------- */

  const pose = {
    booth: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
    screen: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
  };
  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fly: null, mode: "booth", booth: 1 };
  let viewW = 1;
  let viewH = 1;
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();

  const layout = () => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    viewW = W;
    viewH = H;
    const aspect = W / H;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 58 : aspect < 1.25 ? 48 : 38;
    camera.updateProjectionMatrix();
    cam.booth = -1; // 下一帧按新尺寸重设视锥偏移
    renderer.setSize(W, H);
    composer?.setSize(W, H);
    bloom?.resolution.set(W / 2, H / 2);
    idleFrames = 0;
    // 放映间机位：放映机斜后方，越过机身看向银幕；窄屏退后一些
    const narrow = clamp01((1.4 - aspect) / 0.9);
    pose.booth.pos.set(-1.4 - narrow * 0.4, 1.72 + narrow * 0.55, 3.2 + narrow * 2.8);
    pose.booth.look.set(0.5 + narrow * 0.35, 1.3 - narrow * 0.7, -8);
    // 银幕机位：正对画面，留出边距
    const r = imageRect();
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(r.h / 0.84, r.w / (0.94 * aspect)) / (2 * tan);
    pose.screen.pos.set(r.x, r.y, r.z + d);
    pose.screen.look.set(r.x, r.y, r.z);
    dustMat.uniforms.uScale.value = H / 800 * renderer.getPixelRatio();
    if (!cam.fly) {
      const p = pose[cam.mode];
      cam.pos.copy(p.pos);
      cam.look.copy(p.look);
    }
  };

  // 沿光束推进：放映间 → 镜头旁 → 观众席上空 → 银幕前
  const flyTo = (mode, duration, via) => {
    const from = { pos: camera.position.clone(), look: cam.look.clone() };
    const to = pose[mode];
    const pts = via
      ? [from.pos, ...via, to.pos]
      : mode === "screen"
        ? [from.pos, new THREE.Vector3(-0.38, 1.48, -1.0), new THREE.Vector3(0.1, 1.35, -12), to.pos]
        : [from.pos, new THREE.Vector3(0.1, 1.5, -10), new THREE.Vector3(-0.7, 1.75, -0.4), to.pos];
    idleFrames = 0;
    cam.fly = { curve: new THREE.CatmullRomCurve3(pts, false, "centripetal"), from, to, mode, fromMode: cam.mode, start: performance.now(), duration };
  };

  /* ---------------- 交互：放映机 / 银幕 的悬停与点击 ---------------- */

  const raycaster = new THREE.Raycaster();
  const hitTest = (ndc) => {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([projector.group, screenMesh], true);
    if (!hits.length) return null;
    return hits[0].object === screenMesh ? "screen" : "projector";
  };

  /* ---------------- 声音：机械走片声（只在开机推进时响一下） ---------------- */

  let audio = null;
  const clatter = (seconds) => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audio;
      const now = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(0.16, now + 0.15);
      out.gain.setValueAtTime(0.16, now + seconds - 0.6);
      out.gain.linearRampToValueAtTime(0, now + seconds);
      out.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.012);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 0.8;
      bp.connect(out);
      for (let t = 0; t < seconds; t += 1 / 24) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.9 + Math.random() * 0.25;
        const g = ctx.createGain();
        g.gain.value = 0.55 + Math.random() * 0.45;
        src.connect(g).connect(bp);
        src.start(now + t);
      }
      const hum = ctx.createOscillator();
      hum.frequency.value = 58;
      const hg = ctx.createGain();
      hg.gain.value = 0.18;
      hum.connect(hg).connect(out);
      hum.start(now);
      hum.stop(now + seconds);
    } catch { /* 没有声音也不影响 */ }
  };

  /* ---------------- 主循环 ---------------- */

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let onArrive = null;
  let arrived = null;
  let running = true;
  let idleFrames = 0; // 停在银幕前（视频盖住画面）后，渲染一小会儿就停，把性能让给视频
  let frameAvg = 1 / 60;
  let slowFrames = 0;

  // 自适应分辨率：持续掉帧就逐级降低像素比（只降不升，避免来回抖动）
  const adapt = (rawDt) => {
    if (cam.fly || rawDt > 0.25) return; // 推进中或切后台回来的长帧不计
    frameAvg += (rawDt - frameAvg) * 0.05;
    slowFrames = frameAvg > 1 / 40 ? slowFrames + 1 : 0;
    if (slowFrames > 45 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      composer?.setPixelRatio(pixelRatio);
      layout();
      slowFrames = 0;
      frameAvg = 1 / 60;
    }
  };

  const tick = () => {
    if (!running) return;
    requestAnimationFrame(tick);
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const time = clock.elapsedTime;
    if (cam.mode === "screen" && !cam.fly && !arrived && !state.video && ++idleFrames > 90) return;
    adapt(rawDt);

    // 灯与片盘的惯性
    state.lamp += (state.lampTarget - state.lamp) * Math.min(1, dt * 3.2);
    state.flash = Math.max(0, state.flash - dt * 2.4);
    state.reelSpeed += (state.reelTarget - state.reelSpeed) * Math.min(1, dt * 1.8);
    const strike = state.flash > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(time * 61)) : 1; // 点灯时的电弧闪烁
    const level = state.lamp * strike;

    state.calm += (state.calmTarget - state.calm) * Math.min(1, dt * 1.5);
    beamUniforms.uLevel.value = level * state.calm;
    beamUniforms.uTime.value = time;
    screenMat.color.setScalar(Math.min(0.95, level * 1.35));
    // 影片层开始走片后 0.3 秒内亮到原片亮度，不再跟着灯泡明暗变化
    state.filmLevel = (state.filmLevel || 0) + ((state.rolling ? 1 : 0) - (state.filmLevel || 0)) * Math.min(1, dt * 8);
    filmMat.color.setScalar(state.filmLevel);
    if (bloom) {
      const target = state.rolling ? 0 : BLOOM;
      bloom.strength += (target - bloom.strength) * Math.min(1, dt * 3);
      bloom.enabled = bloom.strength > 0.005;
    }
    // 影片在走时，银幕反光跟着画面变色
    if (state.rolling && state.video && time > state.sampleAt) {
      state.sampleAt = time + 0.25;
      try {
        screenLight.color.lerp(averageColor(state.video), 0.6);
      } catch {
        state.sampleAt = Infinity; // 跨域视频不能读像素，就保持封面的颜色
      }
    }
    screenLight.intensity = level * 7;
    lensLight.intensity = level * 1.6;
    projector.setLamp(level);
    projector.spin(state.reelSpeed * dt);
    projector.setHover(state.hover);

    if (state.countdown) {
      const e = (performance.now() - state.countdown.start) / 1000;
      if (e < 1.8) drawCountdown(e);
      else {
        state.countdown = null;
        drawPoster();
      }
    }

    // 镜头
    if (cam.fly) {
      const f = cam.fly;
      const k = clamp01((performance.now() - f.start) / f.duration);
      const e = easeInOut(k);
      f.curve.getPointAt(e, cam.pos);
      const lookK = f.mode === "screen" ? easeInOut(clamp01(k * 1.25)) : easeInOut(clamp01(k * 1.4 - 0.3));
      cam.look.lerpVectors(f.from.look, f.to.look, lookK);
      if (k >= 1) {
        cam.fly = null;
        cam.mode = f.mode;
        arrived = onArrive;
        onArrive = null;
      }
    } else if (cam.mode === "booth") {
      cam.pos.copy(pose.booth.pos);
      cam.look.copy(pose.booth.look);
    } else {
      cam.pos.copy(pose.screen.pos);
      cam.look.copy(pose.screen.look);
    }
    camera.position.copy(cam.pos);
    if (cam.mode === "booth" && !cam.fly && !state.reduceMotion) {
      // 呼吸般的手持感 + 鼠标视差
      pointerSmooth.lerp(pointer, Math.min(1, dt * 2.5));
      camera.position.x += Math.sin(time * 0.13) * 0.05 + pointerSmooth.x * 0.22;
      camera.position.y += Math.sin(time * 0.19) * 0.03 + pointerSmooth.y * 0.12;
    }
    camera.lookAt(tmp.copy(cam.look));
    // 放映间时画面整体上移（下方留给胶片与片名），推进到银幕时逐渐回正
    let boothK = cam.mode === "booth" ? 1 : 0;
    if (cam.fly && cam.fly.fromMode !== cam.fly.mode) {
      const k = easeInOut(clamp01((performance.now() - cam.fly.start) / cam.fly.duration));
      boothK = cam.fly.mode === "screen" ? 1 - k : k;
    }
    const shift = boothK * 0.17;
    if (Math.abs(shift - cam.booth) > 1e-4) {
      cam.booth = shift;
      if (shift > 0) camera.setViewOffset(viewW, viewH * (1 + shift), 0, viewH * shift, viewW, viewH);
      else camera.clearViewOffset();
    }

    draw();
    // 到达回调放在渲染之后，此时相机矩阵已是最终机位，播放器能精确盖住银幕
    if (arrived) {
      const cb = arrived;
      arrived = null;
      cb();
    }
  };

  /* ---------------- 对外接口 ---------------- */

  const api = {
    renderer,
    start(reduceMotion) {
      state.reduceMotion = reduceMotion;
      layout();
      setBeamShape();
      if (!reduceMotion) {
        // 开场：从放映间更深处缓缓走到放映机身后
        const b = pose.booth;
        camera.position.copy(b.pos).add(new THREE.Vector3(-0.9, 0.5, 2.6));
        cam.look.copy(b.look).add(new THREE.Vector3(-1.5, 0.6, 0));
        flyTo("booth", 3200, [b.pos.clone().add(new THREE.Vector3(-0.35, 0.18, 1.0))]);
      }
      tick();
    },
    resize: layout,
    setPointer(x, y) { pointer.set(x, y); },
    hit: hitTest,
    setHover(v) { state.hover = v; },
    // 开场：灯泡点亮，进入待机预映
    ignite(delay = 500) {
      setTimeout(() => {
        state.lampTarget = 0.62;
        state.flash = 1;
        state.reelTarget = 0.6;
      }, delay);
    },
    // 换片：片盘倒转一下，灯光一暗，画面换掉
    load(item, image, { instant = false, title = "" } = {}) {
      const swap = () => {
        state.aspect = item.aspect || 16 / 9;
        state.image = image;
        state.title = title;
        setBeamShape();
        layout();
        screenLight.color.copy(averageColor(image));
        if (!state.countdown) drawPoster();
      };
      if (instant) return swap();
      const prevTarget = state.lampTarget;
      state.lampTarget = 0.08;
      state.reelSpeed = -9;
      setTimeout(() => {
        swap();
        state.lampTarget = prevTarget || 0.62;
      }, 260);
    },
    // 放映：满灯、片盘全速、机械声、倒计时片头，同时镜头沿光束推进到银幕
    // video：要直接投到银幕上的 <video>；onRoll：倒计时结束、该开始放片的时刻
    play(onReady, { video = null, onRoll } = {}) {
      state.lampTarget = 1;
      state.flash = 0.6;
      state.reelTarget = 3.2;
      state.countdown = { start: performance.now() };
      state.video = video;
      const roll = () => {
        if (!state.video) return;
        const tex = new THREE.VideoTexture(state.video);
        tex.colorSpace = THREE.SRGBColorSpace;
        filmMat.map = tex;
        filmMat.needsUpdate = true;
        filmMesh.visible = true;
        state.rolling = true;
        state.sampleAt = 0;
        onRoll?.();
      };
      if (state.reduceMotion) {
        cam.mode = "screen";
        state.countdown = null;
        drawPoster();
        roll();
        onReady();
        return;
      }
      state.rollTimer = setTimeout(roll, 1800);
      clatter(2.9);
      onArrive = () => {
        // 影片直接投在银幕上时，光束和灰尘收得更淡，免得飘在画面前
        state.calmTarget = state.video ? 0 : 0.12;
        onReady();
      };
      flyTo("screen", 2900);
    },
    // 停映：镜头退回放映间，回到待机预映
    stop(onBack) {
      clearTimeout(state.rollTimer);
      if (filmMat.map) {
        filmMat.map.dispose();
        filmMat.map = null;
        filmMat.needsUpdate = true;
      }
      filmMesh.visible = false;
      state.video = null;
      state.rolling = false;
      if (state.image) screenLight.color.copy(averageColor(state.image));
      state.calmTarget = 1;
      state.lampTarget = 0.62;
      state.reelTarget = 0.6;
      state.countdown = null;
      drawPoster();
      if (state.reduceMotion) {
        cam.mode = "booth";
        onBack?.();
        return;
      }
      onArrive = onBack;
      flyTo("booth", 2100);
    },
    get mode() { return cam.fly ? "flying" : cam.mode; },
    // 当前画面在视口中的矩形（CSS 像素），用于把播放器盖在银幕上
    screenRect() {
      const r = imageRect();
      const a = new THREE.Vector3(r.x - r.w / 2, r.y + r.h / 2, r.z).project(camera);
      const b = new THREE.Vector3(r.x + r.w / 2, r.y - r.h / 2, r.z).project(camera);
      const W = container.clientWidth;
      const H = container.clientHeight;
      return {
        left: ((a.x + 1) / 2) * W,
        top: ((1 - a.y) / 2) * H,
        width: ((b.x - a.x) / 2) * W,
        height: ((a.y - b.y) / 2) * H,
      };
    },
    // 调试用：同步渲染 n 帧，返回每帧毫秒数（含 GPU 同步）
    benchmark(n = 60) {
      const gl = renderer.getContext();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) draw();
      gl.finish();
      return (performance.now() - t0) / n;
    },
    pause() { running = false; },
    resume() { if (!running) { running = true; clock.getDelta(); tick(); } },
  };
  return api;
}

/* ---------------- 放映机模型 ---------------- */

function buildProjector(lowPower) {
  const group = new THREE.Group();
  const SX = -1; // 带铭牌、手轮、格栅的一侧朝向镜头
  const paint = new THREE.MeshStandardMaterial({ color: 0x2c3330, metalness: 0.55, roughness: 0.4 });
  const paintDark = new THREE.MeshStandardMaterial({ color: 0x1d2220, metalness: 0.5, roughness: 0.45 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, metalness: 0.3, roughness: 0.55 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, metalness: 1, roughness: 0.2 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb4894a, metalness: 1, roughness: 0.32 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xa7abb0, metalness: 1, roughness: 0.3 });
  const filmPack = new THREE.MeshStandardMaterial({ color: 0x24170e, metalness: 0.2, roughness: 0.38 });
  const vent = new THREE.MeshStandardMaterial({ color: 0x050403, emissive: 0xc2541a, emissiveIntensity: 0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1014, metalness: 0.4, roughness: 0.05, emissive: 0xffe2b0, emissiveIntensity: 0 });
  const pilot = new THREE.MeshStandardMaterial({ color: 0x331008, emissive: 0xff5a1f, emissiveIntensity: 0.4 });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = !lowPower;
    mesh.receiveShadow = !lowPower;
    group.add(mesh);
    return mesh;
  };
  const H = Math.PI / 2;

  // 底座与立柱
  add(new RoundedBoxGeometry(0.72, 0.07, 0.6, 3, 0.02), black, 0, 0.035, 0.05);
  add(new THREE.CylinderGeometry(0.1, 0.13, 0.82, 32), paint, 0, 0.48, 0.05);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 32), paintDark, 0, 0.9, 0.05);

  // 走片机芯（前）与灯室（后）
  add(new RoundedBoxGeometry(0.36, 0.5, 0.52, 4, 0.045), paint, 0, 1.17, -0.15);
  add(new RoundedBoxGeometry(0.42, 0.56, 0.5, 4, 0.06), paintDark, SX * 0.02, 1.18, 0.38);
  // 机芯侧门的分缝和铰链
  add(new THREE.BoxGeometry(0.004, 0.42, 0.006), black, SX * 0.181, 1.17, -0.02);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 12), chrome, SX * 0.183, 1.32, 0.0);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 12), chrome, SX * 0.183, 1.02, 0.0);
  // 灯室烟囱
  add(new THREE.CylinderGeometry(0.065, 0.075, 0.3, 24), black, -SX * 0.06, 1.6, 0.45);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24), paintDark, -SX * 0.06, 1.76, 0.45);
  // 灯室散热格栅（点灯后透出橙光）
  for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.006, 0.026, 0.34), vent, SX * 0.235, 1.0 + i * 0.05, 0.38);

  // 镜头
  add(new RoundedBoxGeometry(0.22, 0.22, 0.05, 2, 0.015), paintDark, 0.05, 1.2, -0.43);
  add(new THREE.CylinderGeometry(0.058, 0.058, 0.22, 32), black, LENS.x, LENS.y, -0.53, H);
  add(new THREE.CylinderGeometry(0.062, 0.062, 0.03, 32), chrome, LENS.x, LENS.y, -0.47, H);
  add(new THREE.CylinderGeometry(0.074, 0.07, 0.06, 32), brass, LENS.x, LENS.y, -0.63, H);
  const lensGlass = add(new THREE.CircleGeometry(0.052, 32), glass, LENS.x, LENS.y, LENS.z + 0.001, 0, Math.PI);
  // 对焦旋钮
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 16), chrome, LENS.x + SX * 0.075, 1.2, -0.5, 0, 0, H);

  // 侧面：铭牌、手轮、指示灯、开关
  const plate = (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 80;
    const x = c.getContext("2d");
    x.fillStyle = "#b08a4e";
    x.fillRect(0, 0, 256, 80);
    x.strokeStyle = "#6e5328";
    x.lineWidth = 4;
    x.strokeRect(6, 6, 244, 68);
    x.fillStyle = "#2a1f10";
    x.font = "700 30px ui-monospace, Menlo, monospace";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("ONION·35", 128, 42);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, metalness: 0.8, roughness: 0.38 });
  })();
  add(new THREE.PlaneGeometry(0.15, 0.047), plate, SX * 0.182, 1.36, -0.2, 0, SX * H);
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.009, 12, 40), chrome));
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.008), chrome);
    spoke.rotation.z = (i * Math.PI) / 4;
    wheel.add(spoke);
  }
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 16).rotateX(H), black));
  wheel.position.set(SX * 0.205, 1.06, -0.24);
  wheel.rotation.y = H;
  group.add(wheel);
  const pilotLamp = add(new THREE.SphereGeometry(0.013, 16, 12), pilot, SX * 0.186, 1.33, -0.05);
  const lever = add(new THREE.BoxGeometry(0.014, 0.11, 0.014), chrome, SX * 0.19, 1.0, -0.05);
  add(new THREE.SphereGeometry(0.018, 16, 12), black, SX * 0.19, 1.055, -0.05);

  // 片盘：铝制法兰（五个减重孔）夹着胶片卷
  const flangeGeo = (() => {
    const R = 0.34;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R, 0, Math.PI * 2, false);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.2, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const hub = new THREE.Path();
    hub.absarc(0, 0, 0.03, 0, Math.PI * 2, true);
    shape.holes.push(hub);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 48 });
    g.rotateY(H);
    return g;
  })();
  const makeReel = (pack) => {
    const reel = new THREE.Group();
    for (const x of [-0.035, 0.03]) {
      const f = new THREE.Mesh(flangeGeo, alu);
      f.position.x = x;
      f.castShadow = !lowPower;
      reel.add(f);
    }
    const film = new THREE.Mesh(new THREE.CylinderGeometry(pack, pack, 0.058, 48).rotateZ(H), filmPack);
    reel.add(film);
    reel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 24).rotateZ(H), chrome));
    return reel;
  };
  const front = makeReel(0.27);
  front.position.set(SX * 0.06, 1.8, -0.36);
  const back = makeReel(0.16);
  back.position.set(SX * 0.06, 1.78, 0.4);
  group.add(front, back);
  // 支臂
  const arm = (from, to) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, dir.length(), 16), paint);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.castShadow = !lowPower;
    group.add(mesh);
  };
  arm(new THREE.Vector3(SX * 0.02, 1.4, -0.2), new THREE.Vector3(SX * 0.02, 1.8, -0.36));
  arm(new THREE.Vector3(SX * 0.02, 1.44, 0.32), new THREE.Vector3(SX * 0.02, 1.78, 0.4));

  // 胶片：从供片盘绕进机芯，再从机芯回到收片盘（带齿孔的贴图，走片时滚动）
  const filmTex = (() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#1c120a";
    x.fillRect(0, 0, 32, 64);
    x.fillStyle = "#6b5134";
    x.fillRect(6, 4, 20, 26);
    x.fillRect(6, 34, 20, 26);
    x.fillStyle = "#c9b28a";
    for (const y of [2, 18, 34, 50]) { x.fillRect(1, y, 3, 8); x.fillRect(28, y, 3, 8); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const filmMat = new THREE.MeshStandardMaterial({ map: filmTex, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  const ribbon = (points, repeat) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const N = 60;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const p = curve.getPointAt(i / N);
      pos.push(p.x - 0.0175, p.y, p.z, p.x + 0.0175, p.y, p.z);
      uv.push(0, (i / N) * repeat, 1, (i / N) * repeat);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, filmMat);
    group.add(mesh);
  };
  const fx = SX * 0.06;
  ribbon([new THREE.Vector3(fx, 1.62, -0.6), new THREE.Vector3(fx, 1.5, -0.47), new THREE.Vector3(fx, 1.43, -0.38)], 18);
  ribbon([new THREE.Vector3(fx, 1.43, 0.08), new THREE.Vector3(fx, 1.55, 0.18), new THREE.Vector3(fx, 1.66, 0.27)], 14);

  const hoverables = [paint, paintDark];
  return {
    group,
    setLamp(level) {
      glass.emissiveIntensity = level * 5.5;
      vent.emissiveIntensity = level * 0.7;
      pilot.emissiveIntensity = 0.4 + level * 3;
      lever.rotation.x = level > 0.8 ? -0.6 : 0.3;
    },
    spin(delta) {
      front.rotation.x -= delta * 1.0;
      back.rotation.x -= delta * 1.6;
      wheel.rotation.x -= delta * 2.2;
      filmTex.offset.y += delta * 0.9;
    },
    setHover(on) {
      for (const mat of hoverables) mat.emissive.setHex(on ? 0x1a1208 : 0x000000);
    },
  };
}
