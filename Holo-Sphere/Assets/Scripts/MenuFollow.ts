import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import WorldCameraFinderProvider from "../SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {addVisual, makePiece, newLineMaterial, tint} from "./NeonKit"
import {newBuilder, outline, quad} from "./RetroMenuStyle"

/** Height of the grab bar, in cm. Its collider is a good deal bigger, so it is easy to aim at. */
const BAR_HEIGHT = 1.2

/** Closest and furthest a panel can be dragged to, and how far above or below the eyes. */
const MIN_DISTANCE = 35
const MAX_DISTANCE = 200
const MAX_HEIGHT = 60

/** Degrees off square at which a turn to face the player is done. */
const TURN_DONE = 2

/** Centimetres from its spot at which a glide after the player is done. */
const GLIDE_DONE = 1

/**
 * Keeps a panel where the player can use it, however they move.
 *
 * - **Placed.** Each time it appears it comes up in front of the player, Distance away and Height
 *   above or below their eyes, turned to face them.
 * - **Follows.** Walk more than Follow After away from where it should be and it glides after the
 *   player, back to its distance from them in the same direction.
 * - **Turns.** Move more than Turn After round to its side and it turns to face the player again.
 * - **Dragged.** A neon grab bar under the panel moves it with a pinch, like any SIK object. Where it
 *   is dropped becomes its distance and height from then on; it turns to face the player once let go.
 *
 * The grab bar is its own object rather than the panel itself, so pinching a button presses the
 * button and never drags the panel.
 */
