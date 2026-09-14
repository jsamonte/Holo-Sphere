import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {Interactor, TargetingMode} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {Tune, tuned} from "./GestureTuning"
import {StrobeGhostTrail} from "./StrobeGhostTrail"

/**
 * Seconds of position history used to measure a flick. Long enough to survive a dropped frame,
 * short enough that the number still describes "right now" rather than the whole drag.
 */
const VELOCITY_WINDOW = 0.1

/**
 * Seconds after a pinch starts before a flick can fire. The hand-off into a grab moves the
 * sphere a little on its own, and without this that settling motion reads as a throw.
 */
const ARM_DELAY = 0.15

/**
 * Seconds after a throw that the hand's speed still counts towards {@link YoyoFlick.measuredSpeed}:
 * the swing carries on after the sphere has left the hand.
 */
const MEASURE_TAIL = 0.25

/**
 * How much of the hand's motion has to oppose the throw direction to count as calling the
 * sphere home. Slightly negative rather than zero so a hand drifting sideways does not
 * accidentally trip the return.
 */
const RETURN_FLICK_DOT = -0.1

/**
 * Below this the flick velocity has no meaningful direction, so there is nothing to throw along.
 */
const MIN_FLICK_LENGTH = 0.0001

/**
 * Where the sphere is in the yoyo cycle.
 */
enum YoyoState {
  /** Not pinched, not flying. The sphere just sits wherever it was left. */
  Idle,
  /** Pinched and dragged normally by InteractableManipulation, watching for a flick. */
  Held,
  /** Flying out to full extension after a flick. */
  Throwing,
  /** Hanging at full extension, waiting to be called back. */
  Extended,
  /** Flying home to the pinch. */
  Returning
}

/**
 * Sliding-window velocity of a point, in world units per second.
 *
 * A flick is a burst, so velocity is measured across the last {@link VELOCITY_WINDOW} seconds
 * rather than a single frame - one frame is noisy enough that a slow drag can spike over any
 * useful threshold.
 */
export class VelocityTracker {
  private positions: vec3[] = []
  private times: number[] = []

  reset(): void {
    this.positions = []
    this.times = []
  }

  add(position: vec3, time: number): void {
    this.positions.push(position)
    this.times.push(time)

    // Keep at least two samples so there is always something to differentiate.
    while (this.times.length > 2 && time - this.times[0] > VELOCITY_WINDOW) {
      this.positions.shift()
      this.times.shift()
    }
  }

  velocity(): vec3 {
    if (this.times.length < 2) {
      return vec3.zero()
    }

    const elapsed = this.times[this.times.length - 1] - this.times[0]
    if (elapsed <= 0) {
      return vec3.zero()
    }

    return this.positions[this.positions.length - 1].sub(this.positions[0]).uniformScale(1 / elapsed)
  }
}

