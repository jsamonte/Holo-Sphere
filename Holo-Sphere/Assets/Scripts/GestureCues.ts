import {AllHandTypes} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import WorldCameraFinderProvider from "../SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {FingerPoke} from "./FingerPoke"
import {FistCrush} from "./FistCrush"
import {GestureTuning} from "./GestureTuning"
import {isPointingPose} from "./HandPose"
import {addVisual, makeText, newLineMaterial, paintText, tint} from "./NeonKit"
import {PalmSquish} from "./PalmSquish"
import {newBuilder, quad} from "./RetroMenuStyle"
import {SphereReach} from "./SphereReach"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

/** Pieces the ring is drawn in. Its progress arc lights them up one by one. */
const SEGMENTS = 48

/** How far from the sphere, in radii, a pointing fingertip shows its dot. */
const DOT_RANGE = 3

/** How far out, as a multiple of the crush zone, an open hand brings up the collapse guide. */
const GUIDE_RANGE = 1.8

/** Compress progress from which two open palms are taken to be setting up a compress, not a collapse. */
const COMPRESS_SETUP = 0.6

/** How much the crush zone may change size before its ring is rebuilt to match. */
const ZONE_REBUILD = 0.05

/** The gesture the sphere reads the hands as closest to doing, and how close: 1 once it has registered. */
interface Cue {
  name: string
  progress: number
}

/** Appends one piece of a flat ring facing +Z, between two angles and two radii. */
function appendSegment(builder: MeshBuilder, from: number, to: number, inner: number, outer: number): void {
  builder.appendVerticesInterleaved([
    Math.cos(from) * inner, Math.sin(from) * inner, 0, 0, 0, 1, 0, 0,
    Math.cos(from) * outer, Math.sin(from) * outer, 0, 0, 0, 1, 1, 0,
    Math.cos(to) * outer, Math.sin(to) * outer, 0, 0, 0, 1, 1, 1,
    Math.cos(to) * inner, Math.sin(to) * inner, 0, 0, 0, 1, 0, 1
  ])
}

/** The six indices drawing segment `i` of a ring built with {@link appendSegment}. */
function segmentIndices(i: number): number[] {
  const first = i * 4
  return [first, first + 1, first + 2, first, first + 2, first + 3]
}

/** A whole ring of SEGMENTS pieces, clockwise from the top like a dial filling. */
function ringMesh(radius: number, thickness: number): MeshBuilder {
  const builder = newBuilder()
  const indices: number[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const from = Math.PI / 2 - (i / SEGMENTS) * Math.PI * 2
    const to = Math.PI / 2 - ((i + 1) / SEGMENTS) * Math.PI * 2
    appendSegment(builder, from, to, radius - thickness / 2, radius + thickness / 2)
    indices.push(...segmentIndices(i))
  }
  builder.appendIndices(indices)
  return builder
}

/**
 * Shows the player what the game sees their hands doing, so they can adjust instead of guessing.
 *
 * - **Ring.** A ring round the sphere, named after the gesture the hands are closest to, fills as
 *   they get closer to it and turns white the moment it registers: a flick building speed, a pull
 *   stretching towards the split, a fist closing, palms coming in, a finger pushing in.
 * - **Dot.** A dot on any fingertip the game reads as pointing, near the sphere - the poke pose it
 *   is looking for.
 * - **Collapse guide.** With an open hand near the sphere, a ring marks the zone the palm has to be
 *   inside for a fist to crush it, and a dot on the palm turns from pink to cyan once it is - so the
 *   player knows where to close their hand. Two open palms at the sphere are setting up a compress,
 *   and get no guide.
 *
 * Every gesture script works out its own progress, so the ring always agrees with what will count.
 * Shown whenever GestureTuning's Hints are on, and always during calibration. Put this on the sphere
 * alongside its gesture scripts; the ring and dot live at the scene root so a squish or a crush does
 * not squash them, and hide with the sphere.
 */