@component
export class MenuFollow extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Placement</span>')

  @input
  @label("Distance (cm)")
  @hint("How far in front of the player the panel sits, until they drag it somewhere else.")
  @widget(new SliderWidget(35, 200, 1))
  distance: number = 70

  @input
  @label("Height (cm)")
  @hint("How far above (+) or below (-) the player's eyes the panel sits, until they drag it somewhere else.")
  @widget(new SliderWidget(-60, 60, 1))
  height: number = -10

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Follow</span>')

  @input
  @label("Follow After (cm)")
  @hint("How far the player can move from where the panel should be before it glides after them.")
  @widget(new SliderWidget(10, 200, 5))
  followAfter: number = 50

  @input
  @label("Turn After (deg)")
  @hint("How far round to the panel's side the player can move before it turns to face them.")
  @widget(new SliderWidget(5, 90, 1))
  turnAfter: number = 30

  @input
  @label("Glide Time (s)")
  @hint("Roughly how long a glide or turn takes.")
  @widget(new SliderWidget(0.1, 2, 0.05))
  glideTime: number = 0.5

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Grab Bar</span>')

  @input
  @label("Draggable")
  @hint("Show a grab bar under the panel that moves it with a pinch.")
  draggable: boolean = true

  @input
  @label("Line Material")
  @hint("Unlit material the grab bar is drawn with. Assets/Neon Line.mat, the same as the menus.")
  @allowUndefined
  lineMaterial: Material | null = null

  @input
  @label("Bar Width (cm)")
  @widget(new SliderWidget(4, 40, 0.5))
  barWidth: number = 12

  @input
  @label("Bar Height (cm)")
  @hint("Where the grab bar sits, up from the panel's centre. Negative puts it below.")
  @widget(new SliderWidget(-60, 60, 0.5))
  barOffset: number = -30

  @input("vec4", "{0, 0.95, 1, 1}")
  @label("Bar Colour")
  @widget(new ColorWidget())
  barColor: vec4 = new vec4(0, 0.95, 1, 1)

  private camera = WorldCameraFinderProvider.getInstance()

  /** The distance and height the panel keeps from the player: Distance and Height, until dragged. */
  private preferredDistance = 70
  private preferredHeight = -10

  private started = false
  private gliding = false
  private turning = false
  private dragging = false
  private barHovered = false

  private barMaterial: Material | null = null
  private barEdgeMaterial: Material | null = null

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
    this.createEvent("OnEnableEvent").bind(() => {
      if (this.started) {
        this.placeInFront()
      }
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private init(): void {
    this.started = true
    this.preferredDistance = this.distance
    this.preferredHeight = this.height
    this.buildBar()
    this.placeInFront()
  }

  /** Straight in front of the player, at the panel's distance and height, facing them. */
  private placeInFront(): void {
    const transform = this.getTransform()
    const position = this.spotAlong(this.viewDirection())
    transform.setWorldPosition(position)
    transform.setWorldRotation(this.facing(position))

    this.gliding = false
    this.turning = false
    this.barHovered = false
    this.paintBar()
  }

  private onUpdate(): void {
    if (!this.started || this.dragging) {
      return
    }

    const transform = this.getTransform()
    const eye = this.camera.getWorldPosition()
    const position = transform.getWorldPosition()
    const offset = position.sub(eye)
    const flat = new vec3(offset.x, 0, offset.z)

    const strayed =
      Math.abs(flat.length - this.preferredDistance) > this.followAfter ||
      Math.abs(offset.y - this.preferredHeight) > this.followAfter
    if (strayed) {
      this.gliding = true
    }

    const blend = 1 - Math.exp((-getDeltaTime() * 4) / Math.max(0.05, this.glideTime))

    if (this.gliding) {
      // Keeps the direction it is in from the player, and comes back to its distance along it.
      const direction = flat.length > 0.001 ? flat.normalize() : this.viewDirection()
      const target = this.spotAlong(direction)
      const next = vec3.lerp(position, target, blend)
      transform.setWorldPosition(next)
      if (next.distance(target) < GLIDE_DONE) {
        this.gliding = false
      }
    }

    const current = transform.getWorldPosition()
    const wanted = this.facing(current)
    const offSquare = this.angleOffSquare(transform, current)
    if (offSquare > this.turnAfter || this.gliding) {
      this.turning = true
    }

    if (this.turning) {
      transform.setWorldRotation(quat.slerp(transform.getWorldRotation(), wanted, blend))
      if (offSquare < TURN_DONE && !this.gliding) {
        this.turning = false
      }
    }
  }

  /** The panel's spot along a flat direction from the player: its distance out, its height up. */
  private spotAlong(direction: vec3): vec3 {
    return this.camera
      .getWorldPosition()
      .add(direction.uniformScale(this.preferredDistance))
      .add(vec3.up().uniformScale(this.preferredHeight))
  }

  /** Where the player is looking, flattened onto the floor. */
  private viewDirection(): vec3 {
    // The camera looks down its -Z, which is its back.
    const back = this.camera.back()
    const flat = new vec3(back.x, 0, back.z)
    return flat.length > 0.001 ? flat.normalize() : new vec3(0, 0, -1)
  }

  /** Turns the panel's front, +Z, towards the player's eyes, keeping up up. */
  private facing(position: vec3): quat {
    const toEye = this.camera.getWorldPosition().sub(position)
    if (toEye.length < 0.001) {
      return quat.quatIdentity()
    }
    return quat.lookAt(toEye.normalize(), vec3.up())
  }

  /** Degrees between the panel's front and the direction to the player's eyes. */
  private angleOffSquare(transform: Transform, position: vec3): number {
    const toEye = this.camera.getWorldPosition().sub(position)
    if (toEye.length < 0.001) {
      return 0
    }
    const dot = Math.max(-1, Math.min(1, transform.forward.dot(toEye.normalize())))
    return (Math.acos(dot) * 180) / Math.PI
  }

  // ---- Grab bar ----

  private buildBar(): void {
    if (!this.draggable) {
      return
    }
    if (this.lineMaterial == null) {
      print("MenuFollow: no Line Material on " + this.getSceneObject().name + ", it will not have a grab bar.")
      return
    }

    const bar = global.scene.createSceneObject("Grab Bar")
    bar.setParent(this.getSceneObject())
    bar.layer = this.getSceneObject().layer
    bar.getTransform().setLocalPosition(new vec3(0, this.barOffset, 0.1))

    const width = this.barWidth
    const fill = newBuilder()
    quad(fill, -width / 2, -BAR_HEIGHT / 2, width / 2, BAR_HEIGHT / 2)
    this.barMaterial = addVisual(bar, fill, newLineMaterial(this.lineMaterial))

    const edge = newBuilder()
    outline(edge, 0, 0, width + 0.8, BAR_HEIGHT + 0.8, 0.15)
    this.barEdgeMaterial = makePiece("Grab Bar Edge", bar, edge, 0.02, newLineMaterial(this.lineMaterial))

    // Collider before Interactable: SIK looks for the bar's colliders as the Interactable wakes.
    const collider = bar.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(width + 4, BAR_HEIGHT + 4, 2)
    collider.shape = shape
    collider.fitVisual = false

    const interactable = bar.createComponent(Interactable.getTypeName()) as Interactable
    interactable.onHoverEnter.add(() => {
      this.barHovered = true
      this.paintBar()
    })
    interactable.onHoverExit.add(() => {
      this.barHovered = false
      this.paintBar()
    })

    // Moves the whole panel, never turns or resizes it: it turns itself to face the player on release.
    const manipulation = bar.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    manipulation.setManipulateRoot(this.getTransform())
    manipulation.setCanRotate(false)
    manipulation.setCanScale(false)
    manipulation.onManipulationStart.add(() => this.startDrag())
    manipulation.onManipulationEnd.add(() => this.endDrag())

    this.paintBar()
  }

  private startDrag(): void {
    this.dragging = true
    this.gliding = false
    this.turning = false
    this.paintBar()
  }

  /** Wherever it was dropped becomes the distance and height it keeps from the player. */
  private endDrag(): void {
    this.dragging = false

    const offset = this.getTransform().getWorldPosition().sub(this.camera.getWorldPosition())
    const flat = new vec3(offset.x, 0, offset.z)
    this.preferredDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, flat.length))
    this.preferredHeight = Math.max(-MAX_HEIGHT, Math.min(MAX_HEIGHT, offset.y))

    this.turning = true
    this.paintBar()
  }

  private paintBar(): void {
    const alpha = this.dragging ? 0.95 : this.barHovered ? 0.75 : 0.45
    tint(this.barMaterial, this.barColor, alpha)
    tint(this.barEdgeMaterial, this.barColor, alpha * 0.8)
  }
}
