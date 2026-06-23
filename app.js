var MODEL_URL = './models/casa_chidisima.glb';

var canvas = document.getElementById('viewer');
var card = document.querySelector('.viewerCard');
var msg = document.getElementById('message');
var dot = document.getElementById('statusDot');
var loader = document.getElementById('loader');
var err = document.getElementById('errorBox');
var resetBtn = document.getElementById('resetView');
var rotateBtn = document.getElementById('toggleRotate');
var moveBtn = document.getElementById('toggleKeyboardMove');
var mouseLookBtn = document.getElementById('mouseLookBtn');
var fullscreenBtn = document.getElementById('fullscreenBtn');

var ua = navigator.userAgent || '';
var isTV = /SmartTV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Viera|Aquos|Hisense|Roku|AFT|TV/i.test(ua);
var lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 2;
var lowPowerMode = !!(isTV || lowMemory);
var targetFPS = lowPowerMode ? 30 : 60;
var frameInterval = 1000 / targetFPS;
var lastRenderTime = 0;

function setStatus(t, type) {
  msg.textContent = t;
  dot.classList.remove('loading', 'error');
  if (type === 'loading') dot.classList.add('loading');
  if (type === 'error') dot.classList.add('error');
}
function show(el, v) { if (el) el.classList.toggle('hidden', !v); }
function canUseWebGL() {
  try {
    var c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}
if (!canUseWebGL()) {
  setStatus('Esta TV/navegador no soporta WebGL.', 'error');
  show(loader, false);
  show(err, true);
  throw new Error('WebGL no disponible');
}

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b17);
scene.fog = new THREE.Fog(0x090b17, 18, lowPowerMode ? 60 : 90);

var camera = new THREE.PerspectiveCamera(43, 1, 0.01, 5000);
camera.position.set(9, 6, 10);

var renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: !lowPowerMode,
  alpha: false,
  powerPreference: 'default'
});
renderer.setPixelRatio(lowPowerMode ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = !lowPowerMode;
if (!lowPowerMode) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = lowPowerMode ? 1.08 : 1.18;

var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = !lowPowerMode;
controls.dampingFactor = 0.06;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.35;
controls.minDistance = 0.4;
controls.maxDistance = 80;

scene.add(new THREE.HemisphereLight(0xeaf0ff, 0x1b2038, lowPowerMode ? 2.6 : 2.35));

var sun = new THREE.DirectionalLight(0xffffff, lowPowerMode ? 2.2 : 3.2);
sun.position.set(10, 14, 9);
sun.castShadow = !lowPowerMode;
if (!lowPowerMode) {
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -25;
  sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -25;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 70;
}
scene.add(sun);

var fill = new THREE.DirectionalLight(0x8fdcff, lowPowerMode ? 1.55 : 1.2);
fill.position.set(-8, 5, -7);
scene.add(fill);

if (!lowPowerMode) {
  var neonLight = new THREE.PointLight(0x42f5ff, 4, 20, 2);
  neonLight.position.set(0, 5, 4);
  scene.add(neonLight);
}

var ground = new THREE.Mesh(
  new THREE.CircleGeometry(18, lowPowerMode ? 40 : 96),
  new THREE.MeshStandardMaterial({ color: 0x0f1729, roughness: 0.82, metalness: 0.02 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = !lowPowerMode;
scene.add(ground);

if (!lowPowerMode) {
  var grid = new THREE.GridHelper(36, 36, 0x57f7ff, 0x39415c);
  grid.material.transparent = true;
  grid.material.opacity = 0.13;
  scene.add(grid);
}

var model = null;
var initialCamera = null;
var keyboardMoveEnabled = true;
var mouseLookEnabled = true;
var isPointerLocked = false;
var yaw = 0;
var pitch = 0;
var mouseSensitivity = lowPowerMode ? 0.0018 : 0.0022;
var pressed = {};
var clock = new THREE.Clock();

function prepareModel(root) {
  root.traverse(function(obj) {
    if (!obj.isMesh) return;
    obj.castShadow = !lowPowerMode;
    obj.receiveShadow = !lowPowerMode;
    if (obj.material) {
      var arr = Array.isArray(obj.material) ? obj.material : [obj.material];
      arr.forEach(function(m) {
        if (m.map) {
          m.map.encoding = THREE.sRGBEncoding;
          if (lowPowerMode) {
            m.map.generateMipmaps = false;
            m.map.minFilter = THREE.LinearFilter;
            m.map.magFilter = THREE.LinearFilter;
          }
        }
        if (lowPowerMode) {
          m.roughness = Math.max(m.roughness || 0.5, 0.55);
          m.metalness = Math.min(m.metalness || 0, 0.35);
        }
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      });
    }
    if (obj.geometry) {
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
    }
  });
}

function fitModel(root) {
  var box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  var center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  var box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;
  var size = box2.getSize(new THREE.Vector3());
  var maxDim = Math.max(size.x, size.y, size.z) || 1;
  root.scale.multiplyScalar(7.5 / maxDim);
  var scaledBox = new THREE.Box3().setFromObject(root);
  var scaledSize = scaledBox.getSize(new THREE.Vector3());
  var scaledMax = Math.max(scaledSize.x, scaledSize.y, scaledSize.z) || 1;
  var dist = (scaledMax / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.45;
  camera.near = Math.max(dist / 1000, 0.01);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  camera.position.set(dist * 0.95, dist * 0.62, dist * 0.95);
  controls.target.set(0, scaledSize.y * 0.35, 0);
  controls.minDistance = Math.max(dist * 0.12, 0.3);
  controls.maxDistance = dist * 8;
  controls.update();
  initialCamera = { pos: camera.position.clone(), target: controls.target.clone() };
  syncMouseLookFromCamera();
}

function loadModel() {
  setStatus(lowPowerMode ? 'Cargando en modo TV optimizado...' : 'Cargando casa_chidisima.glb...', 'loading');
  show(loader, true);
  show(err, false);
  var slow = setTimeout(function() {
    if (loader && !loader.classList.contains('hidden')) {
      setStatus('La carga está tardando. Espera unos segundos más.', 'loading');
    }
  }, 12000);
  new THREE.GLTFLoader().load(
    MODEL_URL,
    function(gltf) {
      clearTimeout(slow);
      model = gltf.scene;
      prepareModel(model);
      scene.add(model);
      fitModel(model);
      show(loader, false);
      setStatus(lowPowerMode ? 'Modelo listo en modo TV optimizado.' : 'Modelo cargado correctamente.', 'ready');
    },
    undefined,
    function(error) {
      clearTimeout(slow);
      console.error(error);
      show(loader, false);
      show(err, true);
      setStatus('Error al cargar el modelo.', 'error');
    }
  );
}

function resize() {
  var w = card.clientWidth;
  var h = card.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function syncMouseLookFromCamera() {
  var euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  pitch = euler.x;
  yaw = euler.y;
}
function enterMouseLook() {
  if (!mouseLookEnabled) return;
  syncMouseLookFromCamera();
  if (canvas.requestPointerLock) canvas.requestPointerLock();
}
function updatePointerLockState() {
  isPointerLocked = document.pointerLockElement === canvas;
  controls.enabled = !isPointerLocked;
  if (mouseLookBtn) mouseLookBtn.textContent = isPointerLocked ? 'Mirada mouse: Activa' : 'Mirada mouse: Clic';
  if (!isPointerLocked) syncMouseLookFromCamera();
}
document.addEventListener('pointerlockchange', updatePointerLockState);
document.addEventListener('mousemove', function(e) {
  if (!isPointerLocked || !mouseLookEnabled) return;
  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;
  var limit = Math.PI / 2 - 0.06;
  pitch = Math.max(-limit, Math.min(limit, pitch));
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  var forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  controls.target.copy(camera.position).add(forward.multiplyScalar(5));
});
canvas.addEventListener('click', enterMouseLook);
mouseLookBtn.addEventListener('click', enterMouseLook);

function updateMove(dt) {
  if (!keyboardMoveEnabled) return;
  var forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() > 0) forward.normalize();
  var right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  var move = new THREE.Vector3();
  if (pressed.arrowup || pressed.w) move.add(forward);
  if (pressed.arrowdown || pressed.s) move.sub(forward);
  if (pressed.arrowright || pressed.d) move.add(right);
  if (pressed.arrowleft || pressed.a) move.sub(right);
  if (pressed.q) move.y += 1;
  if (pressed.e) move.y -= 1;
  if (move.lengthSq() === 0) return;
  move.normalize().multiplyScalar((pressed.shift ? 4.2 : 1.8) * dt);
  camera.position.add(move);
  controls.target.add(move);
  if (!isPointerLocked) controls.update();
}

window.addEventListener('keydown', function(e) {
  var k = e.key.toLowerCase();
  if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','q','e','shift'].indexOf(k) >= 0) {
    e.preventDefault();
    pressed[k] = true;
  }
});
window.addEventListener('keyup', function(e) { pressed[e.key.toLowerCase()] = false; });
window.addEventListener('blur', function() { pressed = {}; });

resetBtn.addEventListener('click', function() {
  if (!initialCamera) return;
  camera.position.copy(initialCamera.pos);
  controls.target.copy(initialCamera.target);
  controls.update();
  syncMouseLookFromCamera();
});
rotateBtn.addEventListener('click', function(e) {
  controls.autoRotate = !controls.autoRotate;
  e.target.textContent = 'Auto-rotación: ' + (controls.autoRotate ? 'On' : 'Off');
});
moveBtn.addEventListener('click', function(e) {
  keyboardMoveEnabled = !keyboardMoveEnabled;
  pressed = {};
  e.target.textContent = 'Movimiento libre: ' + (keyboardMoveEnabled ? 'On' : 'Off');
});
fullscreenBtn.addEventListener('click', function() {
  if (!document.fullscreenElement && card.requestFullscreen) card.requestFullscreen();
  else if (document.exitFullscreen) document.exitFullscreen();
});

window.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', resize);
document.addEventListener('visibilitychange', function() {
  if (document.hidden) pressed = {};
});

function animate(now) {
  requestAnimationFrame(animate);
  if (lowPowerMode && now - lastRenderTime < frameInterval) return;
  lastRenderTime = now;
  updateMove(clock.getDelta());
  if (!isPointerLocked) controls.update();
  renderer.render(scene, camera);
}

resize();
animate(0);
loadModel();