function easeOutCubic(t: number): number {
  const inverse = 1 - t
  return 1 - inverse * inverse * inverse
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Turns the sphere into a yoyo.
 *
 * Pinch it and flick, and it shoots out along the flick to the end of its "string". Tug your
 * hand back, or just let go, and it flies home to the pinch - to your hand if you are still
 * holding on, or to the spot you were holding when you released.
 *
 * While the sphere is out, the anchor it hangs from and returns to tracks your hand one to one,
 * so the string stays attached to you rather than to a fixed point in the room. Release freezes
 * that anchor, which is what makes a released sphere come back to the *last* pinch location.
 *
 * Ownership of the transform is handed back and forth with InteractableManipulation: it drags
 * the sphere while the sphere is in hand, and this script drives it for the whole flight, with
 * translation switched off on the manipulation for the duration so the two never fight over the
 * same transform.
 *
 * The strobe is held on for the entire cycle, not just while pinched, so the RGB trail keeps
 * running through the throw and the return even after the pinch is released.
 *
 * Expects an Interactable on the same SceneObject, and works best alongside
 * InteractableManipulation and StrobeGhostTrail, all of which it finds itself.
 */
@component
export class YoyoFlick extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Throw</span>')

  /**
   * Length of the string, in world units. Lens Studio world units are centimetres, so the
   * default 200 is the requested 2 metres.
   */
  @input
  @label("Throw Distance (cm)")
  @hint("How far out the sphere flies on a flick. 200 = 2 metres.")
  @widget(new SliderWidget(20, 500, 10))
  throwDistance: number = 200

  /**
   * How fast the pinched sphere, or the hand pinching it, has to be moving for the motion to read
   * as a flick rather than a drag. Lower is easier to trigger, but starts firing on ordinary hand
   * movement. GestureTuning can make it easier for a player, never harder.
   */
  @input
  @label("Flick Speed (cm/s)")
  @hint("How fast the pinched sphere, or the hand pinching it, has to move to count as a flick. Lower triggers more easily.")
  @widget(new SliderWidget(20, 300, 5))
  flickSpeed: number = 90

  /**
   * Seconds to cover the throw distance. The sphere decelerates into full extension, the way a
   * yoyo runs out of string.
   */
  @input
  @label("Throw Time (s)")
  @hint("Seconds to reach full extension. Shorter is snappier.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  throwTime: number = 0.4

  /**
   * Keeps the far end of the string tied to your hand while the sphere is out, so moving your
   * hand carries the extended sphere with it. Turn off to leave the thrown sphere parked in the
   * room until it is called back.
   */
  @input
  @label("Follow Hand")
  @hint("While the sphere is out, keep it hanging off your hand so moving your hand carries it. Off leaves it parked in place.")
  followHand: boolean = true

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Return</span>')

  /**
   * Seconds to fly home. The return eases in and out so it leaves cleanly and lands softly
   * rather than slamming into the hand.
   */
  @input
  @label("Return Time (s)")
  @hint("Seconds to fly home to the pinch.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  returnTime: number = 0.35

  /**
   * How fast the hand has to tug back to call the sphere home while still pinching. Only hand
   * tracking reports a moving pinch point, so in the editor's mouse preview the return is
   * triggered by releasing instead.
   */
  @input
  @label("Return Flick Speed (cm/s)")
  @hint(
    "How fast your hand has to tug back to call the sphere home while you are still pinching. \
Releasing the pinch always returns it."
  )
  @widget(new SliderWidget(10, 300, 5))
  returnFlickSpeed: number = 60

  private interactable: Interactable | null = null
  private manipulation: InteractableManipulation | null = null
  private strobe: StrobeGhostTrail | null = null
  private tf: Transform | null = null

  private state: YoyoState = YoyoState.Idle

  /** Set while another script owns the sphere, which stops the yoyo throwing or flying. */
  private suspended = false

  /** The interactor currently pinching, or null when nothing is holding the sphere. */
  private activeInteractor: Interactor | null = null

  private sphereTracker = new VelocityTracker()
  private handTracker = new VelocityTracker()

  /** Where the sphere was when the flick fired, and where the flight is measured from. */
  private launchPosition: vec3 = vec3.zero()

  /** Position the sphere flies home to. Follows the hand while pinched, frozen once released. */
  private anchor: vec3 = vec3.zero()

  /** The anchor before any hand movement was added to it. */
  private anchorBase: vec3 = vec3.zero()

  /** Pinch position at the moment of the flick, which hand movement is measured against. */
  private handReference: vec3 | null = null

  /** Unit direction of the flick, and so of the string. */
  private outDirection: vec3 = vec3.forward()

  private returnStart: vec3 = vec3.zero()
  private flightTime = 0
  private heldTime = 0

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    this.tf = this.getTransform()

    this.interactable = this.getSceneObject().getComponent(Interactable.getTypeName())
    if (this.interactable === null) {
      print("YoyoFlick: no Interactable on " + this.getSceneObject().name + ", disabling.")
      this.enabled = false
      return
    }

    // Both are optional: without manipulation the sphere can still be flicked, it just cannot be
    // dragged, and without the strobe the yoyo simply runs without the RGB trail.
    this.manipulation = this.getSceneObject().getComponent(InteractableManipulation.getTypeName())
    this.strobe = this.getSceneObject().getComponent(StrobeGhostTrail.getTypeName())

    this.interactable.onTriggerStart.add((event) => this.onPinchStart(event.interactor))
    this.interactable.onTriggerEnd.add(() => this.onPinchEnd())
    this.interactable.onTriggerEndOutside.add(() => this.onPinchEnd())
    this.interactable.onTriggerCanceled.add(() => this.onPinchEnd())

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onPinchStart(interactor: Interactor): void {
    this.activeInteractor = interactor
    this.handTracker.reset()

    // Catching the sphere mid-flight is just a grab: the flight is abandoned and the sphere
    // stays where it was caught.
    this.enterHeld()
  }

  private onPinchEnd(): void {
    this.activeInteractor = null

    // Letting go mid-flight is one of the two ways to call the sphere home. The anchor stops
    // tracking the hand from here, so it returns to the last place the pinch was.
    if (this.state === YoyoState.Throwing || this.state === YoyoState.Extended) {
      this.startReturn()
      return
    }

    if (this.state === YoyoState.Held) {
      this.state = YoyoState.Idle
    }
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()
    const now = getTime()

    this.sphereTracker.add(this.tf!.getWorldPosition(), now)

    const handPoint = this.getPinchPoint()
    if (handPoint !== null) {
      this.handTracker.add(handPoint, now)
    }

    switch (this.state) {
      case YoyoState.Held:
        this.updateHeld(deltaTime)
        break
      case YoyoState.Throwing:
        this.updateThrowing(deltaTime, handPoint)
        break
      case YoyoState.Extended:
        this.updateExtended(handPoint)
        break
      case YoyoState.Returning:
        this.updateReturning(deltaTime, handPoint)
        break
      default:
        break
    }
  }

  private updateHeld(deltaTime: number): void {
    this.heldTime += deltaTime
    if (this.heldTime < ARM_DELAY) {
      return
    }

    const velocity = this.flickVelocity()
    if (velocity.length >= this.flickThreshold()) {
      this.throwOut(velocity)
    }
  }

  private updateThrowing(deltaTime: number, handPoint: vec3 | null): void {
    this.updateAnchor(handPoint)

    this.flightTime += deltaTime
    const t = Math.min(this.flightTime / Math.max(0.05, this.throwTime), 1)
    this.tf!.setWorldPosition(vec3.lerp(this.launchPosition, this.fullExtension(), easeOutCubic(t)))

    if (t >= 1) {
      this.state = YoyoState.Extended
      return
    }

    this.checkReturnFlick()
  }

  private updateExtended(handPoint: vec3 | null): void {
    this.updateAnchor(handPoint)
    this.tf!.setWorldPosition(this.fullExtension())
    this.checkReturnFlick()
  }

  private updateReturning(deltaTime: number, handPoint: vec3 | null): void {
    // Still tracked while returning, so a sphere called back mid-pinch lands on the hand where
    // it actually is by the time it arrives rather than where it was when the return started.
    this.updateAnchor(handPoint)

    this.flightTime += deltaTime
    const t = Math.min(this.flightTime / Math.max(0.05, this.returnTime), 1)
    this.tf!.setWorldPosition(vec3.lerp(this.returnStart, this.anchor, easeInOutCubic(t)))

    if (t >= 1) {
      this.settle()
    }
  }

  /**
   * Where the far end of the string currently is: the anchor, pushed out along the flick.
   */
  private fullExtension(): vec3 {
    return this.anchor.add(this.outDirection.uniformScale(this.throwDistance))
  }

  /**
   * Carries the anchor along with the hand, so the string stays attached to you for as long as
   * you keep pinching. Once the pinch ends there is no interactor left and the anchor holds its
   * last value - the last pinch location.
   */
  private updateAnchor(handPoint: vec3 | null): void {
    if (!this.followHand || this.activeInteractor === null || handPoint === null || this.handReference === null) {
      return
    }

    this.anchor = this.anchorBase.add(handPoint.sub(this.handReference))
  }

  private enterHeld(): void {
    this.state = YoyoState.Held
    this.heldTime = 0

    // The flight was script-driven, so the position history describes the flight rather than the
    // hand. Starting clean stops a fast return from immediately reading as a new flick - and the
    // hand's history holds the tug that called it back, which must not read as one either.
    this.sphereTracker.reset()
    this.handTracker.reset()

    // Skipped while suspended: something else is driving the transform, and handing translation
    // back to the manipulation now would have the two of them fighting over it.
    if (!this.suspended) {
      this.setManipulationTranslation(true)
    }
    this.setStrobeHold(false)
  }

  private throwOut(velocity: vec3): void {
    if (this.suspended) {
      return
    }

    if (velocity.length < MIN_FLICK_LENGTH) {
      return
    }

    this.outDirection = velocity.normalize()
    this.launchPosition = this.tf!.getWorldPosition()

    // The pinch location at the moment of the flick is both the far end of the string's origin
    // and the place the sphere will come home to.
    this.anchorBase = this.launchPosition
    this.anchor = this.launchPosition
    this.handReference = this.getPinchPoint()

    this.flightTime = 0
    this.state = YoyoState.Throwing

    // Hand the transform over for the flight, and keep the strobe running through it.
    this.setManipulationTranslation(false)
    this.setStrobeHold(true)
    this.handTracker.reset()
  }

  /**
   * A tug of the hand that opposes the throw calls the sphere home while it is still pinched.
   */
  private checkReturnFlick(): void {
    if (this.activeInteractor === null) {
      return
    }

    const velocity = this.handTracker.velocity()
    if (velocity.length < tuned(Tune.ReturnFlickSpeed, this.returnFlickSpeed)) {
      return
    }

    if (velocity.normalize().dot(this.outDirection) > RETURN_FLICK_DOT) {
      return
    }

    this.startReturn()
  }

  private startReturn(): void {
    this.returnStart = this.tf!.getWorldPosition()
    this.flightTime = 0
    this.state = YoyoState.Returning
    this.setStrobeHold(true)
    this.handTracker.reset()
  }

  private settle(): void {
    this.tf!.setWorldPosition(this.anchor)

    if (this.activeInteractor !== null) {
      // Landed back in a hand that is still pinching, so it goes straight back to being held and
      // can be thrown again. The strobe stays lit off the pinch itself from here.
      this.enterHeld()
      return
    }

    this.state = YoyoState.Idle
    this.setManipulationTranslation(true)
    this.setStrobeHold(false)
  }

  /**
   * Where the pinch currently is. A direct pinch happens at the fingertips, which is what
   * endPoint reports; an indirect pinch has no fingertip on the sphere, so the interactor's own
   * origin by the hand stands in. Same rule InteractableManipulation uses to pick its anchor,
   * so the two agree on where the hand is.
   */

  /**
   * Stands the yoyo down while something else owns the sphere - the two handed split, in practice,
   * which drives the transform itself and would be fighting a flight for it otherwise. A flight
   * already in the air is abandoned where it is rather than allowed to finish.
   */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) {
      return
    }
    this.suspended = suspended

    if (suspended) {
      if (this.isFlying()) {
        // Translation goes back to its resting state before handing over, so whatever suspended
        // the yoyo sees the sphere as an idle one would have left it.
        this.setManipulationTranslation(true)
        this.setStrobeHold(false)
      }

      this.state = this.activeInteractor !== null ? YoyoState.Held : YoyoState.Idle
    }

    // Cleared in both directions. The motion on either side of a suspension is another script
    // driving the sphere, and it would otherwise read as a flick the moment the yoyo is back.
    this.heldTime = 0
    this.sphereTracker.reset()
    this.handTracker.reset()
  }

  /**
   * True while the sphere is out on the string rather than sitting in hand.
   */
  isFlying(): boolean {
    return (
      this.state === YoyoState.Throwing || this.state === YoyoState.Extended || this.state === YoyoState.Returning
    )
  }

  /** True while the sphere is pinched and in hand, where a flick can throw it. */
  isHeld(): boolean {
    return this.state === YoyoState.Held
  }

  /**
   * How close the sphere in hand is to being flicked, for GestureCues: its speed as a fraction of the
   * flick speed, and 1 as it is thrown.
   */
  get flickProgress(): number {
    if (this.state === YoyoState.Throwing) {
      return 1
    }
    if (this.state !== YoyoState.Held || this.heldTime < ARM_DELAY) {
      return 0
    }
    return Math.min(0.99, this.flickVelocity().length / Math.max(1, this.flickThreshold()))
  }

  /**
   * The speed a flick is judged on, for CalibrationMode to measure: while in hand, the one compared
   * with Flick Speed; for a moment after a throw, the hand's own, since the swing carries on after
   * the sphere has left it. 0 otherwise.
   */
  measuredSpeed(): number {
    if (this.state === YoyoState.Held) {
      return this.flickVelocity().length
    }
    if (this.state === YoyoState.Throwing && this.flightTime <= MEASURE_TAIL) {
      return this.handTracker.velocity().length
    }
    return 0
  }

  /** Flick Speed, scaled to the player by GestureTuning. */
  private flickThreshold(): number {
    return tuned(Tune.FlickSpeed, this.flickSpeed)
  }

  /**
   * The faster of the sphere and the hand pinching it. The sphere follows the hand through the
   * manipulation's smoothing, which takes the edge off a quick flick, so the hand's own speed counts
   * as well.
   */
  private flickVelocity(): vec3 {
    const sphere = this.sphereTracker.velocity()
    const hand = this.handTracker.velocity()
    return hand.length > sphere.length ? hand : sphere
  }

  private getPinchPoint(): vec3 | null {
    if (this.activeInteractor === null) {
      return null
    }

    if ((this.activeInteractor.activeTargetingMode & TargetingMode.Direct) !== 0) {
      return this.activeInteractor.endPoint ?? this.activeInteractor.startPoint ?? null
    }

    return this.activeInteractor.startPoint ?? null
  }

  /**
   * Translation is switched off on the manipulation for the duration of a flight so it does not
   * write to the same transform this script is driving. Switching it back on mid-pinch needs the
   * manipulation to re-read the sphere's position, or it would snap the sphere back to where the
   * drag left off.
   */
  private setManipulationTranslation(enabled: boolean): void {
    if (this.manipulation === null) {
      return
    }

    this.manipulation.setCanTranslate(enabled)

    if (enabled && this.manipulation.isManipulating()) {
      this.manipulation.updateStartTransform()
    }
  }

  private setStrobeHold(hold: boolean): void {
    if (this.strobe === null) {
      return
    }
    this.strobe.setExternalHold(hold)
  }
}
