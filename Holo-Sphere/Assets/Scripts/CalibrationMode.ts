import {AllHandTypes} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import {PalmState} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {FingerPoke} from "./FingerPoke"
import {CrushPhase, FistCrush} from "./FistCrush"
import {GestureTuning, Tune} from "./GestureTuning"
import {isPointingPose} from "./HandPose"
import {NeonButton, NeonStyle, makePiece, makeText, newLineMaterial, paintText, tint} from "./NeonKit"
import {PalmSquish, SquishPhase} from "./PalmSquish"
import {newBuilder, outline, quad} from "./RetroMenuStyle"
import {SphereReach} from "./SphereReach"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

enum Step {
  Hands,
  Yoyo,
  Duplicate,
  Collapse,
  Compress,
  Poke,
  Finish
}

const STEP_COUNT = 7

const TITLES = ["HAND SIZE", "YOYO", "DUPLICATE", "COLLAPSE", "COMPRESS", "POKE", "ALL SET"]

const PROMPTS = [
  "HOLD BOTH HANDS UP IN FRONT OF YOU\nWITH YOUR FINGERS SPREAD",
  "PINCH THE SPHERE AND FLICK IT AWAY\nLET GO TO BRING IT BACK",
  "PINCH THE SPHERE WITH BOTH HANDS\nAND PULL THEM APART",
  "CLOSE YOUR FIST AROUND THE SPHERE\nOPEN IT TO BRING IT BACK",
  "PRESS THE SPHERE FLAT\nBETWEEN TWO OPEN PALMS",
  "POKE THE SPHERE\nWITH ONE FINGER",
  "YOUR GESTURES ARE SAVED FOR EVERY MODE\nRESET CLEARS THEM, DONE FINISHES"
]

/** Hand measurements taken before the hand size is kept - both hands, ten a second. */
const HAND_SAMPLES = 30

/** Seconds a finished step shows its result before the next one. */
const RESULT_PAUSE = 2

/** Seconds the hand is still watched after a flick lets the sphere go, since the swing carries on. */
const FLICK_TAIL = 0.25

/**
 * While a gesture is being calibrated its threshold is eased right off, so every honest attempt
 * lands - the player sees it work - and can be measured.
 */
const EASY_FLICK_SPEED = 45
const EASY_SPLIT_TRAVEL = 0.35
const EASY_CRUSH_RADIUS = 5
const EASY_SQUISH_REACH = 4.5
const EASY_POKE_DEPTH = 0.02

/** Seconds of fingertip depth remembered, so a poke's depth includes the push that started it. */
const DEPTH_MEMORY = 0.5

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Calibration: measures how this player moves and saves it on the headset for every mode.
 *
 * 1. **Hand size.** Both hands held up while GestureTuning measures them. Every distance and speed
 *    is scaled to the result.
 * 2. **Each gesture** - yoyo, duplicate, collapse, compress, poke - done a few times with its
 *    threshold eased right off, while the ring from GestureCues shows what the game sees. How the
 *    player naturally does it sets their threshold: a comfortable margin under their usual flick
 *    speed, pull and poke depth, and a comfortable margin over how far from the sphere their fist and
 *    palms usually close. Each result is kept within sensible limits of the Inspector value, so one
 *    odd attempt cannot make a gesture impossible.
 * 3. **Finish.** Done, or Reset back to the default gestures. Sensitivity is not the player's to
 *    choose: GestureTuning's Inspector sets it for everyone.
 *
 * Any step can be skipped, which keeps whatever that gesture had before, and Exit leaves with what
 * has been done so far. GameMenu brings this up from the Calibrate button and gets the menu back
 * through the callback passed to {@link start}.
 *
 * The panel is built in code the first time it opens. Put this on an empty SceneObject placed where
 * the panel should float, clear of the sphere.
 */
