import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractionManager} from "../SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager"
import WorldCameraFinderProvider from "../SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

/**
 * Stretches the sphere's reach out towards the player.
 *
 * People reaching for something in AR tend to stop a few centimetres short of it, because judging
 * the depth of a virtual object is hard. So the sphere's reach is a capsule running from its centre
 * out Forward Reach radii towards the player's head, re-aimed every frame as the player moves.
 *
 * - **Hand checks.** Poke, compress, crush and the second hand of a split measure to the capsule
 *   through {@link distanceTo} and {@link nearestPoint} rather than to the centre, each keeping its
 *   own tolerance on top.
 * - **Pinch grabs.** A capsule collider of the same shape, as wide as the sphere's own grab
 *   collider, is registered with SIK as one of the sphere's colliders, so a pinch landing in front of
 *   the sphere takes hold of it. It is switched off whenever the sphere's own collider is - which is
 *   how the crush and the squish take the sphere out of play - and whenever the sphere is hidden.
 *
 * The capsule is measured from the sphere's resting size, captured at start, so a squish or a crush
 * does not shrink or stretch it.
 */
@component
export class SphereReach extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Reach</span>')

  @input
  @label("Forward Reach (radii)")
  @hint(
    "How far the sphere's reach stretches from its centre towards the player, in multiples of its \
radius. 0 leaves every check at the sphere itself."
  )
  @widget(new SliderWidget(0, 4, 0.1))
  forward: number = 2

  @input
  @label("Stretch Grab Zone")
  @hint(
    "Also stretch the pinch grab zone forward, with a capsule collider as wide as the sphere's own \
grab collider. Off stretches only the hand checks - poke, compress, crush and the split."
  )
  stretchGrab: boolean = true

  private camera = WorldCameraFinderProvider.getInstance()

  /** The sphere's resting radius in world units. Its mesh is a unit sphere. */
  private baseRadius = 0.5

  private interactable: Interactable | null = null
  private sphereCollider: ColliderComponent | null = null

  private reachObject: SceneObject | null = null
  private reachCollider: ColliderComponent | null = null
  private capsule: CapsuleShape | null = null

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())

    // The capsule lives at the scene root, so hiding the sphere does not hide it. It follows by hand.
    this.createEvent("OnEnableEvent").bind(() => this.setReachEnabled(true))
    this.createEvent("OnDisableEvent").bind(() => this.setReachEnabled(false))
  }

  private init(): void {
    const owner = this.getSceneObject()
    const scale = owner.getTransform().getWorldScale()
    this.baseRadius = Math.max(scale.x, Math.max(scale.y, scale.z)) * 0.5

    this.interactable = owner.getComponent(Interactable.getTypeName()) as Interactable
    this.sphereCollider = owner.getComponent("Physics.ColliderComponent") as ColliderComponent

    if (this.stretchGrab && this.interactable != null && this.sphereCollider != null) {
      this.buildGrabCapsule(owner, Math.max(scale.x, Math.max(scale.y, scale.z)))
    }

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** The point of the reach nearest `point`: the centre, or somewhere along its stretch forward. */
  nearestPoint(point: vec3): vec3 {
    const start = this.getTransform().getWorldPosition()
    const stretch = this.towardPlayer().uniformScale(this.length())
    const lengthSquared = stretch.dot(stretch)

    if (lengthSquared < 0.000001) {
      return start
    }

    const t = Math.max(0, Math.min(1, point.sub(start).dot(stretch) / lengthSquared))
    return start.add(stretch.uniformScale(t))
  }

  /** Distance from `point` to the reach - zero anywhere along its centre line. */
  distanceTo(point: vec3): number {
    return point.distance(this.nearestPoint(point))
  }

  private onUpdate(): void {
    if (this.reachObject === null || this.capsule === null) {
      return
    }

    const direction = this.towardPlayer()
    const length = this.length()
    const transform = this.reachObject.getTransform()

    this.capsule.length = length
    transform.setWorldPosition(this.getTransform().getWorldPosition().add(direction.uniformScale(length * 0.5)))
    transform.setWorldRotation(this.facing(direction))

    // Out of play exactly when the sphere's own grab collider is, which is how FistCrush and
    // PalmSquish take the sphere out of reach mid-move.
    this.reachCollider!.enabled = this.sphereCollider!.enabled && this.interactable!.enabled
  }

  /**
   * A capsule at the scene root, re-aimed each frame, as wide as the sphere's own collider. It is
   * added to the Interactable's colliders and the Interactable registered again, so SIK maps the new
   * collider to the sphere and treats a pinch on it as a pinch on the sphere.
   */
  private buildGrabCapsule(owner: SceneObject, largestScale: number): void {
    const own = this.sphereCollider!.shape as SphereShape
    const radius = own != null && typeof own.radius === "number" ? own.radius * largestScale : this.baseRadius * 2.2

    const reachObject = global.scene.createSceneObject(owner.name + " Reach")
    reachObject.layer = owner.layer

    const collider = reachObject.createComponent("Physics.ColliderComponent") as ColliderComponent
    const capsule = Shape.createCapsuleShape()
    capsule.axis = Axis.Z
    capsule.radius = radius
    capsule.length = this.length()
    collider.shape = capsule
    collider.intangible = this.sphereCollider!.intangible
    collider.debugDrawEnabled = this.sphereCollider!.debugDrawEnabled

    this.reachObject = reachObject
    this.reachCollider = collider
    this.capsule = capsule

    this.interactable!.colliders.push(collider)
    const manager = InteractionManager.getInstance()
    manager.deregisterInteractable(this.interactable!)
    manager.registerInteractable(this.interactable!)

    this.onUpdate()
  }

  private setReachEnabled(enabled: boolean): void {
    if (this.reachObject !== null) {
      this.reachObject.enabled = enabled
    }
  }

  private length(): number {
    return Math.max(0, this.forward) * this.baseRadius
  }

  /** Unit direction from the sphere's centre towards the player's head. */
  private towardPlayer(): vec3 {
    const offset = this.camera.getWorldPosition().sub(this.getTransform().getWorldPosition())
    return offset.length > 0.0001 ? offset.normalize() : vec3.forward()
  }

  /** Turns the capsule's Z axis onto `direction`, including the one case rotationFromTo cannot. */
  private facing(direction: vec3): quat {
    if (direction.dot(vec3.forward()) < -0.9999) {
      return quat.angleAxis(Math.PI, vec3.up())
    }
    return quat.rotationFromTo(vec3.forward(), direction)
  }
}
