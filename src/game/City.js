import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, mulberry32, rand } from './utils.js'
import {
  makeGlowTexture,
  makeLightPoolTexture,
  makeSignTextures,
  NEON_COLORS,
} from './textures.js'

const CELL = 80
const ROAD_HALF = 9
const CHUNK_RADIUS = 3
const MAX_BUILDINGS = 640
const MAX_SIGNS = 72
const MAX_LAMPS = 320
const MAX_POOLS = 320
const MAX_CROWNS = 400
const MAX_PROPS = 520
const MAX_ANTENNAS = 220
const MAX_GLOWS = 900

const buildingVertexPrelude = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vObjNormal;
  varying vec3 vInstScale;
  varying vec3 vWorldPos;
  varying float vSeed;
`

const buildingFragmentPrelude = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vObjNormal;
  varying vec3 vInstScale;
  varying vec3 vWorldPos;
  varying float vSeed;

  float gWinMask;
  vec3 gWinEmis;

  float ndHash(vec2 p, float seed) {
    p += vec2(seed * 13.13, seed * 7.77);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void getWindows(vec3 n, vec3 local, vec3 scale, float seed,
                  out float mask, out vec3 emis) {
    float side = 1.0 - step(0.5, abs(n.y));
    vec3 wp = vWorldPos;
    // The seed arrives as an interpolated varying; quantise it so tiny
    // per-pixel precision differences cannot turn the sin hash into noise.
    seed = floor(seed * 64.0 + 0.5) / 64.0;

    // World-space window grid: floors and columns line up across the city.
    vec2 plane;
    if (abs(n.x) > 0.5) plane = vec2(wp.z, wp.y);
    else if (abs(n.z) > 0.5) plane = vec2(wp.x, wp.y);
    else plane = vec2(wp.x, wp.z);

    vec2 uv = plane / vec2(1.8, 2.4);
    vec2 cell = floor(uv);
    vec2 f = fract(uv);

    // Fade the window grid into an average glow when cells shrink below a pixel.
    vec2 fw = fwidth(uv);
    float aa = clamp(1.0 - max(fw.x, fw.y) * 1.7, 0.0, 1.0);

    // Wide mullions: glass fills the middle of each cell, frame stays visible.
    float wx = smoothstep(0.30, 0.36, f.x) * (1.0 - smoothstep(0.64, 0.70, f.x));
    float wy = smoothstep(0.28, 0.34, f.y) * (1.0 - smoothstep(0.66, 0.72, f.y));
    mask = wx * wy * side;

    // One palette per tower so the facade reads as a building, not confetti.
    float palette = ndHash(vec2(seed * 0.37, seed * 1.91), seed);
    vec3 tintAmber = vec3(1.0, 0.52, 0.22);
    vec3 tintCool = vec3(0.38, 0.72, 1.0);
    vec3 tintPink = vec3(1.0, 0.35, 0.70);
    vec3 base = palette < 0.52 ? tintAmber : (palette < 0.86 ? tintCool : tintPink);

    // Occupancy is coherent: whole lit floors, rare vertical stacks,
    // and a few individual offices. This avoids a random checkerboard.
    float floorH = ndHash(vec2(seed, cell.y), seed + 1.0);
    float colH = ndHash(vec2(cell.x, seed), seed + 2.0);
    float office = ndHash(cell, seed + 3.0);
    float litFloor = step(0.80, floorH);
    float litCol = step(0.97, colH) * 0.5;
    float litOffice = step(0.94, office);
    float lit = max(max(litFloor, litCol), litOffice);
    // Even occupied floors keep a few dark offices.
    lit *= step(0.16, ndHash(cell + 7.0, seed + 5.0));

    // Floors share a brightness so they read as bands, while individual
    // offices vary enough to avoid flat panels.
    float floorLevel = 0.40 + 0.60 * ndHash(vec2(seed, cell.y), seed + 6.0);
    float cellLevel = 0.62 + 0.38 * ndHash(cell + 5.0, seed + 9.0);
    float level = floorLevel * cellLevel;
    // Upper floors fall away into the night haze.
    float heightFade = mix(1.0, 0.45, smoothstep(4.0, 130.0, wp.y));
    // A subtle warm drift on some offices breaks up flat colour.
    vec3 c = mix(base, vec3(1.0, 0.88, 0.7), step(0.6, office) * 0.35);
    emis = c * lit * level * 0.34 * heightFade * aa;

    // Sub-pixel facades keep a faint ambient window wash.
    emis += base * 0.012 * (1.0 - aa);
    // Dark glass still catches a little of the city.
    emis += vec3(0.012, 0.022, 0.038) * mask;
    // Keep the frame darker than the glass so towers stay silhouettes.
    emis += vec3(0.006, 0.011, 0.020) * (1.0 - mask) * side * heightFade;
    // Faint neon edge strips catch the vertical corners of each tower.
    float tangent = abs(n.x) > 0.5 ? abs(local.z) : abs(local.x);
    float edge = smoothstep(0.455, 0.5, tangent) * side;
    emis += mix(base, vec3(0.35, 0.7, 1.0), 0.5) * edge * 0.10 * heightFade;

    // Ground floor shopfronts glow onto the street.
    float baseBand = (1.0 - smoothstep(0.0, 2.4, wp.y)) * side;
    float along = abs(n.x) > 0.5 ? wp.z : wp.x;
    float shopSeg = fract(along / 4.5 + seed * 0.137);
    float shopWin = smoothstep(0.12, 0.22, shopSeg) * (1.0 - smoothstep(0.78, 0.88, shopSeg));
    float shop = step(0.35, ndHash(vec2(floor(along / 4.5), seed), seed + 4.0));
    emis += mix(vec3(1.0, 0.5, 0.22), vec3(0.22, 0.8, 1.0), step(0.5, palette)) * baseBand * shop * shopWin * 0.12;
  }
`

