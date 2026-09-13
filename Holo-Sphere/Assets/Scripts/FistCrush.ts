import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {AllHandTypes, HandType} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import {PalmState} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {Tune, tuned} from "./GestureTuning"
import {curlAmount, isPointingPose} from "./HandPose"
import {SphereReach} from "./SphereReach"

/**
 * Seconds the crushing hand has to stay open before the sphere comes back. A fist's palm state
 * flickers, and without this one open-reading frame would bring the sphere straight back out.
 */
const RELEASE_GRACE = 0.15

/** The same for the hand dropping out of tracking, which happens more often and for longer. */
const LOST_GRACE = 0.35

/** How curled a hand in reach has to be before GestureCues starts showing it closing on the sphere. */
const CUE_CURL = 0.25

export enum CrushPhase {
  /** Full size, watching for a fist. */
  Open,
  /** Shrinking away inside the fist. */
  Crushing,
  /** Gone. Waiting for the hand that took it to open again. */
  Crushed,
  /** Growing back. */
  Restoring
}

function easeOutCubic(t: number): number {
  const inverse = 1 - t
  return 1 - inverse * inverse * inverse
}

/**
 * Close your fist over the sphere and it shrinks away to nothing inside your hand, as though you
 * had crushed it. Open the hand and it swells back out of your palm.
 *
 * SIK already classifies a closed hand: {@link PalmState} reports `Closed` once the middle knuckle
 * bends past 80 degrees, so this only has to pair that with a proximity test against the sphere.
 * A pointing hand curls its middle finger too and so also reads as closed; with only the index
 * sticking out it is a poke at the sphere (see FingerPoke), not a fist around it, and does not crush.
 *
 * While the sphere is crushed its collider and Interactable are switched off, so it cannot be
 * pinched, dragged, thrown or split out of a state where it is not visible. They come back with it.
 */
