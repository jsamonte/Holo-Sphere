import {AllHandTypes} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {handLength} from "./HandPose"

/** Every gesture threshold that sensitivity, hand size or calibration can adjust. */
export enum Tune {
  FlickSpeed,
  ReturnFlickSpeed,
  SplitTravel,
  SecondHandReach,
  SquishReach,
  PalmPadding,
  CrushRadius,
  PokeDepth,
  PokeDelay
}

const enum Kind {
  /** A bar the hand has to clear - a speed, a pull, a depth, a hold. Easier is lower. */
  Bar,
  /** A zone the hand has to be inside. Easier is wider. */
  Zone,
  /** A measurement of the hand itself, which sensitivity leaves alone. */
  Size
}

interface Rule {
  kind: Kind
  /** Scaled with the player's hand: bigger hands reach further and move faster. */
  handScaled: boolean
  /** Name the calibrated value is saved under, or null for thresholds calibration does not measure. */
  calibrated: string | null
  /** Never harder than the Inspector value, whatever sensitivity, hand size or calibration say. */
  neverHarder: boolean
}

const RULES: Rule[] = []
RULES[Tune.FlickSpeed] = {kind: Kind.Bar, handScaled: true, calibrated: "flickSpeed", neverHarder: true}
RULES[Tune.ReturnFlickSpeed] = {kind: Kind.Bar, handScaled: true, calibrated: null, neverHarder: true}
RULES[Tune.SplitTravel] = {kind: Kind.Bar, handScaled: true, calibrated: "splitTravel", neverHarder: false}
RULES[Tune.SecondHandReach] = {kind: Kind.Zone, handScaled: true, calibrated: null, neverHarder: false}
RULES[Tune.SquishReach] = {kind: Kind.Zone, handScaled: true, calibrated: "squishReach", neverHarder: false}
RULES[Tune.PalmPadding] = {kind: Kind.Size, handScaled: true, calibrated: null, neverHarder: false}
RULES[Tune.CrushRadius] = {kind: Kind.Zone, handScaled: true, calibrated: "crushRadius", neverHarder: false}
RULES[Tune.PokeDepth] = {kind: Kind.Bar, handScaled: false, calibrated: "pokeDepth", neverHarder: false}
RULES[Tune.PokeDelay] = {kind: Kind.Bar, handScaled: false, calibrated: null, neverHarder: false}

/** Everything kept on the headset between sessions. */
interface Saved {
  /** The hand length calibration last measured, in cm. 0 when it never has. */
  handLength: number
  calibrated: {[name: string]: number}
}

const STORE_KEY = "gestureTuning"

/** Seconds between hand measurements, and how many are kept to take the median of. */
const HAND_SAMPLE_INTERVAL = 0.1
const HAND_SAMPLES_KEPT = 40

/** Samples needed before this session's own measurement is trusted over the saved one. */
const HAND_SAMPLES_TRUSTED = 15

/** Wrist to middle fingertip, in cm, of any real hand. Anything outside is a tracking glitch. */
const MIN_HAND_LENGTH = 12
const MAX_HAND_LENGTH = 26

let instance: GestureTuning | null = null