@component
export class GestureCues extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Look</span>')

  @input
  @label("Line Material")
  @hint("Unlit material the ring and dot are drawn with. Assets/Neon Line.mat, the same as the menus.")
  @allowUndefined
  lineMaterial: Material | null = null

  @input
  @label("Font Source")
  @hint("Any Text3D in the VT323 font, like the leaderboard's Rows. The gesture's name copies its font and material.")
  @allowUndefined
  fontSource: Text3D | null = null

  @input("vec4", "{0, 0.95, 1, 1}")
  @label("Ring")
  @widget(new ColorWidget())
  ringColor: vec4 = new vec4(0, 0.95, 1, 1)

  @input("vec4", "{0.85, 1, 1, 1}")
  @label("Registered")
  @hint("Colour the ring turns once the gesture has registered.")
  @widget(new ColorWidget())
  readyColor: vec4 = new vec4(0.85, 1, 1, 1)

  @input("vec4", "{1, 0.2, 0.8, 1}")
  @label("Poke Dot")
  @hint("Dot on a fingertip the game reads as pointing, ready to poke.")
  @widget(new ColorWidget())
  dotColor: vec4 = new vec4(1, 0.2, 0.8, 1)

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Layout</span>')

  @input
  @label("Ring Size (radii)")
  @widget(new SliderWidget(1.1, 3, 0.05))
  ringSize: number = 1.45

  @input
  @label("Ring Thickness (cm)")
  @widget(new SliderWidget(0.1, 1.5, 0.05))
  ringThickness: number = 0.35

  @input
  @label("Label Size")
  @widget(new SliderWidget(20, 100, 1))
  labelSize: number = 44

  @input
  @label("Dot Size (cm)")
  @widget(new SliderWidget(0.3, 3, 0.1))
  dotSize: number = 1.2

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Behaviour</span>')

  @input
  @label("Show From")
  @hint("How far into a gesture, 0 to 1, before its ring appears. Higher hides the ring for idle hand movement.")
  @widget(new SliderWidget(0, 0.9, 0.05))
  showFrom: number = 0.25

  @input
  @label("Fade Speed")
  @widget(new SliderWidget(1, 30, 0.5))
  fadeSpeed: number = 10

  private camera = WorldCameraFinderProvider.getInstance()

  private yoyo: YoyoFlick | null = null
  private split: TwoHandSplit | null = null
  private crush: FistCrush | null = null
  private squish: PalmSquish | null = null
  private poke: FingerPoke | null = null
  private reach: SphereReach | null = null
  private baseRadius = 0.5

  private root: SceneObject | null = null
  private arcObject: SceneObject | null = null
  private arcBuilder: MeshBuilder | null = null
  private arcMaterial: Material | null = null
  private trackMaterial: Material | null = null
  private label: Text3D | null = null
  private labelMaterial: Material | null = null
  private dot: SceneObject | null = null
  private dotMaterial: Material | null = null

  private zone: SceneObject | null = null
  private zoneVisual: RenderMeshVisual | null = null
  private zoneMaterial: Material | null = null
  private zoneRadius = 0
  private palmDot: SceneObject | null = null
  private palmMaterial: Material | null = null

  private shownSegments = -1
  private opacity = 0
  private lastCue: Cue = {name: "", progress: 0}

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
    // The ring and dot live at the scene root, so hiding the sphere does not hide them.
    this.createEvent("OnDisableEvent").bind(() => this.hideAll())
  }

  private init(): void {
    const owner = this.getSceneObject()
    this.yoyo = owner.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.split = owner.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit
    this.crush = owner.getComponent(FistCrush.getTypeName()) as FistCrush
    this.squish = owner.getComponent(PalmSquish.getTypeName()) as PalmSquish
    this.poke = owner.getComponent(FingerPoke.getTypeName()) as FingerPoke
    this.reach = owner.getComponent(SphereReach.getTypeName()) as SphereReach

    const scale = owner.getTransform().getWorldScale()
    this.baseRadius = Math.max(scale.x, Math.max(scale.y, scale.z)) * 0.5

    if (this.lineMaterial == null || this.fontSource == null) {
      print("GestureCues: needs a Line Material and a Font Source to draw its cues.")
      return
    }

    this.build(owner.layer)
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private build(layer: LayerSet): void {
    const radius = this.baseRadius * this.ringSize
    const outer = radius + this.ringThickness / 2

    const root = global.scene.createSceneObject("Gesture Cue Ring")
    root.layer = layer
    this.root = root

    const track = ringMesh(radius, this.ringThickness)
    const arc = ringMesh(radius, this.ringThickness)

    this.trackMaterial = addVisual(root, track, newLineMaterial(this.lineMaterial!))

    const arcObject = global.scene.createSceneObject("Gesture Cue Arc")
    arcObject.setParent(root)
    arcObject.layer = layer
    arcObject.getTransform().setLocalPosition(new vec3(0, 0, 0.05))
    this.arcMaterial = addVisual(arcObject, arc, newLineMaterial(this.lineMaterial!))
    this.arcObject = arcObject
    this.arcBuilder = arc
    this.shownSegments = SEGMENTS

    this.labelMaterial = this.fontSource!.mainMaterial.clone()
    this.label = makeText("", root, new vec3(0, -(outer + 2.2), 0.05), this.labelSize, this.fontSource!.font, this.labelMaterial)

    const dotMesh = newBuilder()
    const half = this.dotSize / 2
    quad(dotMesh, -half, -half, half, half)
    const dot = global.scene.createSceneObject("Gesture Cue Dot")
    dot.layer = layer
    this.dotMaterial = addVisual(dot, dotMesh, newLineMaterial(this.lineMaterial!))
    this.dot = dot

    // The collapse zone's ring is built on first use, once the zone's size is known.
    const zone = global.scene.createSceneObject("Collapse Guide Zone")
    zone.layer = layer
    this.zoneVisual = zone.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.zoneMaterial = newLineMaterial(this.lineMaterial!)
    this.zoneVisual.mainMaterial = this.zoneMaterial
    this.zone = zone

    const palmMesh = newBuilder()
    const palmHalf = this.dotSize * 0.8
    quad(palmMesh, -palmHalf, -palmHalf, palmHalf, palmHalf)
    const palmDot = global.scene.createSceneObject("Collapse Guide Palm")
    palmDot.layer = layer
    this.palmMaterial = addVisual(palmDot, palmMesh, newLineMaterial(this.lineMaterial!))
    this.palmDot = palmDot

    this.hideAll()
  }

  private onUpdate(): void {
    const tuning = GestureTuning.get()
    const wanted = tuning === null || tuning.showCues

    const cue = wanted ? this.strongestCue() : null
    const target = cue !== null && cue.progress >= this.showFrom ? 1 : 0
    this.opacity += (target - this.opacity) * Math.min(1, getDeltaTime() * this.fadeSpeed)
    if (cue !== null && target > 0) {
      this.lastCue = cue
    }

    this.updateRing()
    this.updateDot(wanted)
    this.updateCollapseGuide(wanted)
  }

  /**
   * With an open hand near the sphere: a ring round the zone its palm has to be inside to crush the
   * sphere, and a dot on the palm, pink outside the zone and cyan inside it.
   */
  private updateCollapseGuide(wanted: boolean): void {
    const zone = this.zone
    const palmDot = this.palmDot
    if (zone === null || palmDot === null) {
      return
    }

    const settingUpCompress = this.squish !== null && this.squish.compressProgress >= COMPRESS_SETUP
    const guide = wanted && !settingUpCompress && this.crush !== null ? this.crush.crushGuide(GUIDE_RANGE) : null

    if (guide === null) {
      zone.enabled = false
      palmDot.enabled = false
      return
    }

    this.fitZone(guide.radius)
    zone.enabled = true
    const zoneTransform = zone.getTransform()
    zoneTransform.setWorldPosition(guide.centre)
    zoneTransform.setWorldRotation(this.facingCamera(guide.centre))
    tint(this.zoneMaterial, guide.inside ? this.readyColor : this.ringColor, guide.inside ? 0.75 : 0.35)

    palmDot.enabled = true
    const toCamera = this.camera.getWorldPosition().sub(guide.palm)
    const lift = toCamera.length > 0.0001 ? toCamera.normalize().uniformScale(1.5) : vec3.zero()
    const palmTransform = palmDot.getTransform()
    palmTransform.setWorldPosition(guide.palm.add(lift))
    palmTransform.setWorldRotation(this.facingCamera(guide.palm))
    tint(this.palmMaterial, guide.inside ? this.ringColor : this.dotColor, 0.9)
  }

  /** Rebuilds the zone's ring when the crush zone has changed size, as calibration can make it. */
  private fitZone(radius: number): void {
    if (this.zoneVisual === null) {
      return
    }
    if (this.zoneRadius > 0 && Math.abs(radius - this.zoneRadius) <= this.zoneRadius * ZONE_REBUILD) {
      return
    }
    this.zoneRadius = radius

    const builder = ringMesh(radius, this.ringThickness)
    builder.updateMesh()
    this.zoneVisual.mesh = builder.getMesh()
  }

  /** Every gesture's own progress, and the one furthest along. */
  private strongestCue(): Cue {
    const cues: Cue[] = [
      {name: "YOYO", progress: this.yoyo !== null ? this.yoyo.flickProgress : 0},
      {name: "DUPLICATE", progress: this.split !== null ? this.split.splitProgress : 0},
      {name: "COLLAPSE", progress: this.crush !== null ? this.crush.crushProgress : 0},
      {name: "COMPRESS", progress: this.squish !== null ? this.squish.compressProgress : 0},
      {name: "POKE", progress: this.poke !== null ? this.poke.pokeProgress : 0}
    ]

    let best = cues[0]
    for (let i = 1; i < cues.length; i++) {
      if (cues[i].progress > best.progress) {
        best = cues[i]
      }
    }
    return best
  }

  private updateRing(): void {
    const root = this.root
    if (root === null) {
      return
    }

    if (this.opacity < 0.02) {
      root.enabled = false
      return
    }
    root.enabled = true

    const centre = this.getTransform().getWorldPosition()
    const transform = root.getTransform()
    transform.setWorldPosition(centre)
    transform.setWorldRotation(this.facingCamera(centre))

    const cue = this.lastCue
    const registered = cue.progress >= 1
    this.setArc(registered ? SEGMENTS : Math.floor(cue.progress * SEGMENTS))

    const color = registered ? this.readyColor : this.ringColor
    tint(this.trackMaterial, this.ringColor, 0.15 * this.opacity)
    tint(this.arcMaterial, color, 0.9 * this.opacity)

    if (this.label !== null) {
      if (this.label.text !== cue.name) {
        this.label.text = cue.name
      }
      paintText(this.labelMaterial!, color, this.ringColor, this.opacity)
    }
  }

  /** Lights the first `count` segments, by rewriting only the arc's index list. */
  private setArc(count: number): void {
    if (count === this.shownSegments || this.arcBuilder === null || this.arcObject === null) {
      return
    }
    this.shownSegments = count

    if (count <= 0) {
      this.arcObject.enabled = false
      return
    }

    const builder = this.arcBuilder
    const existing = builder.getIndicesCount()
    if (existing > 0) {
      builder.eraseIndices(0, existing)
    }

    const indices: number[] = []
    for (let i = 0; i < count; i++) {
      indices.push(...segmentIndices(i))
    }
    builder.appendIndices(indices)
    builder.updateMesh()
    this.arcObject.enabled = true
  }

  /** A dot on the nearest pointing fingertip within reach of the sphere, brightening as it pokes. */
  private updateDot(wanted: boolean): void {
    const dot = this.dot
    if (dot === null) {
      return
    }

    let tip: vec3 | null = null
    let nearest = this.baseRadius * DOT_RANGE

    for (let i = 0; wanted && i < AllHandTypes.length; i++) {
      const hand = SIK.HandInputData.getHand(AllHandTypes[i])
      if (hand === null || !hand.isTracked() || hand.isPinching() || !isPointingPose(hand)) {
        continue
      }
      const position = hand.indexTip?.position
      if (position == null) {
        continue
      }
      const distance = this.reach !== null ? this.reach.distanceTo(position) : position.distance(this.getTransform().getWorldPosition())
      if (distance <= nearest) {
        nearest = distance
        tip = position
      }
    }

    if (tip === null) {
      dot.enabled = false
      return
    }

    dot.enabled = true
    const transform = dot.getTransform()
    // Nudged towards the player so it sits on the finger rather than inside it.
    const toCamera = this.camera.getWorldPosition().sub(tip)
    const lift = toCamera.length > 0.0001 ? toCamera.normalize().uniformScale(0.6) : vec3.zero()
    transform.setWorldPosition(tip.add(lift))
    transform.setWorldRotation(this.facingCamera(tip))

    const progress = this.poke !== null ? this.poke.pokeProgress : 0
    tint(this.dotMaterial, progress >= 1 ? this.readyColor : this.dotColor, 0.55 + 0.45 * progress)
  }

  /** Turns +Z, which the ring and dot are drawn facing, towards the player's head, keeping up up. */
  private facingCamera(from: vec3): quat {
    const toCamera = this.camera.getWorldPosition().sub(from)
    if (toCamera.length < 0.0001) {
      return quat.quatIdentity()
    }
    return quat.lookAt(toCamera.normalize(), vec3.up())
  }

  private hideAll(): void {
    this.opacity = 0
    if (this.root !== null) {
      this.root.enabled = false
    }
    if (this.dot !== null) {
      this.dot.enabled = false
    }
    if (this.zone !== null) {
      this.zone.enabled = false
    }
    if (this.palmDot !== null) {
      this.palmDot.enabled = false
    }
  }
}
