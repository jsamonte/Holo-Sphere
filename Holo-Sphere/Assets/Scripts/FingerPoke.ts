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
 * Poke the sphere with an index finger.
 *
 * A poke is an index fingertip pushed in past the sphere's surface with the finger held out
 * straight, as in pointing. A pinching hand and a flat palm never count, and neither does a bent
 * finger, so the fingertips that end up inside the sphere during a grab, a squish or a crush are not
 * taken for pokes.
 *
 * The sphere is only watched, never moved. {@link isPoked} is true for as long as a fingertip is in,
 * so each new poke is its rising edge - which is how GameMenu counts Poke It and SphereEventAudio
 * sounds it. It does not register while the sphere is busy with another move: pinched, split, out
 * on the yoyo, crushed or squished.
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
  @label("Debug Log")
  @hint(
    "Print both index fingers' pose and depth twice a second, to work out why a poke is or is not \
registering. Leave off for a shipping build."
  )
  debugLog: boolean = false

  private poked = false
  private logTimer = 0

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
    this.createEvent("OnDisableEvent").bind(() => (this.poked = false))
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
    if (this.debugLog) {
      this.logTimer += getDeltaTime()
      if (this.logTimer >= 0.5) {
        this.logTimer = 0
        this.logHands()
      }
    }

    let inside = false
    if (!this.isBusy()) {
      for (let i = 0; i < AllHandTypes.length; i++) {
        if (this.fingerIn(AllHandTypes[i])) {
          inside = true
          break
        }
      }
    }
    this.poked = inside
  }

  private fingerIn(handType: HandType): boolean {
    const hand = SIK.HandInputData.getHand(handType)
    if (!this.isPointing(hand)) {
      return false
    }
    return this.tipDepth(hand) >= this.depth
  }

  /** Tracked, index held out straight, and neither pinching nor a flat palm. */
  private isPointing(hand: TrackedHand): boolean {
    return (
      hand !== null &&
      hand.isTracked() &&
      !hand.isPinching() &&
      hand.palmState !== PalmState.Flat &&
      isIndexExtended(hand)
    )
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
    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]
      const hand = SIK.HandInputData.getHand(handType)

      if (hand === null || !hand.isTracked()) {
        print("FingerPoke [" + handType + "] not tracked")
        continue
      }

      const state = hand.palmState === PalmState.Flat ? "Flat" : hand.palmState === PalmState.Closed ? "Closed" : "None"
      print(
        "FingerPoke [" +
          handType +
          "] indexStraight=" +
          isIndexExtended(hand) +
          " pinching=" +
          hand.isPinching() +
          " palm=" +
          state +
          " tipDepth=" +
          this.tipDepth(hand).toFixed(2) +
          " need>=" +
          this.depth.toFixed(2) +
          " busy=" +
          this.isBusy()
      )
    }
  }
}
