import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorInputType} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {AllHandTypes, HandType} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import TrackedHand, {PalmState} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {CrushPhase, FistCrush} from "./FistCrush"
import {isIndexExtended, isPointingPose} from "./HandPose"
import {PalmSquish, SquishPhase} from "./PalmSquish"
import {SphereReach} from "./SphereReach"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

/**
 * Pinch strength (0 hand at rest, 1 fingertips touching) from which a hand counts as closing into
 * a pinch. Kept high: a pointing hand with its thumb tucked in can read well above halfway.
 */
const PINCHING_STRENGTH = 0.8

/** Shortest time a finger has to be in for a quick jab to count, rather than a brush. */
const JAB_MIN = 0.03

/** How long after a quick jab to wait, making sure it was not the start of a pinch, before it counts. */
const JAB_CONFIRM = 0.08

/**
 * How long the pose check or hand tracking may drop out while the finger is in before the poke is
 * over. Fingertip tracking wobbles, and without this a single bad frame would restart the count.
 */
const DROPOUT_GRACE = 0.15

/**
 * How much shallower than Depth, as a fraction of the radius, a finger already in may sit before it
 * counts as out - so the shake a poke sets off cannot jostle it out again.
 */
const EXIT_SLACK = 0.2

/** How long a confirmed quick jab reads as poked, so its sound and shake are heard and seen. */
const JAB_PULSE = 0.25

/**
 * Poke the sphere with an index finger.
 *
 * A poke is an index fingertip pushed in past the sphere's surface with only the index sticking out:
 * held straight, with the middle, ring and little fingers folded away. A whole hand at the sphere -
 * open, or closing into the fist that collapses it - never counts, nor does a pinching hand or a bent
 * finger, so the fingertips that end up inside the sphere during a grab or a crush are not taken for
 * pokes. Nor does anything count while the other hand is open beside the sphere, which is two hands
 * setting up a compress.
 *
 * A hand reaching in to pinch still points its index straight for a moment before the thumb closes,
 * so a poke is recognised one of two ways:
 *
 * - **Held.** A finger that stays in for Poke Delay is poking, for as long as it stays in. A frame
 *   or two of the pose check or tracking dropping out does not end it.
 * - **Jab.** A quicker in-and-out counts once the fingertip is out again, provided no pinch follows
 *   in the moment after, and then reads as poked for a short pulse.
 *
 * A pinch starting while the finger is in cancels either, and a hand cannot poke for Pinch Cooldown
 * after it was pinching, or after the sphere was last busy with another move - so a finger still
 * inside when a pinch lets go does not count.
 *
 * The sphere is only watched, never moved. {@link isPoked} is true for as long as a poke lasts, so
 * each new poke is its rising edge - which is how GameMenu counts Poke It and SphereEventAudio and
 * PokeShake sound and show it. It does not register while the sphere is busy with another move:
 * pinched, split, out on the yoyo, crushed or squished.
 */