export class City {
  constructor(scene, renderer) {
    this.scene = scene
    this.renderer = renderer
    this.chunks = new Map()
    this.activeKeys = []
    this.lastChunk = null
    this.time = 0
    this.glowPoints = null

    this.createSky()
    this.createEnvironment()
    this.createLights()
    this.createGround()
    this.createBuildingMeshes()
    this.createSignMeshes()
    this.createStreetlightMeshes()
    this.createGlowPoints()
  }

  // ---------------------------------------------------------------- sky

  createSky() {
    const geometry = new THREE.SphereGeometry(1400, 40, 24)
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        float skyHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 zenith = vec3(0.004, 0.008, 0.026);
          vec3 horizon = vec3(0.075, 0.035, 0.115);
          vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.62, h));

          float glow = pow(max(0.0, 1.0 - h), 6.0);
          float ang = atan(d.z, d.x);
          col += vec3(0.42, 0.07, 0.5) * glow * (0.5 + 0.5 * sin(ang * 2.0 + 1.1));
          col += vec3(0.0, 0.2, 0.32) * glow * (0.5 + 0.5 * sin(ang * 3.0 + 2.4));
          col += vec3(0.4, 0.16, 0.05) * pow(max(0.0, 1.0 - h), 16.0) * 0.6;

          // stars
          vec2 suv = vec2(atan(d.z, d.x) * 0.1591549, asin(clamp(d.y, -1.0, 1.0)) * 0.3183099);
          vec2 sg = floor(suv * vec2(340.0, 170.0));
          float star = step(0.9968, skyHash(sg));
          star *= smoothstep(0.06, 0.32, h);
          col += vec3(0.75, 0.86, 1.0) * star * (0.35 + 0.65 * skyHash(sg + 7.0));

          // moon
          vec3 moonDir = normalize(vec3(-0.32, 0.3, -0.9));
          float m = smoothstep(0.9992, 0.99965, dot(d, moonDir));
          col += vec3(1.0, 0.95, 0.86) * m * 2.2;
          col += vec3(0.3, 0.5, 0.9) * pow(max(0.0, dot(d, moonDir)), 140.0) * 0.5;

          col = mix(col, vec3(0.025, 0.03, 0.055), smoothstep(0.0, -0.16, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    this.sky = new THREE.Mesh(geometry, material)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -10
    this.scene.add(this.sky)
  }

  createEnvironment() {
    const envScene = new THREE.Scene()
    envScene.background = new THREE.Color(0x02040a)
    const panel = (color, x, y, z, w, h, ry = 0) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      )
      mesh.position.set(x, y, z)
      mesh.rotation.y = ry
      envScene.add(mesh)
    }
    panel(0x4df3ff, -34, 14, -8, 26, 16, Math.PI / 2)
    panel(0xff2fb3, 32, 10, 18, 22, 12, -Math.PI / 2)
    panel(0xff8a2b, 0, 5, 44, 30, 9, Math.PI)
    panel(0x8b5cff, 12, 26, -30, 20, 10, 0.4)
    panel(0xffffff, 0, 42, 0, 50, 6, Math.PI / 2)
    panel(0x1a3a5a, 0, -4, 0, 120, 120)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    pmrem.compileEquirectangularShader()
    const target = pmrem.fromScene(envScene, 0.06, 0.1, 600)
    this.scene.environment = target.texture
    this.scene.environmentIntensity = 0.95
    pmrem.dispose()
    envScene.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    })
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(0x4a6a9f, 0x080a12, 1.15)
    this.scene.add(hemi)

    const moon = new THREE.DirectionalLight(0x93b8ff, 1.5)
    moon.position.set(60, 90, -50)
    this.scene.add(moon)

    const fill = new THREE.DirectionalLight(0xff4fa0, 0.25)
    fill.position.set(-60, 30, 40)
    this.scene.add(fill)
  }

  // --------------------------------------------------------------- ground

  createGround() {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.05,
      envMapIntensity: 1.15,
    })

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.vertexShader = `varying vec3 vWPos;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      )

      shader.fragmentShader = /* glsl */ `
        varying vec3 vWPos;
        uniform float uTime;

        float gHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float gNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
                     mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        struct GroundInfo {
          vec3 albedo;
          float rough;
          float metal;
          vec3 emissive;
        };
        GroundInfo gGround;

        GroundInfo groundInfo(vec3 wp) {
          vec2 p = wp.xz;
          vec2 gp = mod(p, 80.0);
          vec2 d = min(gp, 80.0 - gp);
          float dmin = min(d.x, d.y);

          float road = 1.0 - smoothstep(8.7, 9.15, dmin);
          float walk = (1.0 - smoothstep(11.55, 12.05, dmin)) * (1.0 - road);
          float block = clamp(1.0 - road - walk, 0.0, 1.0);

          // lane markings --------------------------------------------------
          float dash = step(fract(p.y * 0.125), 0.55);
          float dashZ = step(fract(p.x * 0.125), 0.55);
          float centerX = (1.0 - smoothstep(0.1, 0.24, d.x)) * step(9.3, d.y) * dash;
          float centerZ = (1.0 - smoothstep(0.1, 0.24, d.y)) * step(9.3, d.x) * dashZ;
          float edgeX = (1.0 - smoothstep(0.06, 0.18, abs(d.x - 8.25))) * step(9.3, d.y);
          float edgeZ = (1.0 - smoothstep(0.06, 0.18, abs(d.y - 8.25))) * step(9.3, d.x);
          float crossX = step(9.35, d.x) * (1.0 - step(11.7, d.x)) *
                         (1.0 - smoothstep(8.1, 8.6, d.y)) * step(0.5, fract(p.y * 0.9));
          float crossZ = step(9.35, d.y) * (1.0 - step(11.7, d.y)) *
                         (1.0 - smoothstep(8.1, 8.6, d.x)) * step(0.5, fract(p.x * 0.9));
          float markings = clamp(centerX + centerZ + edgeX + edgeZ + crossX * 0.8 + crossZ * 0.8, 0.0, 1.0) * road;

          // surfaces -------------------------------------------------------
          float grain = gNoise(p * 2.3) * 0.6 + gNoise(p * 7.0) * 0.4;
          vec3 asphalt = vec3(0.032, 0.037, 0.048) * (0.72 + grain * 0.65);
          vec3 sidewalk = vec3(0.075, 0.08, 0.095) * (0.8 + grain * 0.45);
          float tile = smoothstep(0.0, 0.06, abs(fract(p.x / 2.0) - 0.5)) *
                       smoothstep(0.0, 0.06, abs(fract(p.y / 2.0) - 0.5));
          sidewalk *= mix(0.72, 1.0, tile);
          vec3 blockCol = vec3(0.016, 0.019, 0.028) * (0.8 + grain * 0.5);

          vec3 col = mix(asphalt, sidewalk, walk);
          col = mix(col, blockCol, block);

          // wet patches
          float pn = gNoise(p * 0.055) * 0.62 + gNoise(p * 0.19) * 0.38;
          float puddle = smoothstep(0.57, 0.72, pn) * road * (1.0 - markings * 0.9);
          puddle *= smoothstep(0.1, 0.3, gNoise(p * 0.8));
          col = mix(col, vec3(0.01, 0.014, 0.024), puddle * 0.72);

          col += markings * vec3(0.9, 0.96, 1.0) * 0.5;

          GroundInfo info;
          info.albedo = col;
          info.rough = mix(0.82, 0.6, road);
          info.rough = mix(info.rough, 0.05, puddle);
          info.metal = mix(0.0, 0.65, puddle);
          info.emissive = markings * vec3(0.28, 0.34, 0.4) + vec3(0.006, 0.01, 0.02) * road;
          return info;
        }
      ` + shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          gGround = groundInfo(vWPos);
          diffuseColor.rgb = gGround.albedo;
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = gGround.rough;
          `,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          /* glsl */ `#include <metalnessmap_fragment>
          metalnessFactor = gGround.metal;
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          totalEmissiveRadiance += gGround.emissive;
          `,
        )
    }
    material.customProgramCacheKey = () => 'neondrift-ground-v1'

    const geometry = new THREE.PlaneGeometry(1500, 1500, 1, 1)
    geometry.rotateX(-Math.PI / 2)
    this.ground = new THREE.Mesh(geometry, material)
    this.ground.position.y = 0
    this.ground.frustumCulled = false
    this.ground.receiveShadow = false
    this.scene.add(this.ground)
    this.groundMaterial = material
  }

  // ------------------------------------------------------------ buildings

  createBuildingMeshes() {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.28,
      envMapIntensity: 0.85,
    })

    material.onBeforeCompile = (shader) => {
      shader.vertexShader = buildingVertexPrelude + shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          vLocalPos = position;
          vObjNormal = normal;
          #ifdef USE_INSTANCING
            vInstScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
            vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
            // Derive the per-building seed from the instance translation.
            vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 97.0;
          #else
            vInstScale = vec3(1.0);
            vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vSeed = fract(sin(dot(modelMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 97.0;
          #endif
          `,
        )

      shader.fragmentShader = buildingFragmentPrelude + shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float winMask;
          vec3 winEmis;
          getWindows(normalize(vObjNormal), vLocalPos, vInstScale, vSeed, winMask, winEmis);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.016, 0.03, 0.052), winMask * 0.78);
          gWinMask = winMask;
          gWinEmis = winEmis;
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.07, gWinMask);
          `,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          /* glsl */ `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 0.95, gWinMask);
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          totalEmissiveRadiance += gWinEmis;
          `,
        )
    }
    material.customProgramCacheKey = () => 'neondrift-buildings-v2'

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_BUILDINGS)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    this.scene.add(mesh)
    this.buildingMesh = mesh

    // rooftop clutter
    const propGeo = new THREE.BoxGeometry(1, 1, 1)
    const propMat = new THREE.MeshStandardMaterial({
      color: 0x10151f,
      roughness: 0.85,
      metalness: 0.35,
    })
    const props = new THREE.InstancedMesh(propGeo, propMat, MAX_PROPS)
    props.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    props.frustumCulled = false
    props.count = 0
    this.scene.add(props)
    this.propMesh = props

    // antennas
    const antennaGeo = new THREE.CylinderGeometry(0.06, 0.1, 1, 5)
    antennaGeo.translate(0, 0.5, 0)
    const antennaMat = new THREE.MeshStandardMaterial({
      color: 0x232a36,
      roughness: 0.6,
      metalness: 0.7,
    })
    const antennas = new THREE.InstancedMesh(antennaGeo, antennaMat, MAX_ANTENNAS)
    antennas.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    antennas.frustumCulled = false
    antennas.count = 0
    this.scene.add(antennas)
    this.antennaMesh = antennas

    // glowing roof crowns
    const crownGeo = new THREE.BoxGeometry(1, 1, 1)
    const crownMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, MAX_CROWNS)
    crowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    crowns.frustumCulled = false
    crowns.count = 0
    this.scene.add(crowns)
    this.crownMesh = crowns
  }

  createSignMeshes() {
    this.signTextures = makeSignTextures()
    this.signMeshes = this.signTextures.map((texture) => {
      const geometry = new THREE.PlaneGeometry(1, 1)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: true,
      })
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_SIGNS)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.renderOrder = 3
      this.scene.add(mesh)
      return mesh
    })
    this.signCounts = new Array(this.signMeshes.length).fill(0)
  }

  createStreetlightMeshes() {
    const pole = new THREE.CylinderGeometry(0.08, 0.13, 7.1, 6)
    pole.translate(0, 3.55, 0)
    const arm = new THREE.BoxGeometry(2.3, 0.08, 0.08)
    arm.translate(1.05, 7.05, 0)
    const head = new THREE.BoxGeometry(0.72, 0.12, 0.3)
    head.translate(2.05, 6.98, 0)
    const merged = mergeGeometries([pole, arm, head])
    const metal = new THREE.MeshStandardMaterial({
      color: 0x2a3140,
      roughness: 0.5,
      metalness: 0.75,
    })
    const lamps = new THREE.InstancedMesh(merged, metal, MAX_LAMPS)
    lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    lamps.frustumCulled = false
    lamps.count = 0
    this.scene.add(lamps)
    this.lampMesh = lamps

    const bulbGeo = new THREE.BoxGeometry(0.62, 0.06, 0.24)
    bulbGeo.translate(2.05, 6.9, 0)
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xd9f7ff, toneMapped: false })
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, MAX_LAMPS)
    bulbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    bulbs.frustumCulled = false
    bulbs.count = 0
    this.scene.add(bulbs)
    this.bulbMesh = bulbs

    const poolGeo = new THREE.PlaneGeometry(1, 1)
    poolGeo.rotateX(-Math.PI / 2)
    const poolMat = new THREE.MeshBasicMaterial({
      map: makeLightPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.5,
      toneMapped: false,
      fog: false,
    })
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, MAX_POOLS)
    pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    pools.frustumCulled = false
    pools.count = 0
    pools.renderOrder = 2
    this.scene.add(pools)
    this.poolMesh = pools
  }

  createGlowPoints() {
    const geometry = new THREE.BufferGeometry()
    this.glowPositions = new Float32Array(MAX_GLOWS * 3)
    this.glowColors = new Float32Array(MAX_GLOWS * 3)
    geometry.setAttribute('position', new THREE.BufferAttribute(this.glowPositions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.glowColors, 3))
    geometry.setDrawRange(0, 0)
    const material = new THREE.PointsMaterial({
      size: 2.6,
      map: makeGlowTexture(64),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
      toneMapped: false,
      fog: false,
    })
    this.glowPoints = new THREE.Points(geometry, material)
    this.glowPoints.frustumCulled = false
    this.glowPoints.renderOrder = 4
    this.scene.add(this.glowPoints)
    this.glowGeometry = geometry
    this.glowCount = 0
  }

  // ------------------------------------------------------------ generation

  generateChunk(i, j) {
    const rng = mulberry32(((i * 73856093) ^ (j * 19349663) ^ 0x9e3779b9) >>> 0)
    const cx = i * CELL + CELL / 2
    const cz = j * CELL + CELL / 2
    const chunk = { buildings: [], signs: [], lamps: [], colliders: [] }

    const dist = Math.hypot(cx, cz)
    const downtown = clamp(1 - dist / 950, 0.18, 1)
    const half = 22

    const addBuilding = (ox, oz, w, d) => {
      const x = cx + clamp(ox, -half + w / 2, half - w / 2)
      const z = cz + clamp(oz, -half + d / 2, half - d / 2)
      let height = (11 + Math.pow(rng(), 2.1) * 52) * (0.55 + downtown * 1.25)
      if (rng() > 0.9) height += 25 + rng() * 45
      height = Math.min(height, 145)
      const hue = 0.56 + rng() * 0.13
      const color = new THREE.Color().setHSL(hue, 0.32 + rng() * 0.2, 0.085 + rng() * 0.07)
      const building = {
        x, z, w, d, h: height,
        color,
        seed: rng() * 97,
        crown: rng() < 0.42,
        crownColor: NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)].clone().multiplyScalar(1.5),
        roofProps: [],
        antenna: height > 55 && rng() < 0.7,
      }

      if (rng() < 0.35) {
        building.roofProps.push({
          x: x + rand(-w * 0.22, w * 0.22),
          z: z + rand(-d * 0.22, d * 0.22),
          w: 2 + rng() * 4,
          h: 1.2 + rng() * 3.4,
          d: 2 + rng() * 4,
        })
      }

      chunk.buildings.push(building)
      chunk.colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      })

      // Signs face the closest street.
      if (rng() < 0.62) {
        const edges = [
          { dist: x - (cx - 28), face: 'left' },
          { dist: cx + 28 - x, face: 'right' },
          { dist: z - (cz - 28), face: 'back' },
          { dist: cz + 28 - z, face: 'front' },
        ].sort((a, b) => a.dist - b.dist)
        const face = edges[0].face
        const faceWidth = face === 'left' || face === 'right' ? d : w
        const signW = Math.min(faceWidth - 2.5, 4.8 + rng() * 4.5)
        const signH = signW * (0.42 + rng() * 0.1)
        const y = clamp(5.5 + rng() * 24, 5.5, Math.max(6, height - 4))
        const along = (rng() - 0.5) * Math.max(0, faceWidth - signW - 2)
        let sx = x
        let sz = z
        let ry = 0
        if (face === 'left') { sx = x - w / 2 - 0.1; sz = z + along; ry = -Math.PI / 2 }
        if (face === 'right') { sx = x + w / 2 + 0.1; sz = z + along; ry = Math.PI / 2 }
        if (face === 'back') { sx = x + along; sz = z - d / 2 - 0.1; ry = Math.PI }
        if (face === 'front') { sx = x + along; sz = z + d / 2 + 0.1; ry = 0 }
        const variant = Math.floor(rng() * this.signTextures.length)
        chunk.signs.push({ x: sx, y, z: sz, ry, w: signW, h: signH, variant })
      }
    }

    const layout = rng()
    if (layout < 0.4) {
      addBuilding(rand(-4, 4), rand(-4, 4), 22 + rng() * 20, 22 + rng() * 20)
    } else if (layout < 0.72) {
      const w = 17 + rng() * 8
      const d = 38 + rng() * 10
      addBuilding(-16, rand(-2, 2), w, d)
      addBuilding(16, rand(-2, 2), w, d)
    } else {
      const w = 17 + rng() * 7
      const d = 17 + rng() * 7
      addBuilding(-15, -15, w, d)
      addBuilding(15, -15, w, d)
      addBuilding(-15, 15, w, d)
      addBuilding(15, 15, w, d)
    }

    // Streetlights on each side of the block.
    const sides = [
      { x: cx - 29.5, z: cz, ry: Math.PI, hx: cx - 31.6, hz: cz },
      { x: cx + 29.5, z: cz, ry: 0, hx: cx + 31.6, hz: cz },
      { x: cx, z: cz - 29.5, ry: Math.PI / 2, hx: cx, hz: cz - 31.6 },
      { x: cx, z: cz + 29.5, ry: -Math.PI / 2, hx: cx, hz: cz + 31.6 },
    ]
    for (const side of sides) {
      const warm = rng() > 0.4
      chunk.lamps.push({
        ...side,
        color: warm ? new THREE.Color(1.0, 0.78, 0.48) : new THREE.Color(0.55, 0.88, 1.0),
      })
    }

    return chunk
  }

  ensureChunks(px, pz) {
    const ci = Math.floor(px / CELL)
    const cj = Math.floor(pz / CELL)
    if (this.lastChunk && this.lastChunk.i === ci && this.lastChunk.j === cj) return false
    this.lastChunk = { i: ci, j: cj }

    const keys = []
    for (let di = -CHUNK_RADIUS; di <= CHUNK_RADIUS; di++) {
      for (let dj = -CHUNK_RADIUS; dj <= CHUNK_RADIUS; dj++) {
        const i = ci + di
        const j = cj + dj
        const key = `${i},${j}`
        keys.push(key)
        if (!this.chunks.has(key)) this.chunks.set(key, this.generateChunk(i, j))
      }
    }
    this.activeKeys = keys

    // Drop far-away chunks so memory stays flat.
    if (this.chunks.size > 220) {
      const active = new Set(keys)
      for (const key of this.chunks.keys()) {
        if (!active.has(key)) this.chunks.delete(key)
      }
    }
    this.rebuildInstances()
    return true
  }

  rebuildInstances() {
    const dummy = new THREE.Object3D()
    let bi = 0
    let pi = 0
    let ai = 0
    let ci = 0
    let li = 0
    let pi2 = 0
    let gi = 0
    const signCounts = new Array(this.signMeshes.length).fill(0)
    const glowPos = this.glowPositions
    const glowCol = this.glowColors

    const addGlow = (x, y, z, color, scale = 1) => {
      if (gi >= MAX_GLOWS) return
      glowPos[gi * 3] = x
      glowPos[gi * 3 + 1] = y
      glowPos[gi * 3 + 2] = z
      glowCol[gi * 3] = color.r * scale
      glowCol[gi * 3 + 1] = color.g * scale
      glowCol[gi * 3 + 2] = color.b * scale
      gi++
    }

    for (const key of this.activeKeys) {
      const chunk = this.chunks.get(key)
      if (!chunk) continue

      for (const b of chunk.buildings) {
        if (bi < MAX_BUILDINGS) {
          dummy.position.set(b.x, b.h / 2, b.z)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.set(b.w, b.h, b.d)
          dummy.updateMatrix()
          this.buildingMesh.setMatrixAt(bi, dummy.matrix)
          this.buildingMesh.setColorAt(bi, b.color)
          bi++
        }

        if (b.crown && ci < MAX_CROWNS) {
          dummy.position.set(b.x, b.h - 0.12, b.z)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.set(b.w + 0.45, 0.28, b.d + 0.45)
          dummy.updateMatrix()
          this.crownMesh.setMatrixAt(ci, dummy.matrix)
          this.crownMesh.setColorAt(ci, b.crownColor)
          ci++
          addGlow(b.x, b.h, b.z, b.crownColor, 0.7)
        }

        for (const prop of b.roofProps) {
          if (pi >= MAX_PROPS) break
          dummy.position.set(prop.x, b.h + prop.h / 2, prop.z)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.set(prop.w, prop.h, prop.d)
          dummy.updateMatrix()
          this.propMesh.setMatrixAt(pi, dummy.matrix)
          pi++
        }

        if (b.antenna && ai < MAX_ANTENNAS) {
          const ax = b.x + b.w * 0.25
          const az = b.z - b.d * 0.25
          const ah = 4 + (b.seed % 6)
          dummy.position.set(ax, b.h, az)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.set(1, ah, 1)
          dummy.updateMatrix()
          this.antennaMesh.setMatrixAt(ai, dummy.matrix)
          ai++
          addGlow(ax, b.h + ah, az, new THREE.Color(1, 0.08, 0.15), 1.4)
        }
      }

      for (const s of chunk.signs) {
        const count = signCounts[s.variant]
        if (count >= MAX_SIGNS) continue
        dummy.position.set(s.x, s.y, s.z)
        dummy.rotation.set(0, s.ry, 0)
        dummy.scale.set(s.w, s.h, 1)
        dummy.updateMatrix()
        this.signMeshes[s.variant].setMatrixAt(count, dummy.matrix)
        signCounts[s.variant]++
        const color = NEON_COLORS[s.variant % NEON_COLORS.length]
        addGlow(s.x, s.y, s.z, color, 0.55)
      }

      for (const lamp of chunk.lamps) {
        if (li < MAX_LAMPS) {
          dummy.position.set(lamp.x, 0, lamp.z)
          dummy.rotation.set(0, lamp.ry, 0)
          dummy.scale.set(1, 1, 1)
          dummy.updateMatrix()
          this.lampMesh.setMatrixAt(li, dummy.matrix)
          this.bulbMesh.setMatrixAt(li, dummy.matrix)
          li++
        }
        if (pi2 < MAX_POOLS) {
          dummy.position.set(lamp.hx, 0.03, lamp.hz)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.set(15, 1, 15)
          dummy.updateMatrix()
          this.poolMesh.setMatrixAt(pi2, dummy.matrix)
          this.poolMesh.setColorAt(pi2, lamp.color)
          pi2++
        }
        addGlow(lamp.hx, 6.9, lamp.hz, lamp.color, 1.5)
      }
    }

    this.buildingMesh.count = bi
    this.buildingMesh.instanceMatrix.needsUpdate = true
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true

    this.crownMesh.count = ci
    this.crownMesh.instanceMatrix.needsUpdate = true
    if (this.crownMesh.instanceColor) this.crownMesh.instanceColor.needsUpdate = true

    this.propMesh.count = pi
    this.propMesh.instanceMatrix.needsUpdate = true

    this.antennaMesh.count = ai
    this.antennaMesh.instanceMatrix.needsUpdate = true

    this.lampMesh.count = li
    this.lampMesh.instanceMatrix.needsUpdate = true
    this.bulbMesh.count = li
    this.bulbMesh.instanceMatrix.needsUpdate = true

    this.poolMesh.count = pi2
    this.poolMesh.instanceMatrix.needsUpdate = true
    if (this.poolMesh.instanceColor) this.poolMesh.instanceColor.needsUpdate = true

    for (let i = 0; i < this.signMeshes.length; i++) {
      const mesh = this.signMeshes[i]
      mesh.count = signCounts[i]
      mesh.instanceMatrix.needsUpdate = true
    }

    this.glowGeometry.setDrawRange(0, gi)
    this.glowGeometry.attributes.position.needsUpdate = true
    this.glowGeometry.attributes.color.needsUpdate = true
    this.glowCount = gi
  }

  // --------------------------------------------------------------- queries

  update(dt, camera, playerPos) {
    this.time += dt
    this.groundMaterial.userData = this.groundMaterial.userData || {}
    // Move the infinite ground with the player; the pattern is world-space.
    // playerPos is a Vector2, so its y component is the world Z coordinate.
    this.ground.position.x = Math.round(playerPos.x)
    this.ground.position.z = Math.round(playerPos.y)
    this.sky.position.copy(camera.position)
    this.ensureChunks(playerPos.x, playerPos.y)
  }

  collide(x, z, radius) {
    const ci = Math.floor(x / CELL)
    const cj = Math.floor(z / CELL)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const chunk = this.chunks.get(`${ci + di},${cj + dj}`)
        if (!chunk) continue
        for (const b of chunk.colliders) {
          const minX = b.minX - radius
          const maxX = b.maxX + radius
          const minZ = b.minZ - radius
          const maxZ = b.maxZ + radius
          if (x > minX && x < maxX && z > minZ && z < maxZ) {
            const px1 = maxX - x
            const px2 = x - minX
            const pz1 = maxZ - z
            const pz2 = z - minZ
            const min = Math.min(px1, px2, pz1, pz2)
            let nx = 0
            let nz = 0
            if (min === px1) nx = 1
            else if (min === px2) nx = -1
            else if (min === pz1) nz = 1
            else nz = -1
            return { nx, nz, depth: min }
          }
        }
      }
    }
    return null
  }

  isOnRoad(x, z) {
    const gx = ((x % CELL) + CELL) % CELL
    const gz = ((z % CELL) + CELL) % CELL
    const dx = Math.min(gx, CELL - gx)
    const dz = Math.min(gz, CELL - gz)
    return Math.min(dx, dz) < ROAD_HALF + 0.6
  }

  nearestRoad(x, z, lane = 4.5) {
    const gx = ((x % CELL) + CELL) % CELL
    const gz = ((z % CELL) + CELL) % CELL
    const dx = Math.min(gx, CELL - gx)
    const dz = Math.min(gz, CELL - gz)
    if (dx < dz) {
      const base = Math.round(x / CELL) * CELL
      const side = lane * (Math.random() > 0.5 ? 1 : -1)
      return { x: base + side, z, axis: 'z' }
    }
    const base = Math.round(z / CELL) * CELL
    const side = lane * (Math.random() > 0.5 ? 1 : -1)
    return { x, z: base + side, axis: 'x' }
  }

  reset() {
    this.lastChunk = null
    this.chunks.clear()
    this.activeKeys = []
    this.buildingMesh.count = 0
    this.signMeshes.forEach((m) => (m.count = 0))
    this.glowGeometry.setDrawRange(0, 0)
  }
}