@component
export class CalibrationMode extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Sphere</span>')

  @input
  @label("Sphere")
  @hint("The Holo Sphere, whose gestures are measured.")
  @allowUndefined
  sphere: SceneObject | null = null

  @input
  @label("Attempts Per Gesture")
  @hint("How many times each gesture is done. The middle attempt of the lot sets the threshold, so one odd one does not.")
  @widget(new SliderWidget(1, 5, 1))
  attempts: number = 3

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Look</span>')

  @input
  @label("Line Material")
  @hint("Unlit material the panel is drawn with. Assets/Neon Line.mat, the same as the menus.")
  @allowUndefined
  lineMaterial: Material | null = null

  @input
  @label("Font Source")
  @hint("Any Text3D in the VT323 font, like the leaderboard's Rows. The panel copies its font and material.")
  @allowUndefined
  fontSource: Text3D | null = null

  @input("vec4", "{0, 0.95, 1, 1}")
  @label("Frame")
  @widget(new ColorWidget())
  frameColor: vec4 = new vec4(0, 0.95, 1, 1)

  @input("vec4", "{1, 0.2, 0.8, 1}")
  @label("Accent")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(1, 0.2, 0.8, 1)

  @input("vec4", "{1, 0.4, 0.85, 1}")
  @label("Text")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(1, 0.4, 0.85, 1)

  @input("vec4", "{0, 0.9, 1, 1}")
  @label("Text Edge")
  @widget(new ColorWidget())
  edgeColor: vec4 = new vec4(0, 0.9, 1, 1)

  @input("vec4", "{0.45, 0.15, 0.85, 1}")
  @label("Fill")
  @widget(new ColorWidget())
  fillColor: vec4 = new vec4(0.45, 0.15, 0.85, 1)

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Voice</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">The Tutorial\'s instructions, each played as its gesture comes up.</span>')

  @input @label("Yoyo Instruction") @allowUndefined yoyoInstruction: AudioTrackAsset | null = null
  @input @label("Duplicate Instruction") @allowUndefined duplicateInstruction: AudioTrackAsset | null = null
  @input @label("Collapse Instruction") @allowUndefined collapseInstruction: AudioTrackAsset | null = null
  @input @label("Compress Instruction") @allowUndefined compressInstruction: AudioTrackAsset | null = null
  @input @label("Poke Instruction") @allowUndefined pokeInstruction: AudioTrackAsset | null = null
  @input @label("Good Job") @hint("Played as each step finishes.") @allowUndefined goodJob: AudioTrackAsset | null = null

  @input
  @label("Voice Volume")
  @widget(new SliderWidget(0, 2, 0.05))
  voiceVolume: number = 1

  private running = false
  private onDone: (() => void) | null = null
  private step: Step = Step.Hands

  /** What this step has measured so far, one value per attempt. */
  private samples: number[] = []
  /** Seconds left showing a finished step's result, or 0 while it is still being done. */
  private resultTimer = 0

  private attemptActive = false
  private attemptPeak = 0
  private attemptTail = -1
  private attemptThrown = false

  private wasHeld = false
  private lastCrush: CrushPhase = CrushPhase.Open
  private lastSquish: SquishPhase = SquishPhase.Idle
  private wasPoked = false

  private recentDepths: {time: number; depth: number}[] = []

  private yoyo: YoyoFlick | null = null
  private split: TwoHandSplit | null = null
  private crush: FistCrush | null = null
  private squish: PalmSquish | null = null
  private poke: FingerPoke | null = null
  private reach: SphereReach | null = null
  private sphereHome: vec3 | null = null
  private baseRadius = 0.5

  private built = false
  private audio: AudioComponent | null = null
  private titleText: Text3D | null = null
  private promptText: Text3D | null = null
  private statusText: Text3D | null = null
  private buttons: {[name: string]: NeonButton} = {}

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.init()
      // Hidden only now, rather than in the scene, so the panel is out of the way until started.
      this.getSceneObject().enabled = false
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /**
   * Brings the panel up and starts from the hand size. `onDone` hears Done or Exit. `sphereHome` is
   * where the sphere goes back to between gestures - where the run placed it - or, left out, where it
   * sat when the lens started.
   */
  start(onDone: () => void, sphereHome: vec3 | null = null): void {
    this.onDone = onDone
    if (sphereHome !== null) {
      this.sphereHome = sphereHome
    }
    this.getSceneObject().enabled = true
    this.build()

    const tuning = GestureTuning.get()
    if (tuning !== null) {
      tuning.calibrating = true
    }

    this.running = true
    this.snapshot()
    this.enterStep(Step.Hands)
  }

  /** Puts the panel away and hands every threshold back to the saved settings. */
  stop(): void {
    this.running = false
    this.onDone = null

    const tuning = GestureTuning.get()
    if (tuning !== null) {
      tuning.calibrating = false
      tuning.clearOverrides()
    }

    if (this.audio !== null && this.audio.isPlaying()) {
      this.audio.stop(false)
    }
    this.getSceneObject().enabled = false
  }

  private init(): void {
    if (this.sphere == null) {
      print("CalibrationMode: no Sphere assigned, there is nothing to calibrate against.")
      return
    }

    this.yoyo = this.sphere.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.split = this.sphere.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit
    this.crush = this.sphere.getComponent(FistCrush.getTypeName()) as FistCrush
    this.squish = this.sphere.getComponent(PalmSquish.getTypeName()) as PalmSquish
    this.poke = this.sphere.getComponent(FingerPoke.getTypeName()) as FingerPoke
    this.reach = this.sphere.getComponent(SphereReach.getTypeName()) as SphereReach

    const transform = this.sphere.getTransform()
    this.sphereHome = transform.getWorldPosition()
    const scale = transform.getWorldScale()
    this.baseRadius = Math.max(scale.x, Math.max(scale.y, scale.z)) * 0.5
  }

  private finish(): void {
    const onDone = this.onDone
    this.stop()
    if (onDone !== null) {
      onDone()
    }
  }

  private enterStep(step: Step): void {
    this.step = step
    this.samples = []
    this.resultTimer = 0
    this.resetAttempt()

    const tuning = GestureTuning.get()
    if (tuning !== null) {
      tuning.clearOverrides()
      switch (step) {
        case Step.Hands:
          tuning.restartHandMeasure()
          break
        case Step.Yoyo:
          tuning.override(Tune.FlickSpeed, EASY_FLICK_SPEED)
          break
        case Step.Duplicate:
          tuning.override(Tune.SplitTravel, EASY_SPLIT_TRAVEL)
          break
        case Step.Collapse:
          tuning.override(Tune.CrushRadius, EASY_CRUSH_RADIUS)
          break
        case Step.Compress:
          tuning.override(Tune.SquishReach, EASY_SQUISH_REACH)
          break
        case Step.Poke:
          tuning.override(Tune.PokeDepth, EASY_POKE_DEPTH)
          break
      }
    }

    if (step !== Step.Hands && step !== Step.Finish) {
      this.homeSphere()
    }

    this.setText(this.titleText, "CALIBRATION " + (step + 1) + "/" + STEP_COUNT + " - " + TITLES[step])
    this.setText(this.promptText, PROMPTS[step])

    if (step === Step.Hands) {
      this.setText(this.statusText, "MEASURING 0%")
    } else if (step === Step.Finish) {
      this.setText(this.statusText, this.settingsSummary())
    } else {
      this.setText(this.statusText, "DONE 0 OF " + this.attemptCount())
    }

    this.layoutButtons()
    this.playClip(this.instructionFor(step))
  }

  private nextStep(): void {
    if (this.step < Step.Finish) {
      this.enterStep(this.step + 1)
    }
  }

  private onUpdate(): void {
    if (!this.running) {
      return
    }

    this.trackTipDepth()

    if (this.resultTimer > 0) {
      this.resultTimer -= getDeltaTime()
      if (this.resultTimer <= 0) {
        this.nextStep()
      }
    } else {
      switch (this.step) {
        case Step.Hands:
          this.updateHands()
          break
        case Step.Yoyo:
          this.updateYoyo()
          break
        case Step.Duplicate:
          this.updateDuplicate()
          break
        case Step.Collapse:
          this.updateCollapse()
          break
        case Step.Compress:
          this.updateCompress()
          break
        case Step.Poke:
          this.updatePoke()
          break
      }
    }

    this.snapshot()
  }

  private updateHands(): void {
    const tuning = GestureTuning.get()
    if (tuning === null) {
      this.completeStep("NO GESTURE TUNING IN THE SCENE")
      return
    }

    const count = tuning.handSampleCount
    this.setText(this.statusText, "MEASURING " + Math.min(100, Math.round((count / HAND_SAMPLES) * 100)) + "%")

    if (count >= HAND_SAMPLES) {
      tuning.keepHandLength()
      this.completeStep("HAND LENGTH " + tuning.handLength.toFixed(1) + " CM")
    }
  }

  /**
   * An attempt is one pinch of the sphere, measured on the very speed YoyoFlick judges a flick on -
   * the faster of the sphere and the pinching hand - carried on past the moment the sphere leaves the
   * hand, so the whole swing is caught.
   */
  private updateYoyo(): void {
    if (this.yoyo === null) {
      return
    }

    const held = this.yoyo.isHeld()
    if (held && !this.wasHeld) {
      this.attemptActive = true
      this.attemptPeak = 0
      this.attemptTail = -1
      this.attemptThrown = false
    }

    if (!this.attemptActive) {
      return
    }

    this.attemptPeak = Math.max(this.attemptPeak, this.yoyo.measuredSpeed())
    if (held) {
      return
    }

    if (this.yoyo.isFlying()) {
      this.attemptThrown = true
    }
    if (this.attemptTail < 0) {
      this.attemptTail = FLICK_TAIL
    }
    this.attemptTail -= getDeltaTime()
    if (this.attemptTail > 0) {
      return
    }

    this.attemptActive = false
    // A pinch that was let go without a flick is just a grab, not an attempt.
    if (this.attemptThrown) {
      this.record(this.attemptPeak)
    }
  }

  /** An attempt is one two handed hold, measured by how far the hands pulled apart. */
  private updateDuplicate(): void {
    if (this.split === null) {
      return
    }

    const hands = this.split.handCount
    if (hands >= 2 && !this.attemptActive) {
      this.attemptActive = true
      this.attemptPeak = 0
    }

    if (!this.attemptActive) {
      return
    }

    if (hands >= 2) {
      this.attemptPeak = Math.max(this.attemptPeak, this.split.currentPull())
      return
    }

    this.attemptActive = false
    if (this.attemptPeak >= 0.15) {
      this.record(this.attemptPeak)
    }
  }

  /** An attempt is one crush, measured by how far from the sphere the fist closed. */
  private updateCollapse(): void {
    if (this.crush === null) {
      return
    }

    if (this.crush.crushPhase === CrushPhase.Crushing && this.lastCrush === CrushPhase.Open) {
      const distance = this.closestClosedPalm()
      if (distance !== null) {
        this.record(distance / this.baseRadius)
      }
    }
  }

  /** An attempt is one squish, measured by how far from the sphere the palms were as it started. */
  private updateCompress(): void {
    if (this.squish === null) {
      return
    }

    if (this.squish.squishPhase === SquishPhase.Squishing && this.lastSquish !== SquishPhase.Squishing) {
      const distance = this.palmSpread()
      if (distance !== null) {
        this.record(distance / this.baseRadius)
      }
    }
  }

  /** An attempt is one poke, measured by the deepest the fingertip went. */
  private updatePoke(): void {
    if (this.poke === null) {
      return
    }

    const poked = this.poke.isPoked
    if (poked && !this.wasPoked) {
      this.attemptActive = true
      this.attemptPeak = this.recentDeepest()
    }

    if (!this.attemptActive) {
      return
    }

    if (poked) {
      this.attemptPeak = Math.max(this.attemptPeak, this.recentDeepest())
      return
    }

    this.attemptActive = false
    this.record(Math.max(0, this.attemptPeak))
  }

  private record(value: number): void {
    this.samples.push(value)
    const count = this.attemptCount()
    this.setText(this.statusText, "DONE " + this.samples.length + " OF " + count)

    if (this.samples.length >= count) {
      this.finishGesture()
    }
  }

  /** Turns the step's measurements into a threshold, and saves it. */
  private finishGesture(): void {
    const tuning = GestureTuning.get()
    const typical = median(this.samples)

    if (tuning === null) {
      this.completeStep("MEASURED - BUT NOTHING TO SAVE TO")
      return
    }

    switch (this.step) {
      case Step.Yoyo: {
        // Never above Flick Speed itself: calibration only ever makes the flick easier.
        const base = this.yoyo!.flickSpeed
        const speed = clamp(typical * 0.6, base * 0.5, base)
        tuning.setCalibrated("flickSpeed", speed)
        this.completeStep("FLICK AT " + Math.round(speed) + " CM/S")
        break
      }
      case Step.Duplicate: {
        const base = this.split!.splitTravel
        const travel = clamp(typical * 0.65, base * 0.4, base * 1.5)
        tuning.setCalibrated("splitTravel", travel)
        this.completeStep("PULL " + (travel * this.baseRadius * 2).toFixed(0) + " CM TO SPLIT")
        break
      }
      case Step.Collapse: {
        const base = this.crush!.grabRadius
        const radius = clamp(typical * 1.3, base * 0.75, 4.5)
        tuning.setCalibrated("crushRadius", radius)
        this.completeStep("FIST WITHIN " + (radius * this.baseRadius).toFixed(0) + " CM")
        break
      }
      case Step.Compress: {
        const base = this.squish!.reach
        const reach = clamp(typical * 1.25, base * 0.75, 4.5)
        tuning.setCalibrated("squishReach", reach)
        this.completeStep("PALMS WITHIN " + (reach * this.baseRadius).toFixed(0) + " CM")
        break
      }
      case Step.Poke: {
        const base = this.poke!.depth
        const depth = clamp(typical * 0.5, 0, Math.max(0.05, base * 1.5))
        tuning.setCalibrated("pokeDepth", depth)
        this.completeStep("POKE " + (depth * this.baseRadius).toFixed(1) + " CM DEEP")
        break
      }
    }
  }

  private completeStep(message: string): void {
    this.setText(this.statusText, message)
    this.playClip(this.goodJob)
    this.resultTimer = RESULT_PAUSE
  }

  private resetAttempt(): void {
    this.attemptActive = false
    this.attemptPeak = 0
    this.attemptTail = -1
    this.attemptThrown = false
  }

  private snapshot(): void {
    this.wasHeld = this.yoyo !== null && this.yoyo.isHeld()
    this.lastCrush = this.crush !== null ? this.crush.crushPhase : CrushPhase.Open
    this.lastSquish = this.squish !== null ? this.squish.squishPhase : SquishPhase.Idle
    this.wasPoked = this.poke !== null && this.poke.isPoked
  }

  /** Remembers the deepest pointing fingertip each frame, for {@link recentDeepest}. */
  private trackTipDepth(): void {
    const now = getTime()
    let deepest = -1

    if (this.sphere != null) {
      const scale = this.sphere.getTransform().getWorldScale()
      const radius = Math.max(0.0001, Math.max(scale.x, Math.max(scale.y, scale.z)) * 0.5)

      for (let i = 0; i < AllHandTypes.length; i++) {
        const hand = SIK.HandInputData.getHand(AllHandTypes[i])
        if (hand === null || !hand.isTracked() || !isPointingPose(hand)) {
          continue
        }
        const tip = hand.indexTip?.position
        if (tip == null) {
          continue
        }
        deepest = Math.max(deepest, (radius - this.reachDistance(tip)) / radius)
      }
    }

    this.recentDepths.push({time: now, depth: deepest})
    while (this.recentDepths.length > 0 && now - this.recentDepths[0].time > DEPTH_MEMORY) {
      this.recentDepths.shift()
    }
  }

  private recentDeepest(): number {
    let deepest = -1
    for (let i = 0; i < this.recentDepths.length; i++) {
      deepest = Math.max(deepest, this.recentDepths[i].depth)
    }
    return deepest
  }

  private closestClosedPalm(): number | null {
    let closest: number | null = null
    for (let i = 0; i < AllHandTypes.length; i++) {
      const hand = SIK.HandInputData.getHand(AllHandTypes[i])
      if (hand === null || !hand.isTracked() || hand.palmState !== PalmState.Closed) {
        continue
      }
      const palm = hand.getPalmCenter()
      if (palm === null) {
        continue
      }
      const distance = this.reachDistance(palm)
      closest = closest === null ? distance : Math.min(closest, distance)
    }
    return closest
  }

  /** How far the further of the two palms is from the sphere, measured the way PalmSquish does. */
  private palmSpread(): number | null {
    const left = SIK.HandInputData.getHand("left")
    const right = SIK.HandInputData.getHand("right")
    if (left === null || right === null || !left.isTracked() || !right.isTracked()) {
      return null
    }

    const a = left.getPalmCenter()
    const b = right.getPalmCenter()
    if (a === null || b === null) {
      return null
    }

    const middle = a.add(b).uniformScale(0.5)
    const centre = this.reach !== null ? this.reach.nearestPoint(middle) : this.sphere!.getTransform().getWorldPosition()
    return Math.max(a.distance(centre), b.distance(centre))
  }

  private reachDistance(point: vec3): number {
    if (this.reach !== null) {
      return this.reach.distanceTo(point)
    }
    return point.distance(this.sphere!.getTransform().getWorldPosition())
  }

  /** Back home for the next gesture - unless it is busy mid-move, when moving it would break the move. */
  private homeSphere(): void {
    if (this.sphere == null || this.sphereHome === null) {
      return
    }
    if (this.yoyo !== null && this.yoyo.isFlying()) {
      return
    }
    if (this.split !== null && this.split.handCount > 0) {
      return
    }
    if (this.crush !== null && this.crush.crushPhase !== CrushPhase.Open) {
      return
    }
    this.sphere.getTransform().setWorldPosition(this.sphereHome)
  }

  private attemptCount(): number {
    return Math.max(1, Math.round(this.attempts))
  }

  private instructionFor(step: Step): AudioTrackAsset | null {
    switch (step) {
      case Step.Yoyo:
        return this.yoyoInstruction
      case Step.Duplicate:
        return this.duplicateInstruction
      case Step.Collapse:
        return this.collapseInstruction
      case Step.Compress:
        return this.compressInstruction
      case Step.Poke:
        return this.pokeInstruction
      default:
        return null
    }
  }

  private playClip(track: AudioTrackAsset | null): void {
    if (this.audio === null || track == null) {
      return
    }
    if (this.audio.isPlaying()) {
      this.audio.stop(false)
    }
    this.audio.audioTrack = track
    this.audio.volume = this.voiceVolume
    this.audio.play(1)
  }

  // ---- Finish ----

  private resetCalibration(): void {
    const tuning = GestureTuning.get()
    if (tuning !== null) {
      tuning.clearCalibration()
    }
    this.setText(this.statusText, "BACK TO THE DEFAULT GESTURES")
  }

  private settingsSummary(): string {
    const tuning = GestureTuning.get()
    return tuning !== null && tuning.isCalibrated ? "GESTURES CALIBRATED TO YOUR HANDS" : "GESTURES AT THEIR DEFAULTS"
  }

  // ---- Panel ----

  /** Gesture steps offer Skip and Exit; the last step Reset and Done. */
  private layoutButtons(): void {
    if (!this.built) {
      return
    }

    const names = Object.keys(this.buttons)
    for (let i = 0; i < names.length; i++) {
      this.buttons[names[i]].setVisible(false)
    }

    if (this.step === Step.Finish) {
      this.layoutRow([this.buttons.reset, this.buttons.done], -6.5)
    } else {
      this.layoutRow([this.buttons.skip, this.buttons.exit], -6.5)
    }
  }

  private layoutRow(row: NeonButton[], y: number): void {
    const gap = 1.2
    const total = row.reduce((sum, button) => sum + button.width, 0) + gap * (row.length - 1)
    let x = -total / 2
    for (let i = 0; i < row.length; i++) {
      row[i].setVisible(true)
      row[i].setPosition(x + row[i].width / 2, y)
      x += row[i].width + gap
    }
  }

  private build(): void {
    if (this.built) {
      return
    }
    this.built = true

    const owner = this.getSceneObject()
    this.audio = owner.createComponent("Component.AudioComponent") as AudioComponent

    if (this.lineMaterial == null || this.fontSource == null) {
      print("CalibrationMode: needs a Line Material and a Font Source to build its panel.")
      return
    }

    const width = 42
    const top = 12
    const bottom = -12

    const glass = newBuilder()
    quad(glass, -width / 2, bottom, width / 2, top)
    tint(makePiece("Calibration Glass", owner, glass, -0.3, newLineMaterial(this.lineMaterial)), this.fillColor, 0.1)

    const frame = newBuilder()
    outline(frame, 0, 0, width, top - bottom, 0.3)
    tint(makePiece("Calibration Frame", owner, frame, -0.25, newLineMaterial(this.lineMaterial)), this.frameColor, 0.7)

    const titleMaterial = this.fontSource.mainMaterial.clone()
    paintText(titleMaterial, this.frameColor, this.frameColor)
    const textMaterial = this.fontSource.mainMaterial.clone()
    paintText(textMaterial, this.textColor, this.edgeColor)

    const font = this.fontSource.font
    this.titleText = makeText("", owner, new vec3(0, 9.3, 0), 52, font, titleMaterial)
    this.promptText = makeText("", owner, new vec3(0, 4.6, 0), 44, font, textMaterial)
    this.statusText = makeText("", owner, new vec3(0, 0, 0), 44, font, titleMaterial)

    const style: NeonStyle = {
      lineMaterial: this.lineMaterial,
      font: font,
      textMaterial: textMaterial,
      frameColor: this.frameColor,
      accentColor: this.accentColor,
      fillColor: this.fillColor
    }

    const button = (label: string, buttonWidth: number, onPress: () => void): NeonButton =>
      new NeonButton(style, owner, label, buttonWidth, 3.4, 50, onPress)

    this.buttons = {
      skip: button("SKIP", 9, () => this.nextStep()),
      exit: button("EXIT", 9, () => this.finish()),
      reset: button("RESET", 9, () => this.resetCalibration()),
      done: button("DONE", 9, () => this.finish())
    }
  }

  private setText(text: Text3D | null, value: string): void {
    if (text !== null) {
      text.text = value
    }
  }
}
