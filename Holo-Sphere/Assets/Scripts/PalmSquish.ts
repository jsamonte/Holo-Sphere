import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorInputType} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import TrackedHand, {PalmState} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {CrushPhase, FistCrush} from "./FistCrush"
import {isIndexExtended} from "./HandPose"
import {SphereReach} from "./SphereReach"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

export enum SquishPhase {
  /** Round, waiting for two flat hands either side of it. */
  Idle,
  /** Held between the palms, flattening as they close. */
  Squishing,
  /** Springing back to round with a jelly wobble. */
  Recovering
}

/** Where the two palms are, as far as the squish is concerned. */
interface PalmPair {
  /** Space between the palms' skin, in world units. */
  gap: number
  /** Distance between the palm centres themselves. */
  span: number
  /** Unit direction from the left palm to the right, always leaning upwards. */
  axis: vec3
  /** Midway between the palms. */
  middle: vec3
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Squish the sphere between two flat hands.
 *
 * Open both hands flat either side of the sphere and bring them together. From the moment the
 * palms reach its surface the sphere flattens between them: its squash axis is turned onto the line
 * between the palms, its height is set by the gap between them, and it spreads sideways as it goes,
 * so its surface stays on the hands however they close, tilt or move. Pressed right together it is
 * a thin pancake. Pull the hands apart and it springs back to round with a jelly wobble.
 *
 * Bringing two flat hands together right where the sphere is squishes it too, straight to flat -
 * the hands do not have to start either side of it.
 *
 * SIK already classifies an open hand: {@link PalmState} reports `Flat` for a flat palm, the same
 * source FistCrush reads `Closed` from. It is strict - the fingers nearly straight - so the squish
 * is forgiving about it: a hand that was flat a moment ago still counts, and once a squish is under
 * way anything short of a fist keeps it going. Tracking that drops out briefly, as it does when two
 * hands press together and hide each other from the cameras, is ridden through rather than ending
 * the squish, and a new squish can start while the last one is still wobbling.
 *
 * It keeps out of the sphere's other moves. It will not start while the sphere is being pinched,
 * split, thrown on the yoyo or crushed; while it runs the sphere's collider and Interactable are
 * switched off so nothing can grab it mid-squish; and a fist closing on it hands straight over to
 * FistCrush, which then owns the sphere's scale and interactivity until it has restored it.
 */
@component
export class PalmSquish extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Trigger</span>')

  @input
  @label("Reach")
  @hint(
    "How close each flat palm has to be to the sphere's centre for a squish to start, as a multiple \
of the sphere's radius."
  )
  @widget(new SliderWidget(1, 5, 0.1))
  reach: number = 2.5

  @input
  @label("Palm Padding (cm)")
  @hint(
    "Distance from a tracked palm centre out to the skin of the palm. The sphere's surface is kept \
this far from each palm centre, so it looks pressed against the hand rather than sunk into it."
  )
  @widget(new SliderWidget(0, 4, 0.1))
  palmPadding: number = 1

  @input
  @label("Flat Memory (s)")
  @hint(
    "How recently each hand must have read as flat for a squish to start. SIK only counts a hand as \
flat with the fingers nearly straight, so this lets a relaxed open hand that was flat a moment ago \
still start one."
  )
  @widget(new SliderWidget(0, 2, 0.05))
  flatMemory: number = 0.6

  @input
  @label("Tracking Grace (s)")
  @hint(
    "How long a squish holds its shape if hand tracking drops out mid-squish - which happens when \
two hands pressed together hide each other from the cameras - before letting go."
  )
  @widget(new SliderWidget(0, 1, 0.05))
  trackingGrace: number = 0.25

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Shape</span>')

  @input
  @label("Flattest")
  @hint("How flat the sphere gets with the palms pressed together, as a fraction of its height. 0.15 is a thin pancake.")
  @widget(new SliderWidget(0.05, 0.9, 0.01))
  flattest: number = 0.15

  @input
  @label("Bulge")
  @hint("How far the sphere spreads sideways as it flattens. 1 keeps its volume; 0 flattens without spreading.")
  @widget(new SliderWidget(0, 1, 0.05))
  bulge: number = 0.7

  @input
  @label("Follow Hands")
  @hint("Keep the sphere centred between the palms while it is being squished.")
  followHands: boolean = true

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Spring Back</span>')

  @input
  @label("Stiffness")
  @hint("How hard the sphere springs back to round. Higher is snappier and wobbles faster.")
  @widget(new SliderWidget(20, 600, 5))
  stiffness: number = 220

  @input
  @label("Wobble Damping")
  @hint("How quickly the wobble dies away. Lower wobbles for longer, higher settles almost at once.")
  @widget(new SliderWidget(1, 40, 0.5))
  damping: number = 9