function median(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * `base` as the player's own settings would have it, or `base` untouched when there is no
 * GestureTuning in the scene. What every gesture script calls instead of reading its threshold.
 */
export function tuned(tune: Tune, base: number): number {
  return instance !== null ? instance.value(tune, base) : base
}

/**
 * The player's own gesture settings, shared by every gesture on the sphere and kept on the headset.
 *
 * - **Hand size.** Both hands are measured, wrist to middle fingertip, whenever they are tracked.
 *   Every distance and speed a hand has to reach is scaled to it, so small and large hands get the
 *   same game without doing anything.
 * - **Calibration.** CalibrationMode measures how this player actually does each gesture and saves
 *   a threshold for it, which replaces the Inspector value from then on.
 * - **Sensitivity.** Set here for everyone, never by the player, scaling every threshold together:
 *   Low needs bigger movements, High smaller ones.
 * - **Never harder.** The yoyo's flick and return speeds only ever come out easier than their
 *   Inspector values, whatever sensitivity, hand size or calibration would make of them.
 * - **Hints.** Whether GestureCues shows its rings and dots during play.
 *
 * Put one on any object that is always enabled. Scripts reach it through {@link tuned}.
 */
@component
export class GestureTuning extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Hand Size</span>')

  @input
  @label("Reference Hand (cm)")
  @hint("Wrist to middle fingertip of the hand the gesture Inspector values were tuned on. A hand this long plays them unchanged.")
  @widget(new SliderWidget(14, 22, 0.5))
  referenceHandLength: number = 18.5

  @input
  @label("Smallest Scale")
  @hint("Least the thresholds shrink for a small hand.")
  @widget(new SliderWidget(0.5, 1, 0.05))
  minHandScale: number = 0.8

  @input
  @label("Largest Scale")
  @hint("Most the thresholds grow for a large hand.")
  @widget(new SliderWidget(1, 1.5, 0.05))
  maxHandScale: number = 1.25

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Sensitivity</span>')

  @input
  @label("Sensitivity")
  @hint("How big a movement every gesture needs, for every player. Low needs bigger movements, High smaller ones.")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Low", "low"),
      new ComboBoxItem("Normal", "normal"),
      new ComboBoxItem("High", "high")
    ])
  )
  sensitivity: string = "low"

  @input
  @label("Low")
  @hint("How much bigger every movement has to be on Low.")
  @widget(new SliderWidget(1, 2, 0.05))
  lowFactor: number = 1.3

  @input
  @label("High")
  @hint("How much smaller every movement can be on High.")
  @widget(new SliderWidget(0.4, 1, 0.05))
  highFactor: number = 0.75

  @input
  @label("Show Hints")
  @hint("Show GestureCues' rings and dots during play. They always show during calibration.")
  showHints: boolean = true

  @input
  @label("Debug Log")
  @hint("Print the hand length and calibrated values whenever they change.")
  debugLog: boolean = false

  /** Set by CalibrationMode while it runs, which keeps GestureCues showing whatever Show Hints says. */
  calibrating = false

  private saved: Saved = {handLength: 0, calibrated: {}}
  private samples: number[] = []
  private sampleTimer = 0
  private overrides = new Map<Tune, number>()

  static get(): GestureTuning | null {
    return instance
  }

  onAwake(): void {
    instance = this
    this.load()
    this.createEvent("UpdateEvent").bind(() => this.sampleHands())
  }

  /** `base` scaled to the player's hand and sensitivity - or their calibrated value, if they have one. */
  value(tune: Tune, base: number): number {
    const forced = this.overrides.get(tune)
    if (forced !== undefined) {
      return forced
    }

    const rule = RULES[tune]
    const calibrated = rule.calibrated !== null ? this.saved.calibrated[rule.calibrated] : undefined

    // A calibrated value was measured on this player's own hand, so it is not scaled again.
    let value = typeof calibrated === "number" ? calibrated : base * (rule.handScaled ? this.handScale() : 1)

    const factor = this.sensitivityFactor()
    if (rule.kind === Kind.Bar) {
      value *= factor
    } else if (rule.kind === Kind.Zone) {
      value /= factor
    }

    // Some gestures only ever get easier: their Inspector value is the hardest they can be.
    if (rule.neverHarder) {
      value = rule.kind === Kind.Zone ? Math.max(value, base) : Math.min(value, base)
    }
    return value
  }

  /** Whether GestureCues should be showing: Show Hints on, or calibration running. */
  get showCues(): boolean {
    return this.showHints || this.calibrating
  }

  /**
   * The player's hand length in cm: this session's measurement once there is enough of it, the
   * saved one until then, and 0 when there is neither.
   */
  get handLength(): number {
    if (this.samples.length >= HAND_SAMPLES_TRUSTED) {
      return median(this.samples)
    }
    return this.saved.handLength
  }

  /** How much bigger or smaller than the reference hand the player's is. 1 when not yet measured. */
  handScale(): number {
    const length = this.handLength
    if (length <= 0) {
      return 1
    }
    return Math.max(this.minHandScale, Math.min(this.maxHandScale, length / this.referenceHandLength))
  }

  get handSampleCount(): number {
    return this.samples.length
  }

  /** Starts this session's hand measurement over, for calibration to take a clean one. */
  restartHandMeasure(): void {
    this.samples = []
    this.sampleTimer = 0
  }

  /** Saves this session's hand measurement, so the next session starts from it. */
  keepHandLength(): void {
    if (this.samples.length > 0) {
      this.saved.handLength = median(this.samples)
      this.save()
    }
  }

  get isCalibrated(): boolean {
    return Object.keys(this.saved.calibrated).length > 0
  }

  getCalibrated(name: string): number | null {
    const value = this.saved.calibrated[name]
    return typeof value === "number" ? value : null
  }

  setCalibrated(name: string, value: number): void {
    this.saved.calibrated[name] = value
    this.save()
  }

  /** Back to the Inspector values, still scaled to the hand and sensitivity. */
  clearCalibration(): void {
    this.saved.calibrated = {}
    this.saved.handLength = 0
    this.save()
  }

  /** Forces a threshold to `value` whatever the settings say, until {@link clearOverrides}. */
  override(tune: Tune, value: number): void {
    this.overrides.set(tune, value)
  }

  clearOverrides(): void {
    this.overrides.clear()
  }

  private sensitivityFactor(): number {
    switch (this.sensitivity) {
      case "low":
        return this.lowFactor
      case "high":
        return this.highFactor
      default:
        return 1
    }
  }

  private sampleHands(): void {
    this.sampleTimer += getDeltaTime()
    if (this.sampleTimer < HAND_SAMPLE_INTERVAL) {
      return
    }
    this.sampleTimer = 0

    for (let i = 0; i < AllHandTypes.length; i++) {
      const hand = SIK.HandInputData.getHand(AllHandTypes[i])
      if (hand === null || !hand.isTracked()) {
        continue
      }

      const length = handLength(hand)
      if (length === null || length < MIN_HAND_LENGTH || length > MAX_HAND_LENGTH) {
        continue
      }

      this.samples.push(length)
      if (this.samples.length > HAND_SAMPLES_KEPT) {
        this.samples.shift()
      }
    }
  }

  private load(): void {
    const json = global.persistentStorageSystem.store.getString(STORE_KEY)
    if (json === "") {
      return
    }

    try {
      const loaded = JSON.parse(json) as Partial<Saved>
      this.saved = {
        handLength: typeof loaded.handLength === "number" ? loaded.handLength : 0,
        calibrated: loaded.calibrated != null ? loaded.calibrated : {}
      }
    } catch (error) {
      print("GestureTuning: could not read the saved settings, starting from defaults. " + error)
    }
    this.log("loaded")
  }

  private save(): void {
    global.persistentStorageSystem.store.putString(STORE_KEY, JSON.stringify(this.saved))
    this.log("saved")
  }

  private log(what: string): void {
    if (this.debugLog) {
      print("GestureTuning " + what + ": " + JSON.stringify(this.saved) + " live hand " + this.handLength.toFixed(1) + " cm")
    }
  }
}
