import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorInputType} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {AllHandTypes, HandType} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import TrackedHand, {PalmState} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {CrushPhase, FistCrush} from "./FistCrush"
import {isIndexExtended} from "./HandPose"
import {PalmSquish, SquishPhase} from "./PalmSquish"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

/**
 * Pinch strength (0 hand at rest, 1 fingertips touching) from which a hand counts as closing into
 * a pinch. isPinching only turns true once the pinch has closed, which is too late to tell a hand
 * reaching in to pinch from one poking.
 */
const PINCHING_STRENGTH = 0.5

/**
 * Poke the sphere with an index finger.
 *
 * A poke is an index fingertip pushed in past the sphere's surface with the finger held out
 * straight, as in pointing. A pinching hand - or one closing into a pinch - and a flat palm never
 * count, and neither does a bent finger, so the fingertips that end up inside the sphere during a
 * grab, a squish or a crush are not taken for pokes.
 *
 * A hand reaching in to pinch the sphere still points its index straight for a moment before the
 * thumb closes, and a finger can still be inside when a pinch lets go. So a finger has to stay in
 * for Poke Delay before it counts - a pinch starting in that time cancels it - and a hand cannot
 * poke for Pinch Cooldown after it was pinching, or after the sphere was last busy with another move.
 *
 * The sphere is only watched, never moved. {@link isPoked} is true for as long as a finger is in,
 * so each new poke is its rising edge - which is how GameMenu counts Poke It and SphereEventAudio
 * and PokeShake sound and show it. It does not register while the sphere is busy with another move:
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
    "How long a straight finger has to stay in the sphere before it counts as a poke, so a hand \
reaching in to pinch is not taken for one. A pinch starting in that time cancels the poke."
  )
  @widget(new SliderWidget(0, 1, 0.05))
  pokeDelay: number = 0.3

  @input
  @label("Pinch Cooldown (s)")
  @hint(
    "How long a hand cannot poke after it was pinching, or after the sphere was grabbed, split, \
crushed, squished or thrown - so a finger still inside when a pinch lets go does not count."
  )
  @widget(new SliderWidget(0, 2, 0.05))
  pinchCooldown: number = 0.5

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

  /** The last moment each hand was pinching or closing into a pinch. */
  private lastPinchTime = new Map<string, number>()

  /** The last moment the sphere was busy with another move. */
  private lastBusyTime = -1000

  private interactable: Interactable | null = null
  private crush: FistCrush | null = null
  private squish: PalmSquish | null = null
  private yoyo: YoyoFlick | null = null
  private split: TwoHandSplit | null = null

  /** True while an index finger is poked into the sphere. */
  get isPoked(): boolean {
    return this.poked
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())

    // Hidden with a finger still in, the sphere must not come back already poked.
    this.createEvent("OnDisableEvent").bind(() => {
      this.poked = false
      this.insideTime.clear()
    })
  }

  private init(): void {
    const owner = this.getSceneObject()

    this.interactable = owner.getComponent(Interactable.getTypeName()) as Interactable
    this.crush = owner.getComponent(FistCrush.getTypeName()) as FistCrush
    this.squish = owner.getComponent(PalmSquish.getTypeName()) as PalmSquish
    this.yoyo = owner.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.split = owner.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit

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

      if (this.isClosingToPinch(hand)) {
        this.lastPinchTime.set(handType, now)
      }

      // Counted up only while the finger stays in without a break, so a finger that brushes the
      // sphere on its way to a pinch never gets there.
      const held = !busy && this.fingerIn(hand, handType, now) ? (this.insideTime.get(handType) ?? 0) + deltaTime : 0
      this.insideTime.set(handType, held)

      if (held >= this.pokeDelay) {
        poked = true
      }
    }

    this.poked = poked
  }

  private fingerIn(hand: TrackedHand, handType: HandType, now: number): boolean {
    if (!this.isPointing(hand)) {
      return false
    }
    if (now - (this.lastPinchTime.get(handType) ?? -1000) < this.pinchCooldown) {
      return false
    }
    if (now - this.lastBusyTime < this.pinchCooldown) {
      return false
    }
    return this.tipDepth(hand) >= this.depth
  }

  /** Tracked, index held out straight, not pinching or closing into one, and not a flat palm. */
  private isPointing(hand: TrackedHand): boolean {
    return (
      hand !== null &&
      hand.isTracked() &&
      !this.isClosingToPinch(hand) &&
      hand.palmState !== PalmState.Flat &&
      isIndexExtended(hand)
    )
  }

  /** Pinching, or far enough into one that it is on its way. */
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
    return (radius - tip.distance(this.getTransform().getWorldPosition())) / radius
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

      if (hand === null || !hand.isTracked()) {
        print("FingerPoke [" + handType + "] not tracked")
        continue
      }

      const state = hand.palmState === PalmState.Flat ? "Flat" : hand.palmState === PalmState.Closed ? "Closed" : "None"
      const sincePinch = now - (this.lastPinchTime.get(handType) ?? -1000)
      print(
        "FingerPoke [" +
          handType +
          "] indexStraight=" +
          isIndexExtended(hand) +
          " pinchStrength=" +
          (hand.getPinchStrength() ?? 0).toFixed(2) +
          " palm=" +
          state +
          " tipDepth=" +
          this.tipDepth(hand).toFixed(2) +
          " need>=" +
          this.depth.toFixed(2) +
          " heldIn=" +
          (this.insideTime.get(handType) ?? 0).toFixed(2) +
          "s need>=" +
          this.pokeDelay.toFixed(2) +
          " sincePinch=" +
          Math.min(sincePinch, 99).toFixed(1) +
          "s busy=" +
          this.isBusy()
      )
    }
  }
}
