/**
 * 稀有度全屏特效：Three.js 的 GPU 粒子 + 冲击波 + 符文环 + 光柱 + 电流弧。
 *
 * 抽卡页在卡片下面铺一层全屏 canvas，按当前卡的稀有度播放一次；划走可打断。
 * 只创建这一个特效上下文，五个卡面各自仍是原来的 card view。
 *
 * 设计约束：
 * - 只在播放期间跑帧，停后不再 requestFrame，省电；
 * - 画布透明/暗底由组件控制显隐，本模块只负责场景；
 * - 普通/稀有也走同一套，只是粒子少、Bloom 弱、没有光柱/符文。
 */
import * as THREE from "three"

export type RarityFxKey = "common" | "rare" | "epic" | "legendary" | "hidden"

export interface RarityFxHost {
  canvas: unknown
  width(): number
  height(): number
  pixelRatio: number
  requestFrame(cb: (time: number) => void): number
  cancelFrame(id: number): void
  onIdle?(): void
}

export interface RarityFx {
  trigger(rarity: RarityFxKey): void
  resize(): void
  stop(): void
  dispose(): void
}

interface Preset {
  glow: number
  particles: number
  duration: number
  rainbow?: boolean
}

/** 五档的时长与粒子量；普通卡不播，组件用它决定画布什么时候淡出。 */
export const RARITY_FX_PRESETS: Record<RarityFxKey, Preset> = {
  common: { glow: 0xa1a1a6, particles: 0, duration: 0 },
  rare: { glow: 0x5ac8fa, particles: 1800, duration: 900 },
  epic: { glow: 0xbf5af2, particles: 3200, duration: 1350 },
  legendary: { glow: 0xffd700, particles: 4600, duration: 1750 },
  hidden: { glow: 0xff4d6d, particles: 6000, duration: 2050, rainbow: true },
}

/** 给组件用的纯函数：不实例化 WebGL 也能读到时长与档位。 */
export function rarityFxDuration(rarity: RarityFxKey): number {
  return (RARITY_FX_PRESETS[rarity] || RARITY_FX_PRESETS.epic).duration
}

const RAINBOW = [0xff4d6d, 0xff9f0a, 0xffd60a, 0x34c759, 0x00c7be, 0x5e5ce6, 0xbf5af2]
const N = 7000