  @input
  @label("Debug Log")
  @hint(
    "Print both hands' tracking, palm state and distances twice a second, to work out why a squish \
is or is not starting. Leave off for a shipping build."
  )
  debugLog: boolean = false

  private phase: SquishPhase = SquishPhase.Idle

  /** Round scale, captured before anything squashes it so springing back is always exact. */
  private baseScale: vec3 = vec3.one()

  /** Height as a fraction of round: 1 is round, below is squashed, above is the wobble's stretch. */
  private squash = 1
  private squashVelocity = 0

  /** Line the sphere is squashed along. Kept after release so the wobble plays out on it. */
  private axis: vec3 = vec3.up()

  private collider: ColliderComponent | null = null
  private interactable: Interactable | null = null
  private crush: FistCrush | null = null
  private yoyo: YoyoFlick | null = null
  private split: TwoHandSplit | null = null
  private sphereReach: SphereReach | null = null

  private logTimer = 0

  /** Seconds tracking has been missing during the current squish. */
  private lostTimer = 0

  /** The last moment each hand read Flat, keyed by hand type. */
  private lastFlatTime = new Map<string, number>()

  /** Where the sphere is in the squish. */
  get squishPhase(): SquishPhase {
    return this.phase
  }

  /** How squashed the sphere is right now: 0 round, 1 as flat as Flattest allows. */
  get squishAmount(): number {
    return clamp((1 - this.squash) / Math.max(0.01, 1 - this.flattest), 0, 1)
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())

