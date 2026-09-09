import {StrobeGhostTrail} from "./StrobeGhostTrail"
import {YoyoFlick} from "./YoyoFlick"

/**
 * One chirp currently sounding. Voices are pooled and mixed additively, so the sphere's chirp
 * and the lower answer from its other half can overlap without cutting each other off.
 */
interface Voice {
  active: boolean
  /** Seconds still to wait before this voice starts, so chirps can be scheduled ahead. */
  delay: number
  time: number
  duration: number
  frequency: number
  freqStep: number
  phase: number
  amplitude: number
  env: number
  envDecay: number
  attackTime: number
}

const TWO_PI = Math.PI * 2

/** Semitones to a frequency multiplier. */
function pitch(semitones: number): number {
  return Math.pow(2, semitones / 12)
}

/**
 * Gives the strobe a voice.
 *
 * Every tick of {@link StrobeGhostTrail} chirps: a short electronic frequency sweep whose note
 * is picked by which of the three RGB colours just lit up, so the strobe reads as a rising
 * R -> G -> B arpeggio rather than three identical blips. Because it hangs off the trail's own
 * onFlash event rather than running a clock of its own, the sound cannot drift out of step with
 * the colour you are looking at.
 *
 * Three things bend that chirp:
 *
 * - **Duplicates.** Once the sphere has been pulled in two by {@link TwoHandSplit}, the copy
 *   answers the original a moment later an octave down, so you can hear that there are two of
 *   them. Each further copy drops another octave.
 * - **Yoyo.** While {@link YoyoFlick} has the sphere out on the string the whole sequence
 *   transposes up an octave, so a thrown sphere sings higher than one held in hand.
 * - **Shake.** Shaking the sphere subdivides each strobe interval into several chirps and
 *   shortens each one, so the arpeggio audibly speeds up the harder you shake it.
 *
 * The chirps are synthesised sample by sample into an Audio Output track rather than played from
 * wav files, because AudioComponent has no runtime pitch control - a file would be stuck at the
 * one note it was recorded at, which is exactly what this effect cannot be.
 *
 * Setup: add an **Audio Output** asset (Asset Browser -> + -> Audio Output) and an **Audio
 * Component**, then assign both below. Sample Rate here should match the asset's.
 */