/** 全屏稀有度特效视图；调用方负责 canvas 的尺寸与显隐。 */
export function createRarityFx(host: RarityFxHost): RarityFx {
  const canvas = host.canvas as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(host.pixelRatio || 1, 1.5))
  renderer.setSize(host.width() || 1, host.height() || 1, false)
  // 透明底：特效只叠粒子/光晕，不盖黑整张页面。
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, (host.width() || 1) / (host.height() || 1), 0.1, 100)
  camera.position.set(0, 0, 7.2)

  // 只保留粒子：不用后处理（部分小程序 WebGL 设备没有 half-float target，会全黑），
  // 也不加光晕/冲击波/符文环/光柱/电流弧。

  // ---------- GPU 粒子 ----------
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(N * 3)
  const dirs = new Float32Array(N * 3)
  const colors = new Float32Array(N * 3)
  const seeds = new Float32Array(N)
  const sizes = new Float32Array(N)
  const speeds = new Float32Array(N)
  const color = new THREE.Color()
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.pow(Math.random(), 0.6) * 1.1
    positions[i * 3] = Math.cos(a) * r * 0.8
    positions[i * 3 + 1] = Math.sin(a) * r * 1.05
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.25
    const dx = Math.cos(a) + (Math.random() - 0.5) * 0.8
    const dy = Math.sin(a) * 0.9 + Math.random() * 0.5
    const len = Math.hypot(dx, dy) || 1
    dirs[i * 3] = dx / len
    dirs[i * 3 + 1] = dy / len
    dirs[i * 3 + 2] = (Math.random() - 0.5) * 0.5
    color.setHex(RAINBOW[(Math.random() * RAINBOW.length) | 0])
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
    seeds[i] = Math.random()
    sizes[i] = 0.8 + Math.random() * 2.5
    speeds[i] = 0.5 + Math.random() * 1.8
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geo.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3))
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3))
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1))

  const particleMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0xbf5af2) },
      uRainbow: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: [
      "uniform float uTime;",
      "attribute vec3 aDir; attribute vec3 aColor; attribute float aSeed; attribute float aSize; attribute float aSpeed;",
      "varying vec3 vColor; varying float vAlpha;",
      "void main(){",
      "  float life = fract(aSeed + uTime * 0.42);",
      "  float t = uTime * aSpeed;",
      "  vec3 p = position + aDir * t * 2.5 + vec3(0.0, -0.16, 0.0) * t * t;",
      "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
      "  gl_PointSize = aSize * (58.0 / max(0.1, -mv.z)) * (0.55 + 0.45 * (1.0 - life));",
      "  gl_Position = projectionMatrix * mv;",
      "  vAlpha = smoothstep(0.0, 0.08, life) * (1.0 - life);",
      "  vColor = aColor;",
      "}",
    ].join("\n"),
    fragmentShader: [
      "uniform vec3 uTint; uniform float uRainbow; uniform float uOpacity;",
      "varying vec3 vColor; varying float vAlpha;",
      "void main(){",
      "  float d = length(gl_PointCoord - vec2(0.5));",
      "  if (d > 0.5) discard;",
      "  float a = smoothstep(0.5, 0.05, d) * vAlpha * uOpacity;",
      "  vec3 c = mix(uTint, vColor, uRainbow);",
      "  gl_FragColor = vec4(c, a);",
      "}",
    ].join("\n"),
  })
  const points = new THREE.Points(geo, particleMat)
  points.frustumCulled = false
  scene.add(points)

  // 彩条：和粒子一起爆开的细长纸带，补足“爆炸”的体量感。
  const RIBBON_COLORS: Record<string, number[]> = {
    rare: [0x5ac8fa, 0x64d2ff, 0x0a84ff, 0xffffff],
    epic: [0xbf5af2, 0xda8fff, 0x5e5ce6, 0xffffff],
    legendary: [0xffd700, 0xff9f0a, 0xffe55c, 0xffffff],
    hidden: [0xff4d6d, 0xff9f0a, 0xffd60a, 0x34c759, 0x00c7be, 0x5e5ce6, 0xbf5af2],
  }
  const RIBBON_COUNT = 72
  const ribbonGeo = new THREE.PlaneGeometry(0.065, 0.46)
  const ribbonGroup = new THREE.Group()
  const ribbons: Array<{
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    vx: number
    vy: number
    vz: number
    rx: number
    ry: number
    rz: number
    phase: number
  }> = []
  for (let i = 0; i < RIBBON_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(ribbonGeo, mat)
    mesh.visible = false
    ribbonGroup.add(mesh)
    ribbons.push({ mesh, mat, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, phase: 0 })
  }
  ribbonGroup.visible = false
  scene.add(ribbonGroup)

  let raf = 0
  let startAt = 0
  let duration = 0
  let active = false

  function loop(now: number): void {
    if (!active) return
    raf = host.requestFrame(loop)
    // 第一帧的时间戳才是本视图的时间原点；不要用 performance.now()，小程序里两套时钟可能不同源。
    if (!startAt) startAt = now
    const elapsed = (now - startAt) / 1000
    const t = Math.min(1, elapsed / (duration / 1000))
    particleMat.uniforms.uTime.value = elapsed
    particleMat.uniforms.uOpacity.value = Math.max(0, 1 - Math.pow(t, 3) * 0.85)
    if (ribbonGroup.visible) {
      for (const r of ribbons) {
        r.mesh.position.x += r.vx * (1 / 60)
        r.mesh.position.y += r.vy * (1 / 60)
        r.mesh.position.z += r.vz * (1 / 60)
        r.vy -= 3.2 * (1 / 60)
        r.rx += r.vx * 0.06
        r.ry += r.vy * 0.05
        r.rz += 2.2 * (1 / 60)
        r.mesh.rotation.set(r.rx, r.ry, r.rz)
        r.mat.opacity = Math.max(0, 1 - t * 1.15)
      }
    }
    renderer.render(scene, camera)
    if (t >= 1.25) {
      active = false
      ribbonGroup.visible = false
      if (raf) host.cancelFrame(raf)
      raf = 0
      if (host.onIdle) host.onIdle()
    }
  }

  return {
    trigger(rarity: RarityFxKey) {
      // 普通卡没有演出：只留粒子框架给稀有以上。
      if (rarity === "common") {
        active = false
        if (raf) host.cancelFrame(raf)
        raf = 0
        ribbonGroup.visible = false
        return
      }
      const cfg = RARITY_FX_PRESETS[rarity] || RARITY_FX_PRESETS.epic
      startAt = 0
      duration = cfg.duration
      active = true
      particleMat.uniforms.uTime.value = 0
      particleMat.uniforms.uTint.value.setHex(cfg.glow)
      particleMat.uniforms.uRainbow.value = cfg.rainbow ? 1 : 0
      particleMat.uniforms.uOpacity.value = 1
      points.visible = true
      geo.setDrawRange(0, cfg.particles)
      const colors = RIBBON_COLORS[rarity] || RIBBON_COLORS.epic
      for (const r of ribbons) {
        const a = Math.random() * Math.PI * 2
        const radius = 0.15 + Math.random() * 0.8
        r.mesh.position.set(
          Math.cos(a) * radius,
          Math.sin(a) * radius * 0.7,
          (Math.random() - 0.5) * 0.5,
        )
        r.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
        r.vx = Math.cos(a) * (0.6 + Math.random() * 2.2)
        r.vy = 1.1 + Math.random() * 2.8
        r.vz = (Math.random() - 0.5) * 1.2
        r.rx = r.mesh.rotation.x
        r.ry = r.mesh.rotation.y
        r.rz = r.mesh.rotation.z
        r.phase = Math.random()
        r.mat.color.setHex(colors[(Math.random() * colors.length) | 0])
        r.mat.opacity = 1
        r.mesh.visible = true
      }
      ribbonGroup.visible = true
      if (raf) host.cancelFrame(raf)
      raf = host.requestFrame(loop)
    },
    resize() {
      const w = host.width() || 1
      const h = host.height() || 1
      renderer.setPixelRatio(Math.min(host.pixelRatio || 1, 1.5))
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    },
    stop() {
      active = false
      if (raf) host.cancelFrame(raf)
      raf = 0
    },
    dispose() {
      active = false
      if (raf) host.cancelFrame(raf)
      raf = 0
      geo.dispose()
      particleMat.dispose()
      ribbons.forEach((r) => r.mat.dispose())
      ribbonGeo.dispose()
      renderer.dispose()
    },
  }
}
