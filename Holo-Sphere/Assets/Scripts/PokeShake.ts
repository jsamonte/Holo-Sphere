import {FingerPoke} from "./FingerPoke"
import {StrobeGhostTrail} from "./StrobeGhostTrail"

/**
 * The strobe burst is topped back up to this many seconds every frame the finger is in, and cut off
 * the moment it comes out - so this is only a safety net, never how long the flash actually lasts.
 */
const BURST_REFRESH = 0.25

/**
 * Makes a poke visible: for exactly as long as an index finger is poked into the sphere, it shudders
 * on the spot and strobes through its colours, dropping coloured afterimages as it shakes. The moment
 * the finger comes out, both stop, the afterimages clear, and the sphere is back where it was.
 *
 * It reads FingerPoke's isPoked every frame, so there is nothing to wire up. FingerPoke already
 * reports no poke while the sphere is pinched, squished, crushed, split or out on the yoyo, which is
 * what stops the shake the instant anything else takes hold. That matters for a pinch in particular:
 * the shake moves fast enough that YoyoFlick would otherwise read it as a flick.
 *
 * The shake is an offset added on top of wherever the sphere is and taken back off frame by frame,
 * so it never fights anything else that moves the sphere. The colour flash is StrobeGhostTrail's own
 * strobe, run fast.
 */
@component
export class PokeShake extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Shake</span>')

  @input
  @label("Strength")
  @hint("How far the sphere shakes, as a fraction of its radius. 0 turns the shake off.")
  @widget(new SliderWidget(0, 0.5, 0.01))
  strength: number = 0.12

  @input
  @label("Speed (Hz)")
  @hint("How fast it vibrates. Higher is a finer buzz, lower a slower wobble.")
  @widget(new SliderWidget(5, 60, 1))
  frequency: number = 26

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Colour Flash</span>')

  @input
  @label("Flash Colours")
  @hint("Strobe the sphere through its colours, with coloured afterimages, for as long as it is poked.")
  flashColours: boolean = true

  @input
  @label("Flash Interval (s)")
  @hint("Seconds each colour shows during the flash. Shorter flickers faster and drops more afterimages.")
  @widget(new SliderWidget(0.02, 0.24, 0.01))
  flashInterval: number = 0.05

  private poke: FingerPoke | null = null
  private strobe: StrobeGhostTrail | null = null

  private shaking = false

  /** Seconds since the current shake began, which drives the vibration. */
  private clock = 0

  /** The offset currently added to the sphere's position, taken back off before the next one. */
  private offset: vec3 = vec3.zero()

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())

    // The menu hides the sphere between runs. It must come back where it belongs, not mid-shake.
    this.createEvent("OnDisableEvent").bind(() => this.stop())
  }

  private init(): void {
    const owner = this.getSceneObject()

    this.poke = owner.getComponent(FingerPoke.getTypeName()) as FingerPoke
    this.strobe = owner.getComponent(StrobeGhostTrail.getTypeName()) as StrobeGhostTrail

    if (this.poke === null) {
      print("PokeShake: no FingerPoke on " + owner.name + ", pokes will not shake the sphere.")
      return
    }

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    if (!this.poke!.isPoked) {
      this.stop()
      return
    }

    if (!this.shaking) {
      this.shaking = true
      this.clock = 0
    }

    this.clock += getDeltaTime()

    if (this.flashColours && this.strobe !== null) {
      this.strobe.burst(BURST_REFRESH, this.flashInterval)
    }

    this.applyOffset(this.shakeOffset())
  }

  /** Ends the shake and the flash together, leaving the sphere exactly where it was. */
  private stop(): void {
    if (!this.shaking) {
      return
    }
    this.shaking = false
    this.applyOffset(vec3.zero())
    if (this.strobe !== null) {
      this.strobe.endBurst()
    }
  }

  /**
   * Three axes vibrating at unrelated rates, so the sphere rattles about rather than swinging along
   * one line.
   */
  private shakeOffset(): vec3 {
    const amount = this.radius() * this.strength
    const w = 2 * Math.PI * this.frequency * this.clock

    return new vec3(Math.sin(w), Math.sin(w * 1.31 + 1.7), Math.sin(w * 0.83 + 3.1)).uniformScale(amount)
  }

  /** Swaps last frame's offset for this one, so whatever else moved the sphere meanwhile stands. */
  private applyOffset(next: vec3): void {
    const transform = this.getTransform()
    transform.setWorldPosition(transform.getWorldPosition().sub(this.offset).add(next))
    this.offset = next
  }

  /** The sphere mesh is a unit sphere, so its radius is half its largest world scale axis. */
  private radius(): number {
    const scale = this.getTransform().getWorldScale()
    return Math.max(scale.x, Math.max(scale.y, scale.z)) * 0.5
  }
}
