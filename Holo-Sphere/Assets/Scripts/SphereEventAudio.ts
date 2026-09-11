import {FingerPoke} from "./FingerPoke"
import {CrushPhase, FistCrush} from "./FistCrush"
import {PalmSquish, SquishPhase} from "./PalmSquish"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

/**
 * Mirror of YoyoFlick's own private YoyoState enum. Kept as plain numbers because that enum is
 * local to YoyoFlick and not exported, so it cannot be imported and compared against directly.
 *
 * If YoyoFlick's enum is ever reordered or gains a case in the middle, these must be updated to
 * match or the wrong sound will fire.
 */
const enum YoyoPhase {
  Idle = 0,
  Held = 1,
  Throwing = 2,
  Extended = 3,
  Returning = 4
}

/**
 * How far flat the sphere has to be pressed, as PalmSquish's squishAmount, for the Compress loop to
 * start, and how far it has to round back out for the loop to stop. The gap between them keeps a
 * hand hovering right at the surface from stuttering the loop on and off.
 */
const COMPRESS_START = 0.05
const COMPRESS_STOP = 0.02

/**
 * Plays a one-shot sound from the sphere's position at each moment the yoyo or the split changes
 * state, through a single AudioComponent so the effects can never overlap each other.
 *
 * Neither {@link YoyoFlick} nor {@link TwoHandSplit} raises events, so this watches their state
 * once a frame and fires on the edges rather than subscribing:
 *
 * - **Duplicate.** TwoHandSplit builds its copy disabled and enables it at the split, so the copy
 *   turning on is the moment the sphere came in two.
 * - **Throw.** YoyoFlick entering Throwing is the flick leaving the hand.
 * - **Away.** Entering Extended is the sphere reaching the end of the string.
 * - **Come back.** Entering Returning is it being called home.
 * - **Compress.** The Compress sound loops for as long as two flat hands actually have the
 *   sphere pressed in, and stops the moment it rounds back out or they let go.
 * - **Poke.** Each new poke of a straight index finger into the sphere plays the Poke sound once.
 *
 * Watching state rather than editing YoyoFlick and TwoHandSplit to add events keeps this script
 * independent of them, at the cost of reading a private field - see {@link YoyoPhase}.
 */