@component
export class StrobeChirp extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Audio Output</span>')

  /**
   * The Audio Output track the chirps are written into, one frame per update.
   */
  @input
  @label("Audio Output Asset")
  @hint("Audio Output track asset the chirps are synthesised into. Asset Browser -> + -> Audio Output.")
  @allowUndefined
  audioOutput: AudioTrackAsset | null = null

  /**
   * The component that plays that track. Started looping on init, so Autoplay Loop does not
   * need to be ticked by hand.
   */
  @input
  @label("Audio Component")
  @hint("Audio Component that plays the Audio Output asset above. Started automatically on init.")
  @allowUndefined
  audio: AudioComponent | null = null

  /**
   * Must match the Sample Rate on the Audio Output asset, or every chirp comes out at the wrong
   * pitch. 16k keeps the per sample maths cheap and is far above what these chirps need.
   */
  @input
  @label("Sample Rate")
  @hint("Must match the Sample Rate set on the Audio Output asset, or the chirps play at the wrong pitch.")
  @widget(new SliderWidget(8000, 48000, 100))
  sampleRate: number = 16000

  /**
   * Overall chirp loudness.
   */
  @input
  @label("Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  volume: number = 0.5

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Notes</span>')

  /**
   * Note the first strobe colour chirps on. The three defaults spell a major triad, so the
   * strobe sounds like a rising arpeggio rather than three unrelated beeps.
   */
  @input
  @label("Color 1 Hz")
  @hint("Note the chirp uses when the strobe lands on Color 1. Default is C5.")
  @widget(new SliderWidget(100, 2000, 1))
  colorAHz: number = 523.25

  /**
   * Note the second strobe colour chirps on.
   */
  @input
  @label("Color 2 Hz")
  @hint("Note the chirp uses when the strobe lands on Color 2. Default is E5.")
  @widget(new SliderWidget(100, 2000, 1))
  colorBHz: number = 659.25

  /**
   * Note the third strobe colour chirps on.
   */
  @input
  @label("Color 3 Hz")
  @hint("Note the chirp uses when the strobe lands on Color 3. Default is G5.")
  @widget(new SliderWidget(100, 2000, 1))
  colorCHz: number = 783.99

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Chirp</span>')

  /**
   * How far the chirp glides while it sounds. This sweep is what makes it read as a chirp
   * rather than a beep; 0 flattens it into a blip.
   */
  @input
  @label("Sweep (semitones)")
  @hint("How far each chirp glides in pitch while it sounds. 0 is a flat beep, higher is a steeper chirp.")
  @widget(new SliderWidget(-24, 24, 1))
  sweepSemitones: number = 7

  /**
   * Length of one chirp, before shake shortens it.
   */
  @input
  @label("Chirp Length (s)")
  @hint("Length of a single chirp. Automatically capped so chirps never run into each other.")
  @widget(new SliderWidget(0.02, 0.4, 0.01))
  chirpDuration: number = 0.09

  /**
   * How sharply the chirp dies away over its length. Higher is a tighter electronic blip,
   * lower lets it ring.
   */
  @input
  @label("Decay")
  @hint("How sharply a chirp dies away. Higher is a tighter electronic blip, lower lets it ring.")
  @widget(new SliderWidget(0.5, 12, 0.5))
  decayRate: number = 4

  /**
   * Level of the 2nd harmonic. Along with the 3rd this is what gives the chirp its electronic
   * edge instead of a bare sine tone.
   */
  @input
  @label("Harmonic 2")
  @hint("Level of the 2nd harmonic. Adds the electronic edge; 0 leaves a pure sine.")
  @widget(new SliderWidget(0, 1, 0.05))
  harmonic2: number = 0.35

  /**
   * Level of the 3rd harmonic.
   */
  @input
  @label("Harmonic 3")
  @hint("Level of the 3rd harmonic. More buzz and bite.")
  @widget(new SliderWidget(0, 1, 0.05))
  harmonic3: number = 0.15

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Duplicate Sphere</span>')

  /**
   * How far below the original the split copy answers. Negative is lower, which is the point:
   * an octave down by default.
   */
  @input
  @label("Duplicate Pitch (semitones)")
  @hint("Pitch offset of the copy's chirp once the sphere has been split. Negative is lower; -12 is an octave down.")
  @widget(new SliderWidget(-24, 0, 1))
  duplicateSemitones: number = -12

  /**
   * Gap between the original's chirp and the copy's answer, so the pair reads as two spheres
   * rather than one thick chord.
   */
  @input
  @label("Duplicate Delay (s)")
  @hint("Gap between the original's chirp and the copy's lower answer, so you hear them as two spheres.")
  @widget(new SliderWidget(0, 0.15, 0.005))
  duplicateDelay: number = 0.035

  /**
   * Loudness of the copy's chirp relative to the original's.
   */
  @input
  @label("Duplicate Volume")
  @hint("Loudness of the copy's chirp relative to the original's.")
  @widget(new SliderWidget(0, 1, 0.05))
  duplicateVolume: number = 0.75

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Yoyo</span>')

  /**
   * How far every chirp transposes while the sphere is out on the string. Read straight off the
   * YoyoFlick on this SceneObject, if there is one.
   */
  @input
  @label("Yoyo Pitch (semitones)")
  @hint("Pitch offset applied to every chirp while the yoyo is flying. Positive is higher; +12 is an octave up.")
  @widget(new SliderWidget(0, 24, 1))
  yoyoSemitones: number = 12

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Shake</span>')

  /**
   * Extra chirps packed into one strobe interval at full shake. At 3, a shaken sphere fires
   * four chirps per colour instead of one.
   */
  @input
  @label("Shake Extra Chirps")
  @hint("Extra chirps packed into each strobe interval at full shake. 0 disables the speed up.")
  @widget(new SliderWidget(0, 6, 1))
  shakeExtraChirps: number = 3

  /**
   * How much shorter each chirp gets at full shake, on top of firing more often.
   */
  @input
  @label("Shake Shortening")
  @hint("How much shorter each chirp gets at full shake. 0.5 halves its length.")
  @widget(new SliderWidget(0, 0.9, 0.05))
  shakeShortening: number = 0.5

  /**
   * How fast the sphere has to be reversing direction to count as being shaken, in sphere
   * widths per second. Measured against the sphere's own scale so it survives a resize.
   */
  @input
  @label("Shake Sensitivity")
  @hint("How hard you have to shake to register, in sphere widths per second. Lower is more sensitive.")
  @widget(new SliderWidget(0.5, 12, 0.5))
  shakeMinSpeed: number = 3

  /**
   * Seconds of stillness before a full shake has decayed back to none.
   */
  @input
  @label("Shake Decay (s)")
  @hint("How long the speed up lingers after you stop shaking.")
  @widget(new SliderWidget(0.1, 2, 0.05))
  shakeDecay: number = 0.45

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Advanced</span>')

  /**
   * Size of the voice pool. Every overlapping chirp takes one; shaking a split sphere can want
   * a dozen at once. The oldest voice is stolen when they run out.
   */
  @input
  @label("Max Voices")
  @hint("How many chirps can sound at once. The oldest is stolen when they all run out.")
  @widget(new SliderWidget(4, 32, 1))
  maxVoices: number = 16

  private strobe: StrobeGhostTrail | null = null
  private yoyo: YoyoFlick | null = null

  private provider: any = null
  private buffer: Float32Array | null = null

  private voices: Voice[] = []
  private nextVoice = 0

  private colorHz: number[] = []

  private transform: Transform | null = null
  private lastPosition: vec3 | null = null
  private velocity: vec3 = new vec3(0, 0, 0)
  private shake = 0

  /** Manual override, for when there is no YoyoFlick to read the state off. */
  private yoyoOverride = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    this.transform = this.getTransform()
    this.colorHz = [this.colorAHz, this.colorBHz, this.colorCHz]
    this.buildVoicePool()

    // Loose == throughout for Inspector inputs: an unassigned asset or component arrives as
    // undefined rather than null, so a strict check would sail straight past it.
    if (this.audioOutput == null) {
      // Left silent rather than disabled: the sphere is perfectly usable without its voice, and
      // an unconfigured component must not take the whole lens down with it.
      print("StrobeChirp: no Audio Output asset assigned, the sphere will strobe silently.")
      return
    }
    this.provider = this.audioOutput.control

    // Only an Audio Output track can be written into. Anything else - a wav dropped in by
    // mistake, a licensed track - has no frame queue, so say so plainly rather than throwing
    // on the first update.
    if (this.provider == null || typeof this.provider.getPreferredFrameSize !== "function") {
      print("StrobeChirp: '" + this.audioOutput.name + "' is not an Audio Output track, so nothing can be written into it.")
      this.provider = null
      return
    }

    if (this.audio != null) {
      this.audio.audioTrack = this.audioOutput
      // Looped forever: the track is a live stream, it is never meant to reach an end.
      this.audio.play(-1)
    } else {
      print("StrobeChirp: no Audio Component assigned, the generated audio will never be heard.")
    }

    this.strobe = this.getSceneObject().getComponent(StrobeGhostTrail.getTypeName()) as StrobeGhostTrail
    if (this.strobe == null) {
      print("StrobeChirp: no StrobeGhostTrail on " + this.getSceneObject().name + ", nothing will chirp.")
    } else {
      this.strobe.onFlash.add((colorIndex) => this.onFlash(colorIndex))
    }

    // Optional: without it the yoyo transpose simply never engages.
    this.yoyo = this.getSceneObject().getComponent(YoyoFlick.getTypeName()) as YoyoFlick

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private buildVoicePool(): void {
    const count = Math.max(1, Math.floor(this.maxVoices))
    for (let i = 0; i < count; i++) {
      this.voices.push({
        active: false,
        delay: 0,
        time: 0,
        duration: 1,
        frequency: 440,
        freqStep: 0,
        phase: 0,
        amplitude: 0,
        env: 0,
        envDecay: 1,
        attackTime: 0.002
      })
    }
  }

  /**
   * Forces the yoyo transpose on or off by hand. Only needed when there is no YoyoFlick on the
   * sphere for this to read the state off itself.
   */
  setYoyoActive(active: boolean): void {
    this.yoyoOverride = active
  }

  /**
   * How hard the sphere is currently being shaken, 0 to 1.
   */
  getShake(): number {
    return this.shake
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()
    this.updateShake(deltaTime)
    this.renderAudio()
  }

  /**
   * Reads shake off the sphere's own motion. A shake is the hand repeatedly reversing
   * direction, so direction flips at speed are what gets counted and left to decay - distance
   * covered is deliberately not part of it, since a fast straight drag is not a shake.
   */
  private updateShake(deltaTime: number): void {
    const transform = this.transform!
    const position = transform.getWorldPosition()

    if (this.lastPosition === null) {
      this.lastPosition = position
      return
    }

    // Clamped so one dropped frame cannot report an enormous velocity.
    const dt = Math.max(deltaTime, 1 / 240)
    const instant = position.sub(this.lastPosition).uniformScale(1 / dt)
    this.lastPosition = position

    const scale = transform.getWorldScale()
    const size = Math.max(scale.x, Math.max(scale.y, scale.z))
    const threshold = this.shakeMinSpeed * size

    const previous = this.velocity
    // Light smoothing: enough to reject tracking jitter, not enough to blunt a real reversal.
    this.velocity = previous.add(instant.sub(previous).uniformScale(0.5))

    if (previous.length > threshold && this.velocity.length > threshold) {
      if (previous.normalize().dot(this.velocity.normalize()) < -0.2) {
        // A reversal at speed. Each one tops the meter up, so sustained shaking holds it near 1.
        this.shake = Math.min(1, this.shake + 0.5)
      }
    }

    this.shake = Math.max(0, this.shake - deltaTime / Math.max(0.05, this.shakeDecay))
  }

  /**
   * One tick of the strobe: the sphere chirps, and every copy of it answers lower, one octave
   * further down per copy so a split sphere is audibly two things.
   */
  private onFlash(colorIndex: number): void {
    const transpose = this.isYoyoFlying() ? this.yoyoSemitones : 0
    const base = this.colorHz[colorIndex % this.colorHz.length]

    this.fireChirps(base * pitch(transpose), 1, 0)

    const copies = this.strobe != null ? this.strobe.getMirrorCount() : 0
    for (let i = 1; i <= copies; i++) {
      this.fireChirps(
        base * pitch(transpose + this.duplicateSemitones * i),
        this.duplicateVolume,
        this.duplicateDelay * i
      )
    }
  }

  /**
   * Fires one chirp - or, while the sphere is being shaken, a burst of them evenly subdividing
   * the strobe interval, which is what makes the chirping speed up.
   */
  private fireChirps(frequency: number, amplitude: number, delay: number): void {
    const repeats = 1 + Math.round(this.shake * this.shakeExtraChirps)
    const interval = this.strobeInterval() / repeats
    const duration = Math.min(
      this.chirpDuration * (1 - this.shake * this.shakeShortening),
      // Never let a chirp outlast its own slot, or a shaken burst smears into one flat tone.
      interval * 0.9
    )

    for (let i = 0; i < repeats; i++) {
      this.spawnVoice(frequency, duration, amplitude, delay + i * interval)
    }
  }

  private isYoyoFlying(): boolean {
    return this.yoyo != null ? this.yoyo.isFlying() : this.yoyoOverride
  }

  private strobeInterval(): number {
    return Math.max(0.01, this.strobe != null ? this.strobe.strobeInterval : 0.12)
  }

  private spawnVoice(frequency: number, duration: number, amplitude: number, delay: number): void {
    const voice = this.voices[this.nextVoice]
    this.nextVoice = (this.nextVoice + 1) % this.voices.length

    const length = Math.max(0.01, duration)
    const samples = Math.max(1, length * this.sampleRate)

    voice.active = true
    voice.delay = Math.max(0, delay)
    voice.time = 0
    voice.duration = length
    voice.frequency = frequency
    // Linear sweep: over chirps this short it is indistinguishable from a true glide, and it
    // saves a pow() on every single sample.
    voice.freqStep = (frequency * pitch(this.sweepSemitones) - frequency) / samples
    voice.phase = 0
    voice.amplitude = amplitude
    voice.env = 1
    // Folded into a per sample multiply, so the envelope costs no exp() per sample either.
    voice.envDecay = Math.exp(-this.decayRate / samples)
    voice.attackTime = Math.max(0.002, length * 0.08)
  }

  private renderAudio(): void {
    if (this.provider == null) {
      return
    }

    const frameSize = this.provider.getPreferredFrameSize()
    if (frameSize <= 0) {
      return
    }

    if (this.buffer === null || this.buffer.length < frameSize) {
      this.buffer = new Float32Array(frameSize)
    }
    const buffer = this.buffer

    for (let i = 0; i < frameSize; i++) {
      buffer[i] = 0
    }

    const dt = 1 / this.sampleRate
    for (let i = 0; i < this.voices.length; i++) {
      if (this.voices[i].active) {
        this.renderVoice(this.voices[i], buffer, frameSize, dt)
      }
    }

    // Soft clip rather than a hard limit, so a shaken burst of overlapping chirps compresses
    // instead of crackling.
    const volume = this.volume
    for (let i = 0; i < frameSize; i++) {
      const sample = buffer[i] * volume
      buffer[i] = sample / (1 + Math.abs(sample))
    }

    this.provider.enqueueAudioFrame(buffer, new vec3(frameSize, 1, 1))
  }

  private renderVoice(voice: Voice, buffer: Float32Array, frameSize: number, dt: number): void {
    let phase = voice.phase
    let frequency = voice.frequency
    let env = voice.env
    let time = voice.time

    for (let i = 0; i < frameSize; i++) {
      if (voice.delay > 0) {
        voice.delay -= dt
        continue
      }

      if (time >= voice.duration) {
        voice.active = false
        break
      }

      phase += TWO_PI * frequency * dt
      if (phase > TWO_PI) {
        phase -= TWO_PI
      }

      const wave =
        Math.sin(phase) + this.harmonic2 * Math.sin(2 * phase) + this.harmonic3 * Math.sin(3 * phase)

      const attack = time < voice.attackTime ? time / voice.attackTime : 1
      // The linear tail guarantees the voice reaches exactly zero, so ending it cannot click.
      const tail = 1 - time / voice.duration
      buffer[i] += wave * attack * env * tail * voice.amplitude

      frequency += voice.freqStep
      env *= voice.envDecay
      time += dt
    }

    voice.phase = phase
    voice.frequency = frequency
    voice.env = env
    voice.time = time
  }
}