    // The menu hides the sphere between runs. It must not come back still squashed.
    this.createEvent("OnDisableEvent").bind(() => this.snapRound())
  }

  private init(): void {
    const owner = this.getSceneObject()

    this.baseScale = owner.getTransform().getLocalScale()
    this.collider = owner.getComponent("Component.ColliderComponent")
    this.interactable = owner.getComponent(Interactable.getTypeName()) as Interactable
    this.crush = owner.getComponent(FistCrush.getTypeName()) as FistCrush
    this.yoyo = owner.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.split = owner.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit
    this.sphereReach = owner.getComponent(SphereReach.getTypeName()) as SphereReach

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()
    this.rememberFlatPalms()

    switch (this.phase) {
      case SquishPhase.Idle:
        this.watchForPalms(deltaTime)
        break
      case SquishPhase.Squishing:
        this.updateSquish(deltaTime)
        break
      case SquishPhase.Recovering:
        this.updateRecover(deltaTime)
        break
    }
  }

  private watchForPalms(deltaTime: number): void {
    if (this.debugLog) {
      this.logTimer += deltaTime
      if (this.logTimer >= 0.5) {
        this.logTimer = 0
        this.logHands()
      }
    }

    this.tryStart()
  }

  /**
   * Starts a squish if two open hands are at the sphere - either side of it, or pressed together
   * right where it is - no further apart than it is wide. Also checked while the sphere is still
   * wobbling from the last squish, so squishing it again straight away is not ignored.
   */
  private tryStart(): boolean {
    if (this.isBusy()) {
      return false
    }

    const pair = this.palmPair(false)

    // Starts at contact: the palms no further apart than the sphere is wide.
    if (pair === null || pair.gap > this.diameter() * 1.1) {
      return false
    }

    // Picked up mid-wobble, the sphere keeps its current line so it does not visibly jump.
    if (this.phase === SquishPhase.Idle) {
      this.axis = pair.axis
    }
    this.squashVelocity = 0
    this.lostTimer = 0
    this.phase = SquishPhase.Squishing

    // Out of play for the whole squish, so a flat hand that also reads as a pinch cannot grab,
    // throw or split a sphere that is being pressed flat.
    this.setInteractive(false)
    return true
  }

  private updateSquish(deltaTime: number): void {
    if (this.crushTookOver()) {
      return
    }

    const pair = this.palmPair(true)

    // Pulled apart: a little further than where it started, so hands hovering at the surface do
    // not flicker the squish on and off.
    if (pair !== null && pair.gap > this.diameter() * 1.4) {
      this.release()
      return
    }

    // Two hands pressed together hide each other from the cameras, so tracking drops out for a
    // frame or two mid-squish. The shape is held through a short gap rather than let go at once.
    if (pair === null) {
      this.lostTimer += deltaTime
      if (this.lostTimer > this.trackingGrace) {
        this.release()
      }
      return
    }
    this.lostTimer = 0

    const target = clamp(pair.gap / this.diameter(), this.flattest, 1)

    // Palm tracking jitters a little. A quick ease keeps the surface on the palms without it
    // visibly shaking.
    this.squash += (target - this.squash) * Math.min(1, deltaTime * 25)

    // Pressed right together, the palm centres are only a few centimetres apart and the line
    // between them swings with every wobble of tracking. So the squash line is eased towards it,
    // and left where it is once they are too close to give a direction at all.
    if (pair.span > 2) {
      this.axis = vec3.lerp(this.axis, pair.axis, Math.min(1, deltaTime * 12)).normalize()
    }

    if (this.followHands) {
      const transform = this.getTransform()
      const position = transform.getWorldPosition()
      transform.setWorldPosition(vec3.lerp(position, pair.middle, Math.min(1, deltaTime * 20)))
    }

    this.applyShape()
  }

  /**
   * A damped spring pulls the height back to round. Released from flat it overshoots into a stretch
   * along the same line, then squashes again, a couple of times over before it settles - the jelly
   * wobble. Stepped in small pieces so a long frame cannot throw it off.
   */
  private updateRecover(deltaTime: number): void {
    if (this.crushTookOver() || this.tryStart()) {
      return
    }

    const steps = 4
    const h = deltaTime / steps
    for (let i = 0; i < steps; i++) {
      const accel = -this.stiffness * (this.squash - 1) - this.damping * this.squashVelocity
      this.squashVelocity += accel * h
      this.squash += this.squashVelocity * h
    }
    this.squash = clamp(this.squash, this.flattest * 0.8, 2)

    if (Math.abs(this.squash - 1) < 0.002 && Math.abs(this.squashVelocity) < 0.02) {
      this.squash = 1
      this.squashVelocity = 0
      this.applyShape()
      this.phase = SquishPhase.Idle
      this.setInteractive(true)
      return
    }

    this.applyShape()
  }

  /**
   * The sphere's local Y is turned onto the squash line, so scaling Y squashes along it and the
   * other two axes spread. A sphere looks the same however it is turned, so the turn is left in
   * place afterwards rather than undone.
   */
  private applyShape(): void {
    const height = this.squash
    const spread = 1 + (1 / Math.sqrt(Math.max(height, 0.01)) - 1) * this.bulge
    const base = this.baseScale

    const transform = this.getTransform()
    transform.setWorldRotation(quat.rotationFromTo(vec3.up(), this.axis))
    transform.setLocalScale(new vec3(base.x * spread, base.y * height, base.z * spread))
  }

  /**
   * Both hands tracked and flat, with the sphere between them. When `engaged`, only a fist or lost
   * tracking breaks it: the sphere is already between the palms, and a pressing palm often reads as
   * neither flat nor closed.
   */
  private palmPair(engaged: boolean): PalmPair | null {
    const left = SIK.HandInputData.getHand("left")
    const right = SIK.HandInputData.getHand("right")

    if (!this.palmUsable(left, engaged) || !this.palmUsable(right, engaged)) {
      return null
    }

    const a = left.getPalmCenter()
    const b = right.getPalmCenter()
    if (a === null || b === null) {
      return null
    }

    const between = b.sub(a)
    const length = between.length
    if (length < 0.001) {
      return null
    }

    let axis = between.uniformScale(1 / length)

    if (!engaged) {
      // The point of the sphere's reach nearest the palms: its centre, or somewhere along its stretch
      // towards the player (see SphereReach) when the hands close a little in front of the sphere.
      const between = a.add(b).uniformScale(0.5)
      const centre =
        this.sphereReach !== null ? this.sphereReach.nearestPoint(between) : this.getTransform().getWorldPosition()
      const radius = this.radius()

      if (a.distance(centre) > radius * this.reach || b.distance(centre) > radius * this.reach) {
        return null
      }

      // Between the palms or right where they meet, not off beside them: the sphere's centre must
      // lie close to the stretch joining them. Measured to the nearest point on that stretch, so
      // palms already pressed together at the sphere - where the stretch is only a few centimetres
      // long - count just as much as palms either side of it.
      const along = clamp(centre.sub(a).dot(axis), 0, length)
      if (centre.distance(a.add(axis.uniformScale(along))) > radius * 1.1) {
        return null
      }
    }

    // A squash is the same whichever way along the line it points. Keeping the axis leaning up
    // means it never has to turn from straight up to straight down, which has no single answer.
    if (axis.dot(vec3.up()) < 0) {
      axis = axis.uniformScale(-1)
    }

    return {
      gap: length - this.palmPadding * 2,
      span: length,
      axis: axis,
      middle: a.add(b).uniformScale(0.5)
    }
  }

  /**
   * SIK only calls a palm Flat with the middle finger within 30 degrees of straight, and a relaxed
   * open hand - especially one pressed against the other - often sits just outside that. So a squish
   * starts from a hand that is open and not pinching: one that read Flat within the last Flat Memory
   * seconds, or one that SIK never quite called Flat but that has its index finger straight and is
   * not a fist. The pinch check keeps a two handed pinch for the split from being taken for a
   * squish. Once under way, only a fist or lost tracking counts against a hand.
   */
  private palmUsable(hand: TrackedHand, engaged: boolean): boolean {
    if (hand === null || !hand.isTracked() || hand.palmState === PalmState.Closed) {
      return false
    }
    if (engaged) {
      return true
    }
    if (hand.isPinching()) {
      return false
    }
    const lastFlat = this.lastFlatTime.get(hand.handType) ?? -1000
    return getTime() - lastFlat <= this.flatMemory || isIndexExtended(hand)
  }

  /** Notes the last moment each hand read Flat, for {@link palmUsable}. */
  private rememberFlatPalms(): void {
    const hands = [SIK.HandInputData.getHand("left"), SIK.HandInputData.getHand("right")]
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i]
      if (hand !== null && hand.isTracked() && hand.palmState === PalmState.Flat) {
        this.lastFlatTime.set(hand.handType, getTime())
      }
    }
  }

  /** Lets go of the squish and hands the sphere to the spring. */
  private release(): void {
    this.phase = SquishPhase.Recovering
    this.squashVelocity = 0
    this.lostTimer = 0
  }

  /** The sphere is in the middle of something else, which the squish must not interrupt. */
  private isBusy(): boolean {
    if (this.crush !== null && this.crush.crushPhase !== CrushPhase.Open) {
      return true
    }
    if (this.yoyo !== null && this.yoyo.isFlying()) {
      return true
    }
    if (this.interactable !== null && this.interactable.triggeringInteractor !== InteractorInputType.None) {
      return true
    }
    // TwoHandSplit keeps its state private; TypeScript's `private` is erased at runtime, so it is
    // read here the same way SphereEventAudio reads YoyoFlick's. 0 is its Idle.
    if (this.split !== null && (this.split as any).state !== 0) {
      return true
    }
    return false
  }

  /**
   * A fist closing on the sphere mid-squish starts FistCrush, which drives the scale from then on
   * and switches interactivity back on itself once it has restored the sphere. The squish simply
   * steps aside without touching either.
   */
  private crushTookOver(): boolean {
    if (this.crush === null || this.crush.crushPhase === CrushPhase.Open) {
      return false
    }
    this.squash = 1
    this.squashVelocity = 0
    this.phase = SquishPhase.Idle
    return true
  }

  private snapRound(): void {
    if (this.phase === SquishPhase.Idle) {
      return
    }
    this.squash = 1
    this.squashVelocity = 0
    this.applyShape()
    this.phase = SquishPhase.Idle
    this.setInteractive(true)
  }

  /** The sphere mesh is a unit sphere, so its size is the largest axis of its round scale. */
  private diameter(): number {
    const base = this.baseScale
    return Math.max(base.x, Math.max(base.y, base.z))
  }

  private radius(): number {
    return this.diameter() * 0.5
  }

  private setInteractive(interactive: boolean): void {
    // FistCrush owns these while it is crushing; handing them back mid-crush would let the
    // vanished sphere be grabbed.
    if (interactive && this.crush !== null && this.crush.crushPhase !== CrushPhase.Open) {
      return
    }
    if (this.collider !== null) {
      this.collider.enabled = interactive
    }
    if (this.interactable !== null) {
      this.interactable.enabled = interactive
    }
  }

  /**
   * One line describing everything the squish test depends on, so a squish that will not start can
   * be traced to the condition that is failing.
   */
  private logHands(): void {
    const left = SIK.HandInputData.getHand("left")
    const right = SIK.HandInputData.getHand("right")
    const centre = this.getTransform().getWorldPosition()

    const describe = (name: string, hand: TrackedHand): string => {
      if (hand === null || !hand.isTracked()) {
        return name + "=untracked"
      }
      const state = hand.palmState === PalmState.Flat ? "Flat" : hand.palmState === PalmState.Closed ? "Closed" : "None"
      const palm = hand.getPalmCenter()
      const distance = palm === null ? "?" : palm.distance(centre).toFixed(1)
      return name + "=" + state + " dist=" + distance
    }

    const pair = this.palmPair(false)
    print(
      "PalmSquish " +
        describe("L", left) +
        " " +
        describe("R", right) +
        " reach=" +
        (this.radius() * this.reach).toFixed(1) +
        " busy=" +
        this.isBusy() +
        (pair === null ? " (no flat pair around sphere)" : " gap=" + pair.gap.toFixed(1) + " start<=" + (this.diameter() * 1.1).toFixed(1))
    )
  }
}