@component
export class FingerPoke extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Trigger</span>')

  @input
  @label("Depth")
  @hint(
    "How far past the sphere's surface the fingertip has to reach to count, as a fraction of the \
sphere's radius. 0 counts at the surface; higher needs a deeper poke."
  )
  @widget(new SliderWidget(0, 0.8, 0.05))
  depth: number = 0.15

  @input
  @label("Poke Delay (s)")
  @hint(
    "How long a finger has to stay in the sphere to count while still in it. Quicker jabs still \
count, once the finger comes back out without a pinch following."
  )
  @widget(new SliderWidget(0, 1, 0.01))
  pokeDelay: number = 0.1

  @input
  @label("Pinch Cooldown (s)")
  @hint(
    "How long a hand cannot poke after it was pinching, or after the sphere was grabbed, split, \
crushed, squished or thrown - so a finger still inside when a pinch lets go does not count."
  )
  @widget(new SliderWidget(0, 2, 0.05))
  pinchCooldown: number = 0.3

  @input
  @label("Debug Log")
  @hint(
    "Print both index fingers' pose and depth twice a second, to work out why a poke is or is not \
registering. Leave off for a shipping build."
  )
  debugLog: boolean = false

  private poked = false
  private logTimer = 0

  /** Seconds each hand's finger has been in the sphere, pointing, without a break. */
  private insideTime = new Map<string, number>()

  /** Seconds each hand's finger has read as out while its poke is held on through a dropout. */
  private outTime = new Map<string, number>()

  /** Seconds left before each hand's quick jab confirms, or 0 when there is none waiting. */
  private jabWait = new Map<string, number>()

  /** Seconds left of each hand's confirmed jab reading as poked. */
  private jabPulse = new Map<string, number>()

  /** The last moment each hand was pinching or closing into a pinch. */
  private lastPinchTime = new Map<string, number>()

  /** The last moment the sphere was busy with another move. */
  private lastBusyTime = -1000

  private interactable: Interactable | null = null
  private crush: FistCrush | null = null
  private squish: PalmSquish | null = null
  private yoyo: YoyoFlick | null = null
  private split: TwoHandSplit | null = null
  private reach: SphereReach | null = null

  /** True while an index finger is poking the sphere. */
  get isPoked(): boolean {
    return this.poked
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())

    // Hidden with a finger still in, the sphere must not come back already poked.
    this.createEvent("OnDisableEvent").bind(() => {
      this.poked = false
      this.insideTime.clear()
      this.outTime.clear()
      this.jabWait.clear()
      this.jabPulse.clear()
    })
  }

  private init(): void {
    const owner = this.getSceneObject()

    this.interactable = owner.getComponent(Interactable.getTypeName()) as Interactable
    this.crush = owner.getComponent(FistCrush.getTypeName()) as FistCrush
    this.squish = owner.getComponent(PalmSquish.getTypeName()) as PalmSquish
    this.yoyo = owner.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.split = owner.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit
    this.reach = owner.getComponent(SphereReach.getTypeName()) as SphereReach

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()
    const now = getTime()

    if (this.debugLog) {
      this.logTimer += deltaTime
      if (this.logTimer >= 0.5) {
        this.logTimer = 0
        this.logHands()
      }
    }

    const busy = this.isBusy()
    if (busy) {
      this.lastBusyTime = now
    }

    let poked = false
    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]
      const hand = SIK.HandInputData.getHand(handType)
      const other = SIK.HandInputData.getHand(AllHandTypes[(i + 1) % AllHandTypes.length])
      const closing = this.isClosingToPinch(hand)

      if (closing) {
        this.lastPinchTime.set(handType, now)
      }

      // Once in, the fingertip has to come back out towards the surface to leave, so the shake a
      // poke sets off cannot jostle it out again.
      const was = this.insideTime.get(handType) ?? 0
      const needed = was > 0 ? this.depth - EXIT_SLACK : this.depth
      const inNow = !busy && this.fingerIn(hand, other, handType, now, needed)
      const fisting = this.isFisting(hand)

      let held = 0
      let gap = 0
      if (inNow) {
        held = was + deltaTime
      } else if (was > 0) {
        // A pinch, a fist, another move or the other hand setting up a compress ends it at once, and
        // so does the fingertip coming back out. Anything else - the pose check or tracking dropping
        // out for a frame - is held on through DROPOUT_GRACE rather than starting the count over.
        const cancelled = busy || closing || fisting || this.isSettingUpCompress(other)
        const left = hand !== null && hand.isTracked() && this.tipDepth(hand) < needed
        gap = (this.outTime.get(handType) ?? 0) + deltaTime

        if (cancelled) {
          gap = 0
        } else if (left || gap >= DROPOUT_GRACE) {
          // Out again before Poke Delay, and not because a pinch closed on it: a quick jab, which
          // counts once it is clear no pinch is following. The fingertip has to have actually left -
          // a finger that stops pointing while still inside is a hand curling into a fist, not a jab.
          if (left && was >= JAB_MIN && was < this.pokeDelay) {
            this.jabWait.set(handType, JAB_CONFIRM)
          }
          gap = 0
        } else {
          held = was
        }
      }
      this.insideTime.set(handType, held)
      this.outTime.set(handType, gap)

      let wait = this.jabWait.get(handType) ?? 0
      if (wait > 0) {
        if (closing || busy || fisting) {
          wait = 0
        } else {
          wait -= deltaTime
          if (wait <= 0) {
            wait = 0
            this.jabPulse.set(handType, JAB_PULSE)
          }
        }
        this.jabWait.set(handType, wait)
      }

      let pulse = busy ? 0 : this.jabPulse.get(handType) ?? 0
      if (pulse > 0) {
        pulse = Math.max(0, pulse - deltaTime)
        poked = true
      }
      this.jabPulse.set(handType, pulse)

      if (held >= this.pokeDelay) {
        poked = true
      }
    }

    this.poked = poked
  }

  /** Pointing, clear of every cooldown, and with the fingertip at least `needed` deep. */
  private fingerIn(hand: TrackedHand, other: TrackedHand, handType: HandType, now: number, needed: number): boolean {
    if (!this.isPointing(hand) || this.isSettingUpCompress(other)) {
      return false
    }
    if (now - (this.lastPinchTime.get(handType) ?? -1000) < this.pinchCooldown) {
      return false
    }
    if (now - this.lastBusyTime < this.pinchCooldown) {
      return false
    }
    return this.tipDepth(hand) >= needed
  }

  /** Tracked, only the index sticking out, and not pinching or closing into one. */
  private isPointing(hand: TrackedHand): boolean {
    return hand !== null && hand.isTracked() && !this.isClosingToPinch(hand) && isPointingPose(hand)
  }

  /** Closed into a fist - the collapse - rather than pointing. */
  private isFisting(hand: TrackedHand): boolean {
    return hand !== null && hand.isTracked() && hand.palmState === PalmState.Closed && !isPointingPose(hand)
  }

  /**
   * The other hand open beside the sphere: the two hands are setting up a compress, and fingertips
   * that stray into the sphere on the way are not pokes.
   */
  private isSettingUpCompress(other: TrackedHand): boolean {
    if (other === null || !other.isTracked() || other.palmState === PalmState.Closed || other.isPinching()) {
      return false
    }
    const palm = other.getPalmCenter()
    return palm !== null && this.reachDistance(palm) <= this.radius() * 2.5
  }

  /** Pinching, or nearly closed into one. */
  private isClosingToPinch(hand: TrackedHand): boolean {
    if (hand === null || !hand.isTracked()) {
      return false
    }
    return hand.isPinching() || (hand.getPinchStrength() ?? 0) >= PINCHING_STRENGTH
  }

  /**
   * How far the index fingertip is inside the sphere, as a fraction of its radius: 0 at the
   * surface, 1 at the centre, negative while it is still outside.
   */
  private tipDepth(hand: TrackedHand): number {
    const tip = hand.indexTip?.position
    if (tip == null) {
      return -1
    }
    const radius = this.radius()
    return (radius - this.reachDistance(tip)) / radius
  }

  /**
   * Distance from a point to the sphere's reach - its centre stretched out towards the player by
   * SphereReach - so a finger or palm that stops a little short in front of the sphere still counts.
   * Without a SphereReach, the distance to the centre.
   */
  private reachDistance(point: vec3): number {
    if (this.reach !== null) {
      return this.reach.distanceTo(point)
    }
    return point.distance(this.getTransform().getWorldPosition())
  }

  /** The sphere mesh is a unit sphere, so its radius is half its largest world scale axis. */
  private radius(): number {
    const scale = this.getTransform().getWorldScale()
    return Math.max(0.0001, Math.max(scale.x, Math.max(scale.y, scale.z)) * 0.5)
  }

  /** The sphere is in the middle of another move, whose fingers must not be taken for a poke. */
  private isBusy(): boolean {
    if (this.crush !== null && this.crush.crushPhase !== CrushPhase.Open) {
      return true
    }
    if (this.squish !== null && this.squish.squishPhase !== SquishPhase.Idle) {
      return true
    }
    if (this.yoyo !== null && this.yoyo.isFlying()) {
      return true
    }
    if (this.interactable !== null && this.interactable.triggeringInteractor !== InteractorInputType.None) {
      return true
    }
    // TwoHandSplit keeps its state private; TypeScript's `private` is erased at runtime, so it is
    // read here the same way PalmSquish reads it. 0 is its Idle.
    if (this.split !== null && (this.split as any).state !== 0) {
      return true
    }
    return false
  }

  /** One line per hand with everything the poke test depends on. */
  private logHands(): void {
    const now = getTime()

    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]
      const hand = SIK.HandInputData.getHand(handType)
      const other = SIK.HandInputData.getHand(AllHandTypes[(i + 1) % AllHandTypes.length])

      if (hand === null || !hand.isTracked()) {
        print("FingerPoke [" + handType + "] not tracked")
        continue
      }

      const sincePinch = now - (this.lastPinchTime.get(handType) ?? -1000)
      print(
        "FingerPoke [" +
          handType +
          "] indexStraight=" +
          isIndexExtended(hand) +
          " onlyIndexOut=" +
          isPointingPose(hand) +
          " pinchStrength=" +
          (hand.getPinchStrength() ?? 0).toFixed(2) +
          " otherHandCompressing=" +
          this.isSettingUpCompress(other) +
          " tipDepth=" +
          this.tipDepth(hand).toFixed(2) +
          " need>=" +
          this.depth.toFixed(2) +
          " heldIn=" +
          (this.insideTime.get(handType) ?? 0).toFixed(2) +
          "s sincePinch=" +
          Math.min(sincePinch, 99).toFixed(1) +
          "s busy=" +
          this.isBusy() +
          " poked=" +
          this.poked
      )
    }
  }
}