@component
export class SphereEventAudio extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Tracks</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">One sound per event. Leave any empty to stay silent for it.</span>'
  )

  @input
  @label("Duplicate")
  @hint("Played the moment the sphere splits in two. Assets/Audio/Duplicate.mp3.")
  @allowUndefined
  duplicateTrack: AudioTrackAsset | null = null

  @input
  @label("Throw Away")
  @hint("Played as the sphere is flicked out on the string. Assets/Audio/Short Throw Away.mp3.")
  @allowUndefined
  throwTrack: AudioTrackAsset | null = null

  @input
  @label("Away")
  @hint("Played once the sphere reaches full extension. Assets/Audio/Yoyo.mp3.")
  @allowUndefined
  awayTrack: AudioTrackAsset | null = null

  @input
  @label("Come Back")
  @hint("Played as the sphere flies home. Assets/Audio/Come Back.mp3.")
  @allowUndefined
  returnTrack: AudioTrackAsset | null = null

  @input
  @label("Shrink Or Expand")
  @hint(
    "Played when a fist crushes the sphere away and again when it swells back out of the hand. \
Assets/Audio/Shrink or Expand.mp3."
  )
  @allowUndefined
  shrinkExpandTrack: AudioTrackAsset | null = null

  @input
  @label("Compress")
  @hint(
    "Loops for as long as two flat hands are squishing the sphere, and stops as soon as they let \
it go. Assets/Audio/Compress.wav."
  )
  @allowUndefined
  compressTrack: AudioTrackAsset | null = null

  @input
  @label("Poke")
  @hint("Played once each time an index finger pokes into the sphere. Assets/Audio/Poke.mp3.")
  @allowUndefined
  pokeTrack: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Playback</span>')

  @input
  @label("Volume")
  @widget(new SliderWidget(0, 2, 0.05))
  volume: number = 0.5

  @input
  @label("Spatialize")
  @hint("Position the sound in 3D at the sphere, so it comes from wherever the sphere is.")
  spatialize: boolean = true

  @input
  @label("Loop While Away")
  @hint(
    "Hold the Away sound looping for as long as the sphere hangs at full extension, instead of \
playing it once on arrival. Stops the moment it is called back."
  )
  loopWhileAway: boolean = true

  @input
  @label("Play On Merge")
  @hint(
    "Also play the Duplicate sound when the two halves come back together, not just when they \
come apart. Off leaves the merge silent."
  )
  playOnMerge: boolean = true

  private yoyo: YoyoFlick | null = null
  private split: TwoHandSplit | null = null
  private crush: FistCrush | null = null
  private squish: PalmSquish | null = null
  private poke: FingerPoke | null = null
  private audio: AudioComponent | null = null

  private wasPoked = false

  private lastPhase: number = YoyoPhase.Idle
  private lastCrushPhase: CrushPhase = CrushPhase.Open
  /**
   * Whether the Compress loop is what this component is playing. Cleared by any other effect
   * taking over, so a compression ending can never cut off a sound that has since replaced it.
   */
  private compressLooping = false

  private duplicateObject: SceneObject | null = null
  private duplicateWasLive = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    const owner = this.getSceneObject()

    this.yoyo = owner.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.split = owner.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit
    this.crush = owner.getComponent(FistCrush.getTypeName()) as FistCrush
    this.squish = owner.getComponent(PalmSquish.getTypeName()) as PalmSquish
    this.poke = owner.getComponent(FingerPoke.getTypeName()) as FingerPoke

    if (
      this.yoyo === null &&
      this.split === null &&
      this.crush === null &&
      this.squish === null &&
      this.poke === null
    ) {
      print(
        "SphereEventAudio: no YoyoFlick, TwoHandSplit, FistCrush, PalmSquish or FingerPoke on " +
          owner.name +
          ", nothing will play."
      )
      return
    }

    // A single component is what guarantees the effects never overlap: starting any one of them
    // necessarily stops whatever it was playing before.
    this.audio = owner.createComponent("Component.AudioComponent") as AudioComponent
    this.audio.volume = this.volume
    this.audio.spatialAudio.enabled = this.spatialize

    this.lastPhase = this.readPhase()

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    this.checkSplit()
    this.checkYoyo()
    this.checkPoke()
    // Before the crush, so a fist closing mid-squish silences the loop and then plays the crush.
    this.checkSquish()
    this.checkCrush()
  }

  /** Each new poke - a finger going in, not one held there - plays the Poke sound once. */
  private checkPoke(): void {
    if (this.poke === null) {
      return
    }

    const poked = this.poke.isPoked
    if (poked && !this.wasPoked) {
      this.playExclusive(this.pokeTrack, 1)
    }
    this.wasPoked = poked
  }

  /**
   * The Compress sound loops for as long as the sphere is actually pressed in, and stops the moment
   * it rounds back out or the hands let go.
   *
   * It goes by how flat the sphere is rather than by PalmSquish's phase alone: that phase begins a
   * little before the palms reach the sphere and lasts until they are well clear of it, so the
   * sphere can be perfectly round again while it still reads as squishing. The springy wobble after
   * release is never Squishing, so it never restarts the loop.
   */
  private checkSquish(): void {
    if (this.squish === null) {
      return
    }

    const threshold = this.compressLooping ? COMPRESS_STOP : COMPRESS_START
    const pressed = this.squish.squishPhase === SquishPhase.Squishing && this.squish.squishAmount > threshold

    if (pressed === this.compressLooping) {
      return
    }

    if (pressed) {
      this.playExclusive(this.compressTrack, -1)
      this.compressLooping = this.compressTrack != null
      return
    }

    this.compressLooping = false
    this.stopCurrent()
  }

  /**
   * Both directions of the crush get the same sound: shrinking away inside the fist, and swelling
   * back out of the opening hand.
   */
  private checkCrush(): void {
    if (this.crush === null) {
      return
    }

    const phase = this.crush.crushPhase

    if (phase === this.lastCrushPhase) {
      return
    }

    this.lastCrushPhase = phase

    if (phase === CrushPhase.Crushing || phase === CrushPhase.Restoring) {
      this.playExclusive(this.shrinkExpandTrack, 1)
    }
  }

  /** The copy switching on is the split; switching off again is the merge. */
  private checkSplit(): void {
    const live = this.duplicateIsLive()

    if (live !== this.duplicateWasLive) {
      // Both edges are the moment the sphere count changes, so both get the same sound: coming
      // apart on the way up, coming back together on the way down.
      if (live || this.playOnMerge) {
        this.playExclusive(this.duplicateTrack, 1)
      }
    }

    this.duplicateWasLive = live
  }

  private checkYoyo(): void {
    const phase = this.readPhase()

    if (phase === this.lastPhase) {
      return
    }

    const previous = this.lastPhase
    this.lastPhase = phase

    switch (phase) {
      case YoyoPhase.Throwing:
        this.playExclusive(this.throwTrack, 1)
        break

      case YoyoPhase.Extended:
        this.playExclusive(this.awayTrack, this.loopWhileAway ? -1 : 1)
        break

      case YoyoPhase.Returning:
        this.playExclusive(this.returnTrack, 1)
        break

      default:
        // Dropped back to Idle or Held. Only silence a still looping Away sound; letting a
        // one-shot finish on its own keeps the come back landing from being clipped.
        if (previous === YoyoPhase.Extended && this.loopWhileAway) {
          this.stopCurrent()
        }
        break
    }
  }

  /**
   * YoyoFlick keeps its phase in a private field. TypeScript's `private` is erased at runtime, so
   * the cast reaches it; it is read only, and falls back to Idle when there is no YoyoFlick.
   */
  private readPhase(): number {
    if (this.yoyo === null) {
      return YoyoPhase.Idle
    }

    const phase = (this.yoyo as any).state

    return typeof phase === "number" ? phase : YoyoPhase.Idle
  }

  private duplicateIsLive(): boolean {
    if (this.duplicateObject === null) {
      this.duplicateObject = this.findDuplicateObject()
    }

    return this.duplicateObject !== null && this.duplicateObject.enabled
  }

  /**
   * Prefers the SceneObject TwoHandSplit was given in the Inspector. When that was left empty it
   * builds the copy itself without storing it back, so fall back to the name it assigns.
   */
  private findDuplicateObject(): SceneObject | null {
    if (this.split !== null && this.split.secondSphere != null) {
      return this.split.secondSphere
    }

    const wanted = this.getSceneObject().name + " Copy"
    const count = global.scene.getRootObjectsCount()

    for (let i = 0; i < count; i++) {
      const candidate = global.scene.getRootObject(i)
      if (candidate.name === wanted) {
        return candidate
      }
    }

    return null
  }

  /** `loops` of -1 repeats forever; 1 plays once. */
  private playExclusive(track: AudioTrackAsset | null, loops: number): void {
    if (this.audio === null || track == null) {
      return
    }

    this.stopCurrent()

    // Whatever plays now is no longer the Compress loop; checkSquish marks it again when it is.
    this.compressLooping = false

    this.audio.audioTrack = track
    this.audio.volume = this.volume
    this.audio.play(loops)
  }

  private stopCurrent(): void {
    if (this.audio !== null && this.audio.isPlaying()) {
      this.audio.stop(false)
    }
  }
}