@component
export class FistCrush extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Trigger</span>')

  @input
  @label("Grab Radius")
  @hint(
    "How close your palm has to be to the sphere for a fist to crush it, as a multiple of the \
sphere's own radius. 1 means the palm must reach the surface."
  )
  @widget(new SliderWidget(0.5, 5, 0.1))
  grabRadius: number = 1.8

  @input
  @label("Hands")
  @hint("Which hands can crush the sphere.")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Either", "either"),
      new ComboBoxItem("Left only", "left"),
      new ComboBoxItem("Right only", "right")
    ])
  )
  allowedHand: string = "either"

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Timing</span>')

  @input
  @label("Crush Time (s)")
  @hint("Seconds for the sphere to shrink from full size to nothing.")
  @widget(new SliderWidget(0.05, 1.5, 0.05))
  crushTime: number = 0.28

  @input
  @label("Restore On Open")
  @hint(
    "Bring the sphere back when the hand that crushed it opens again. Off leaves it gone until \
something else restores it."
  )
  restoreOnOpen: boolean = true

  @input
  @label("Restore Time (s)")
  @hint("Seconds for the sphere to swell back to full size.")
  @widget(new SliderWidget(0.05, 1.5, 0.05))
  restoreTime: number = 0.35

  @input
  @label("Reappear At Hand")
  @hint(
    "Bring the sphere back at the palm that opened, so it grows out of your hand. Off restores \
it wherever it was crushed."
  )
  reappearAtHand: boolean = true

  @input
  @label("Debug Log")
  @hint(
    "Print hand tracking, palm state and distance to the logger twice a second, to work out why \
a fist is or is not registering. Leave off for a shipping build."
  )
  debugLog: boolean = false

  private logTimer = 0

  private phase: CrushPhase = CrushPhase.Open
  private elapsed = 0

  /** Seconds the crushing hand has been open, or out of sight, while the sphere is crushed. */
  private openTime = 0

  /** Full scale, captured before anything shrinks it so restoring is always exact. */
  private baseScale: vec3 = vec3.one()

  /** Which hand did the crushing, so only that hand opening brings the sphere back. */
  private holder: HandType | null = null

  private visual: RenderMeshVisual | null = null
  private collider: ColliderComponent | null = null
  private interactable: Interactable | null = null
  private sphereReach: SphereReach | null = null

  /**
   * Where the sphere is in the crush cycle. Read by SphereEventAudio to sound the shrink and the
   * swell without this script needing an AudioComponent of its own.
   */
  get crushPhase(): CrushPhase {
    return this.phase
  }

  /**
   * How close a hand is to crushing the sphere, for GestureCues: 0 with no hand in reach, rising as a
   * hand in reach curls towards a fist, 1 as the crush starts.
   */
  get crushProgress(): number {
    if (this.phase !== CrushPhase.Open) {
      return this.phase === CrushPhase.Crushing ? 1 : 0
    }

    let best = 0
    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]
      if (this.allowedHand !== "either" && this.allowedHand !== handType) {
        continue
      }

      // A pinching or pointing hand curls its other fingers too, but is grabbing or poking.
      const hand = SIK.HandInputData.getHand(handType)
      if (hand === null || !hand.isTracked() || hand.isPinching() || isPointingPose(hand)) {
        continue
      }

      const palm = hand.getPalmCenter()
      if (palm === null || this.distanceToSphere(palm) > this.reach()) {
        continue
      }

      const curl = curlAmount(hand)
      if (curl >= CUE_CURL) {
        best = Math.max(best, 0.3 + 0.7 * curl)
      }
    }
    return Math.min(0.99, best)
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    const owner = this.getSceneObject()

    this.baseScale = owner.getTransform().getLocalScale()

    this.visual = owner.getComponent("Component.RenderMeshVisual")
    this.collider = owner.getComponent("Component.ColliderComponent")

    this.interactable = owner.getComponent(Interactable.getTypeName()) as Interactable
    this.sphereReach = owner.getComponent(SphereReach.getTypeName()) as SphereReach

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()

    switch (this.phase) {
      case CrushPhase.Open:
        this.watchForFist()
        break

      case CrushPhase.Crushing:
        this.advanceCrush(deltaTime)
        break

      case CrushPhase.Crushed:
        this.watchForRelease()
        break

      case CrushPhase.Restoring:
        this.advanceRestore(deltaTime)
        break
    }
  }

  private watchForFist(): void {
    if (this.debugLog) {
      this.logTimer += getDeltaTime()
      if (this.logTimer >= 0.5) {
        this.logTimer = 0
        this.logHands()
      }
    }

    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]

      if (this.allowedHand !== "either" && this.allowedHand !== handType) {
        continue
      }

      if (!this.handIsCrushing(handType)) {
        continue
      }

      this.holder = handType
      this.phase = CrushPhase.Crushing
      this.elapsed = 0

      // Taken out of play the instant the fist closes, so a fist that also reads as a pinch
      // cannot grab, throw or split a sphere that is busy disappearing.
      this.setInteractive(false)
      return
    }
  }

  /**
   * One line per hand describing every input the crush test depends on, so a failing fist can be
   * traced to the specific condition that is not met rather than guessed at.
   */
  private logHands(): void {
    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]
      const hand = SIK.HandInputData.getHand(handType)

      if (hand === null) {
        print("FistCrush [" + handType + "] hand is null")
        continue
      }

      if (!hand.isTracked()) {
        print("FistCrush [" + handType + "] not tracked")
        continue
      }

      const palm = hand.getPalmCenter()
      const stateName =
        hand.palmState === PalmState.Closed
          ? "Closed"
          : hand.palmState === PalmState.Flat
            ? "Flat"
            : "None"

      if (palm === null) {
        print("FistCrush [" + handType + "] tracked, palm=" + stateName + ", palmCenter is null")
        continue
      }

      const distance = this.distanceToSphere(palm)

      print(
        "FistCrush [" +
          handType +
          "] palm=" +
          stateName +
          " dist=" +
          distance.toFixed(1) +
          " reach=" +
          this.reach().toFixed(1) +
          (hand.palmState === PalmState.Closed && distance <= this.reach() ? " -> WOULD CRUSH" : "")
      )
    }
  }

  /** A hand crushes when it is tracked, closed, and its palm is within reach of the sphere. */
  private handIsCrushing(handType: HandType): boolean {
    const hand = SIK.HandInputData.getHand(handType)

    if (hand === null || !hand.isTracked() || hand.palmState !== PalmState.Closed) {
      return false
    }

    // A pointing hand reads as closed too. With only the index sticking out it is poking the sphere,
    // not closing around it. A fist whose index merely reads as straight still crushes.
    if (isPointingPose(hand)) {
      return false
    }

    const palm = hand.getPalmCenter()
    if (palm === null) {
      return false
    }

    return this.distanceToSphere(palm) <= this.reach()
  }

  /**
   * Distance from a palm to the sphere's reach - its centre stretched out towards the player by
   * SphereReach - so a fist closing a little short in front of the sphere still takes it. Without a
   * SphereReach, the distance to the centre.
   */
  private distanceToSphere(point: vec3): number {
    if (this.sphereReach !== null) {
      return this.sphereReach.distanceTo(point)
    }
    return point.distance(this.getSceneObject().getTransform().getWorldPosition())
  }

  /**
   * Trigger distance in world units. The sphere mesh is a unit sphere, so half the largest world
   * scale axis is its radius however the object has been scaled.
   */
  private reach(): number {
    const scale = this.baseScale
    const largest = Math.max(scale.x, Math.max(scale.y, scale.z))

    return largest * 0.5 * tuned(Tune.CrushRadius, this.grabRadius)
  }

  private advanceCrush(deltaTime: number): void {
    this.elapsed += deltaTime

    const duration = Math.max(0.01, this.crushTime)
    const t = Math.min(1, this.elapsed / duration)

    this.applyScale(1 - easeOutCubic(t))

    if (t < 1) {
      return
    }

    this.setVisible(false)
    this.phase = CrushPhase.Crushed
  }

  private watchForRelease(): void {
    if (!this.restoreOnOpen || this.holder === null) {
      return
    }

    const hand = SIK.HandInputData.getHand(this.holder)
    const tracked = hand !== null && hand.isTracked()

    // A hand that stops being tracked counts as letting go, otherwise the sphere would be stranded
    // whenever the fist left the camera's view while still closed.
    const stillClosed = tracked && hand.palmState === PalmState.Closed
    if (stillClosed) {
      this.openTime = 0
      return
    }

    // Only once it has stayed open, or out of sight, for a moment: the palm state of a fist flickers.
    this.openTime += getDeltaTime()
    if (this.openTime < (tracked ? RELEASE_GRACE : LOST_GRACE)) {
      return
    }
    this.openTime = 0

    if (this.reappearAtHand && hand !== null && hand.isTracked()) {
      const palm = hand.getPalmCenter()
      if (palm !== null) {
        this.getSceneObject().getTransform().setWorldPosition(palm)
      }
    }

    this.setVisible(true)
    this.phase = CrushPhase.Restoring
    this.elapsed = 0
  }

  private advanceRestore(deltaTime: number): void {
    this.elapsed += deltaTime

    const duration = Math.max(0.01, this.restoreTime)
    const t = Math.min(1, this.elapsed / duration)

    this.applyScale(easeOutCubic(t))

    if (t < 1) {
      return
    }

    this.applyScale(1)
    this.setInteractive(true)
    this.holder = null
    this.phase = CrushPhase.Open
  }

  private applyScale(fraction: number): void {
    this.getSceneObject().getTransform().setLocalScale(this.baseScale.uniformScale(fraction))
  }

  private setVisible(visible: boolean): void {
    if (this.visual !== null) {
      this.visual.enabled = visible
    }
  }

  private setInteractive(interactive: boolean): void {
    if (this.collider !== null) {
      this.collider.enabled = interactive
    }
    if (this.interactable !== null) {
      this.interactable.enabled = interactive
    }
  }
}
