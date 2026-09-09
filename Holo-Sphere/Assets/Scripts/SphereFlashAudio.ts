import {StrobeGhostTrail} from "./StrobeGhostTrail"
import {TwoHandSplit} from "./TwoHandSplit"

/**
 * Plays a sound file from the sphere's own position on every tick of {@link StrobeGhostTrail}.
 *
 * The strobe only runs while the sphere is held or out on the yoyo string, so subscribing to its
 * flashes gives the grab and yoyo windows for free - there is no separate state to track here.
 *
 * - **Original.** Every flash triggers Main Track from an AudioComponent on this SceneObject, so
 *   the sound follows the sphere through space rather than sitting in the listener's head.
 * - **Duplicate.** Once {@link TwoHandSplit} has pulled the sphere in two, the copy answers with
 *   Duplicate Track from an AudioComponent of its own, positioned on the copy.
 *
 * Each sphere gets a small pool of AudioComponents rather than one. A single component can only
 * play a single sound at a time, so at a fast strobe each flash would cut the previous one off
 * mid-note; round-robining across a pool lets the tails overlap and ring instead.
 */
@component
export class SphereFlashAudio extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Tracks</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Audio files played on each strobe flash</span>'
  )

  @input
  @label("Main Track")
  @hint("Sound played from the original sphere on every flash. Assets/Audio/sphere-1.mp3.")
  @allowUndefined
  mainTrack: AudioTrackAsset | null = null

  @input
  @label("Duplicate Track")
  @hint(
    "Sound played from the second sphere once TwoHandSplit has split it. Assets/Audio/sphere-2.mp3. \
Leave empty to keep the copy silent."
  )
  @allowUndefined
  duplicateTrack: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Mix</span>')

  @input
  @label("Main Volume")
  @hint("Volume multiplier for the original sphere's flashes.")
  @widget(new SliderWidget(0, 2, 0.05))
  mainVolume: number = 1

  @input
  @label("Duplicate Volume")
  @hint("Volume multiplier for the copy's flashes, relative to its own track.")
  @widget(new SliderWidget(0, 2, 0.05))
  duplicateVolume: number = 0.9

  @input
  @label("Spatialize")
  @hint(
    "Position the sound in 3D at the sphere it belongs to. Turn off for a flat, non-directional \
mix that ignores where the spheres are."
  )
  spatialize: boolean = true

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Triggering</span>')

  @input
  @label("Voices Per Sphere")
  @hint(
    "How many overlapping sounds each sphere can hold. Raise if a fast strobe sounds clipped, \
lower to save memory."
  )
  @widget(new SliderWidget(1, 8, 1))
  voiceCount: number = 4

  @input
  @label("Min Interval (s)")
  @hint(
    "Shortest gap between sounds. 0 plays on every flash. Raise it to thin out a fast strobe so \
the audio does not machine gun."
  )
  @widget(new SliderWidget(0, 0.5, 0.01))
  minInterval: number = 0

  private strobe: StrobeGhostTrail | null = null
  private split: TwoHandSplit | null = null

  private mainVoices: AudioComponent[] = []
  private mainCursor = 0

  private duplicateVoices: AudioComponent[] = []
  private duplicateCursor = 0

  /** Resolved lazily: TwoHandSplit builds its copy at its own init, which may run after ours. */
  private duplicateObject: SceneObject | null = null
  private duplicateResolved = false

  private lastPlayTime = -1

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    this.strobe = this.getSceneObject().getComponent(
      StrobeGhostTrail.getTypeName()
    ) as StrobeGhostTrail

    if (this.strobe === null) {
      print(
        "SphereFlashAudio: no StrobeGhostTrail on " +
          this.getSceneObject().name +
          ", nothing will play."
      )
      return
    }

    this.split = this.getSceneObject().getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit

    this.mainVoices = this.buildVoices(this.getSceneObject(), this.mainTrack, this.mainVolume)

    this.strobe.onFlash.add(() => this.onFlash())
  }

  /**
   * Builds a pool of AudioComponents on `owner`, all loaded with the same track. Living on the
   * sphere's own SceneObject is what makes the sound come from the sphere.
   */
  private buildVoices(
    owner: SceneObject,
    track: AudioTrackAsset | null,
    volume: number
  ): AudioComponent[] {
    if (track == null) {
      return []
    }

    const voices: AudioComponent[] = []
    const count = Math.max(1, Math.round(this.voiceCount))

    for (let i = 0; i < count; i++) {
      const audio = owner.createComponent("Component.AudioComponent") as AudioComponent
      audio.audioTrack = track
      audio.volume = volume
      audio.spatialAudio.enabled = this.spatialize
      voices.push(audio)
    }

    return voices
  }

  private onFlash(): void {
    // Throttle before doing any work, so a raised Min Interval costs nothing per skipped flash.
    if (this.minInterval > 0) {
      const now = getTime()
      if (this.lastPlayTime >= 0 && now - this.lastPlayTime < this.minInterval) {
        return
      }
      this.lastPlayTime = now
    }

    this.playNext(this.mainVoices, this.mainCursor)
    this.mainCursor = this.advance(this.mainCursor, this.mainVoices.length)

    if (!this.duplicateIsLive()) {
      return
    }

    this.playNext(this.duplicateVoices, this.duplicateCursor)
    this.duplicateCursor = this.advance(this.duplicateCursor, this.duplicateVoices.length)
  }

  /**
   * True once the copy exists and is showing. TwoHandSplit builds its copy disabled and only
   * enables it at the moment of the split, so `enabled` doubles as "the sphere has split".
   */
  private duplicateIsLive(): boolean {
    if (this.duplicateTrack == null) {
      return false
    }

    if (!this.duplicateResolved) {
      this.duplicateObject = this.findDuplicateObject()

      if (this.duplicateObject !== null) {
        this.duplicateVoices = this.buildVoices(
          this.duplicateObject,
          this.duplicateTrack,
          this.duplicateVolume
        )
        this.duplicateResolved = true
      }
    }

    return this.duplicateObject !== null && this.duplicateObject.enabled
  }

  /**
   * Prefers the SceneObject TwoHandSplit was handed in the Inspector. When that input was left
   * empty TwoHandSplit builds the copy itself without storing it back, so fall back to the name
   * it gives that object.
   */
  private findDuplicateObject(): SceneObject | null {
    if (this.split !== null && this.split.secondSphere != null) {
      return this.split.secondSphere
    }

    const wanted = this.getSceneObject().name + " Copy"
    const root = global.scene.getRootObjectsCount()

    for (let i = 0; i < root; i++) {
      const candidate = global.scene.getRootObject(i)
      if (candidate.name === wanted) {
        return candidate
      }
    }

    return null
  }

  private playNext(voices: AudioComponent[], cursor: number): void {
    if (voices.length === 0) {
      return
    }

    const audio = voices[cursor]

    // Retrigger cleanly: without the stop, play() on an already sounding component is ignored
    // and the flash goes silent instead of restarting the note.
    if (audio.isPlaying()) {
      audio.stop(false)
    }

    audio.play(1)
  }

  private advance(cursor: number, length: number): number {
    if (length === 0) {
      return 0
    }
    return (cursor + 1) % length
  }
}
