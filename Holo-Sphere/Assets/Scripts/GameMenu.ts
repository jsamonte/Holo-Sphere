import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import {CrushPhase, FistCrush} from "./FistCrush"
import {TwoHandSplit} from "./TwoHandSplit"
import {YoyoFlick} from "./YoyoFlick"

/** Mirror of YoyoFlick's private YoyoState. See SphereEventAudio for why this is duplicated. */
const enum YoyoPhase {
  Idle = 0,
  Held = 1,
  Throwing = 2,
  Extended = 3,
  Returning = 4
}

/** The three things the game asks for. */
const enum Order {
  Duplicate = 0,
  Yoyo = 1,
  Collapse = 2
}

/** The tutorial asks for each order once, in this order. */
const ORDER_SEQUENCE: Order[] = [Order.Duplicate, Order.Yoyo, Order.Collapse]

/** Every order the rhythm game can pick from. */
const ALL_ORDERS: Order[] = [Order.Duplicate, Order.Yoyo, Order.Collapse]

/** Which menu button started the current run. Picks the music and the completion line. */
const enum Mode {
  Tutorial,
  Easy,
  Medium,
  Hard
}

const enum Stage {
  /** Menu up, waiting for a difficulty to be chosen. */
  Menu,
  /** Tutorial: an order has been given and we are waiting for the player to carry it out. */
  AwaitingOrder,
  /** Tutorial: order done. Good Job is playing before the next order. */
  Praising,
  /** Rhythm game: orders are being called out on the beat of the music. */
  Rhythm,
  /** Rhythm game: wrong move or too slow. Short pause before the menu comes back. */
  Failed,
  /** All orders done. The mode's completion line is playing. */
  Completing,
  /** The Ending Sequence is playing before the menu comes back. */
  Ending
}

/**
 * Difficulty menu, the tutorial, and the rhythm game.
 *
 * **Tutorial** calls out three orders in turn - duplicate, yoyo, collapse - explains each one, and
 * waits as long as the player needs.
 *
 * **Easy** is the rhythm game. Orders are called out on the beat of the Easy song, one every
 * Bars Per Order bars, with nothing asked during the first Silent Intro seconds. Each order must be
 * carried out before the next order's beat comes round. Doing a different move, or not doing it in
 * time, ends the run and returns to the menu. Orders To Win correct orders in a row plays the Easy
 * completion line, then the Ending Sequence, then the menu. Medium and Hard have no chart of their
 * own yet, so they run Easy.
 *
 * The beat clock is the music's own playback position rather than a timer, so the orders cannot
 * drift away from the song however long the run goes on, including across the song looping. The
 * BPM and First Downbeat defaults were measured from the Easy song itself.
 *
 * Orders are recognised by watching the sphere's own components, so an order is satisfied by
 * actually doing the thing rather than by any separate gesture plumbing:
 *
 * - **Duplicate** - TwoHandSplit's copy turning on.
 * - **Yoyo** - YoyoFlick leaving the hand.
 * - **Collapse** - FistCrush starting to shrink the sphere.
 *
 * Music and voice each get their own AudioComponent so an order is never cut off by the sphere's
 * own sound effects, and the music bed runs underneath everything.
 *
 * The sphere only exists while a run is going. It sits between the player and the menu, so its
 * grab volume would otherwise catch rays aimed at the buttons.
 */
@component
export class GameMenu extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Menu</span>')

  @input
  @label("Menu Root")
  @hint("Parent object holding the four buttons. Hidden while a run is going.")
  @allowUndefined
  menuRoot: SceneObject | null = null

  @input
  @label("Tutorial Button")
  @allowUndefined
  tutorialButton: SceneObject | null = null

  @input
  @label("Easy Button")
  @allowUndefined
  easyButton: SceneObject | null = null

  @input
  @label("Medium Button")
  @allowUndefined
  mediumButton: SceneObject | null = null

  @input
  @label("Hard Button")
  @allowUndefined
  hardButton: SceneObject | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Music</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">One bed per difficulty. Loops until the run ends.</span>'
  )

  @input @label("Tutorial Music") @allowUndefined tutorialMusic: AudioTrackAsset | null = null
  @input @label("Easy Music") @allowUndefined easyMusic: AudioTrackAsset | null = null
  @input @label("Medium Music") @allowUndefined mediumMusic: AudioTrackAsset | null = null
  @input @label("Hard Music") @allowUndefined hardMusic: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Orders</span>')

  @input @label("Duplicate It") @allowUndefined duplicateOrder: AudioTrackAsset | null = null
  @input @label("Yoyo It") @allowUndefined yoyoOrder: AudioTrackAsset | null = null
  @input @label("Collapse It") @allowUndefined collapseOrder: AudioTrackAsset | null = null
  @input @label("Good Job") @allowUndefined goodJob: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Tutorial Instructions</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Tutorial mode only. Each plays right after its order is called out.</span>'
  )

  @input
  @label("Duplicate Instruction")
  @hint("Explains how to split the sphere. Assets/Audio/Instruction/Duplicate Instuction.mp3.")
  @allowUndefined
  duplicateInstruction: AudioTrackAsset | null = null

  @input
  @label("Yoyo Instruction")
  @hint("Explains how to flick the sphere out. Assets/Audio/Instruction/Yoyo Instuction.mp3.")
  @allowUndefined
  yoyoInstruction: AudioTrackAsset | null = null

  @input
  @label("Collapse Instruction")
  @hint("Explains how to crush the sphere in a fist. Assets/Audio/Instruction/Collapse Instruction.mp3.")
  @allowUndefined
  collapseInstruction: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Completion</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">The mode\'s line plays first, then the Ending Sequence, then the menu.</span>'
  )

  @input @label("Tutorial Complete") @allowUndefined tutorialComplete: AudioTrackAsset | null = null
  @input @label("Easy Complete") @allowUndefined easyComplete: AudioTrackAsset | null = null
  @input @label("Medium Complete") @allowUndefined mediumComplete: AudioTrackAsset | null = null
  @input @label("Hard Complete") @allowUndefined hardComplete: AudioTrackAsset | null = null
  @input @label("Ending Sequence") @allowUndefined endingSequence: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Sphere</span>')

  @input
  @label("Sphere")
  @hint(
    "The Holo Sphere, whose TwoHandSplit, YoyoFlick and FistCrush are watched to tell when an \
order has been carried out. Hidden while the menu is up."
  )
  @allowUndefined
  sphere: SceneObject | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Timing</span>')

  @input
  @label("Music Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  musicVolume: number = 0.35

  @input
  @label("Voice Volume")
  @widget(new SliderWidget(0, 2, 0.05))
  voiceVolume: number = 1

  @input
  @label("Gap Before Instruction (s)")
  @hint("Tutorial mode: pause between an order finishing and its instruction starting.")
  @widget(new SliderWidget(0, 2, 0.1))
  instructionGap: number = 0.3

  @input
  @label("Gap After Praise (s)")
  @hint("Tutorial mode: pause between Good Job finishing and the next order being called out.")
  @widget(new SliderWidget(0, 3, 0.1))
  praiseGap: number = 1.2

  @input
  @label("Gap Before Ending (s)")
  @hint("Pause between the completion line finishing and the Ending Sequence starting.")
  @widget(new SliderWidget(0, 3, 0.1))
  endingGap: number = 0.6

  @input
  @label("Gap Before Menu (s)")
  @hint("Pause between the Ending Sequence finishing and the menu coming back.")
  @widget(new SliderWidget(0, 5, 0.1))
  finishGap: number = 2.5

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Rhythm (Easy)</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Measured from the Easy song: 123 BPM, first downbeat at 0.148 s. Medium and Hard run Easy for now.</span>'
  )

  @input
  @label("BPM")
  @hint("Tempo of the Easy song. Measured at 123.0 and steady for the whole track.")
  bpm: number = 123

  @input
  @label("First Downbeat (s)")
  @hint("Seconds into the song file where bar 1 lands. Every order is placed on a bar line counted from here.")
  firstDownbeat: number = 0.148

  @input
  @label("Beats Per Bar")
  @widget(new SliderWidget(2, 8, 1))
  beatsPerBar: number = 4

  @input
  @label("Bars Per Order")
  @hint(
    "An order is called on the first beat of every this-many bars, and must be done before the \
next one. 2 bars at 123 BPM is 3.9 s per order; 1 bar is 1.95 s."
  )
  @widget(new SliderWidget(1, 8, 1))
  barsPerOrder: number = 2

  @input
  @label("Silent Intro (s)")
  @hint("No orders until this many seconds into the song. The first order is the first bar line after it.")
  @widget(new SliderWidget(0, 30, 0.5))
  startDelay: number = 7

  @input
  @label("Orders To Win")
  @hint("Correct orders in a row needed to win.")
  orderCount: number = 100

  @input
  @label("Beat Offset (s)")
  @hint(
    "Nudges every order later (positive) or earlier (negative) against the music, if they sound \
slightly off the beat on device."
  )
  @widget(new SliderWidget(-0.25, 0.25, 0.005))
  beatOffset: number = 0

  @input
  @label("Gap Before Menu On Fail (s)")
  @hint("Pause between a failed order and the menu coming back.")
  @widget(new SliderWidget(0, 5, 0.1))
  failGap: number = 1

  private stage: Stage = Stage.Menu
  private mode: Mode = Mode.Tutorial
  private orderIndex = 0
  private timer = 0

  /**
   * Tutorial mode: an instruction waiting to follow the order that was just called out. Counted
   * down separately from `timer` because the order stays completable the whole time - the player
   * does not have to sit through the explanation if they already know what to do.
   */
  private instructionPending = false
  private instructionTimer = 0

  /**
   * Rhythm game: song times, in seconds since the music started and counting across loops, at
   * which each order is called. One longer than Orders To Win, since the slot after the last order
   * is that order's deadline. Built once the music reports its length.
   */
  private schedule: number[] = []
  private nextSlot = 0
  private ordersDone = 0
  /** The order waiting to be carried out, or null between an order being done and the next beat. */
  private currentOrder: Order | null = null

  private songLength = 0
  private songLoops = 0
  private lastSongPosition = 0

  private music: AudioComponent | null = null
  private voice: AudioComponent | null = null

  private split: TwoHandSplit | null = null
  private yoyo: YoyoFlick | null = null
  private crush: FistCrush | null = null

  private duplicateObject: SceneObject | null = null

  /** Where the sphere sat when the lens started, so every run begins from the same place. */
  private sphereHome: vec3 | null = null

  // Previous-frame snapshots, so each order is satisfied by a fresh transition rather than by a
  // state that already happened to be true when the order was given.
  private wasDuplicated = false
  private lastYoyoPhase: number = YoyoPhase.Idle
  private lastCrushPhase: CrushPhase = CrushPhase.Open

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    // Loose != throughout: an object input left empty in the Inspector arrives as undefined, which
    // a strict !== null check would let through.
    const owner = this.sphere != null ? this.sphere : this.getSceneObject()

    this.split = owner.getComponent(TwoHandSplit.getTypeName()) as TwoHandSplit
    this.yoyo = owner.getComponent(YoyoFlick.getTypeName()) as YoyoFlick
    this.crush = owner.getComponent(FistCrush.getTypeName()) as FistCrush

    if (this.sphere != null) {
      this.sphereHome = this.sphere.getTransform().getWorldPosition()
    }

    this.music = this.getSceneObject().createComponent("Component.AudioComponent") as AudioComponent
    this.music.volume = this.musicVolume

    this.voice = this.getSceneObject().createComponent("Component.AudioComponent") as AudioComponent
    this.voice.volume = this.voiceVolume

    this.bindButton(this.tutorialButton, Mode.Tutorial)
    this.bindButton(this.easyButton, Mode.Easy)
    this.bindButton(this.mediumButton, Mode.Medium)
    this.bindButton(this.hardButton, Mode.Hard)

    this.showMenu(true)

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private bindButton(button: SceneObject | null, mode: Mode): void {
    if (button == null) {
      return
    }

    const interactable = button.getComponent(Interactable.getTypeName()) as Interactable
    if (interactable === null) {
      print("GameMenu: " + button.name + " has no Interactable, it will not be clickable.")
      return
    }

    interactable.onInteractorTriggerStart.add((_event: InteractorEvent) => {
      // Guard here rather than unbinding, so the buttons stay wired for the next visit.
      if (this.stage === Stage.Menu) {
        this.startRun(mode)
      }
    })
  }

  private startRun(mode: Mode): void {
    // Medium and Hard have no chart of their own yet, so they run Easy - its song, its beat grid
    // and its completion line - until they do.
    this.mode = mode === Mode.Tutorial ? Mode.Tutorial : Mode.Easy

    // Moved home before it is shown, so it never flashes up wherever the last run left it.
    this.resetSphere()
    this.showMenu(false)
    this.playMusic(this.musicFor(this.mode))
    this.snapshotState()

    if (this.mode === Mode.Tutorial) {
      this.orderIndex = 0
      this.giveOrder()
      return
    }

    this.startRhythm()
  }

  private giveOrder(): void {
    const order = ORDER_SEQUENCE[this.orderIndex]

    this.playVoice(this.orderClipFor(order))

    // Only Tutorial mode explains itself. The instruction is queued to start once the order line
    // has finished, measured from the order clip's own length.
    const instruction = this.mode === Mode.Tutorial ? this.instructionFor(order) : null
    this.instructionPending = instruction != null
    this.instructionTimer = this.voiceLength() + this.instructionGap

    this.stage = Stage.AwaitingOrder
  }

  private onUpdate(): void {
    switch (this.stage) {
      case Stage.AwaitingOrder:
        this.checkOrder()
        // Checked after checkOrder, so an order finished this frame drops its instruction instead
        // of the instruction starting over the top of Good Job.
        if (this.stage === Stage.AwaitingOrder) {
          this.tickInstruction()
        }
        break

      case Stage.Praising:
        this.countDown(() => this.giveOrder())
        break

      case Stage.Rhythm:
        this.updateRhythm()
        break

      case Stage.Failed:
        this.countDown(() => this.returnToMenu())
        break

      case Stage.Completing:
        this.countDown(() => this.playEnding())
        break

      case Stage.Ending:
        this.countDown(() => this.returnToMenu())
        break

      default:
        break
    }

    // Snapshots refresh every frame regardless of stage, so an action taken before its order was
    // given cannot satisfy that order the instant it arrives.
    this.snapshotState()
  }

  private tickInstruction(): void {
    if (!this.instructionPending) {
      return
    }

    this.instructionTimer -= getDeltaTime()
    if (this.instructionTimer > 0) {
      return
    }

    this.instructionPending = false
    this.playVoice(this.instructionFor(ORDER_SEQUENCE[this.orderIndex]))
  }

  /** Runs down the timer set when the current stage was entered. */
  private countDown(onDone: () => void): void {
    this.timer -= getDeltaTime()
    if (this.timer <= 0) {
      onDone()
    }
  }

  private checkOrder(): void {
    if (!this.orderSatisfied(ORDER_SEQUENCE[this.orderIndex])) {
      return
    }

    // Done before the explanation got to play, so it is no longer needed.
    this.instructionPending = false
    this.orderIndex++

    if (this.orderIndex >= ORDER_SEQUENCE.length) {
      this.complete()
      return
    }

    this.playVoice(this.goodJob)
    this.timer = this.voiceLength() + this.praiseGap
    this.stage = Stage.Praising
  }

  private startRhythm(): void {
    // The schedule waits for the music to report its length, which is what places the orders
    // after each loop of the song back on that loop's own bar lines.
    this.schedule = []
    this.songLength = 0
    this.songLoops = 0
    this.lastSongPosition = 0

    this.nextSlot = 0
    this.ordersDone = 0
    this.currentOrder = null

    if (this.musicFor(this.mode) == null) {
      print("GameMenu: no music assigned for this mode, the rhythm game has no beat to follow.")
    }

    this.stage = Stage.Rhythm
  }

  private updateRhythm(): void {
    if (this.music === null || !this.music.isPlaying()) {
      return
    }

    if (this.schedule.length === 0) {
      this.songLength = this.music.duration
      if (this.songLength <= 0) {
        return
      }
      this.schedule = this.buildSchedule(this.songLength)
    }

    const now = this.songTime()

    if (this.currentOrder !== null) {
      if (this.orderSatisfied(this.currentOrder)) {
        this.currentOrder = null
        this.ordersDone++

        if (this.ordersDone >= this.orderCount) {
          this.complete()
          return
        }

        this.playVoice(this.goodJob)
      } else if (this.otherOrderDone(this.currentOrder)) {
        this.fail()
        return
      }
    }

    if (this.nextSlot >= this.schedule.length || now < this.schedule[this.nextSlot]) {
      return
    }

    // The next order's beat has come round with this one still not done: too slow.
    if (this.currentOrder !== null) {
      this.fail()
      return
    }

    this.currentOrder = ALL_ORDERS[Math.floor(Math.random() * ALL_ORDERS.length)]
    this.nextSlot++
    this.playVoice(this.orderClipFor(this.currentOrder))
  }

  /**
   * Seconds since the music started, counting across loops. The track's own position restarts at
   * zero each time it comes round again, so a jump backwards is counted as one more loop.
   */
  private songTime(): number {
    const position = this.music!.position

    if (position + 1 < this.lastSongPosition) {
      this.songLoops++
    }
    this.lastSongPosition = position

    return this.songLoops * this.songLength + position - this.beatOffset
  }

  /**
   * Every Bars Per Order bars from the first downbeat, from the end of the silent intro on. The
   * song's length is not a whole number of bars, so each loop restarts the grid at its own first
   * downbeat - and a slot that would come too soon after the last one of the previous loop is
   * skipped, so the seam never leaves less than most of a normal window to do an order in.
   */
  private buildSchedule(songLength: number): number[] {
    const barLength = (Math.max(1, Math.round(this.beatsPerBar)) * 60) / Math.max(1, this.bpm)
    const interval = barLength * Math.max(1, Math.round(this.barsPerOrder))
    const needed = Math.max(1, Math.round(this.orderCount)) + 1

    const slots: number[] = []
    let last = -interval

    for (let loopStart = 0; slots.length < needed; loopStart += songLength) {
      for (let t = this.firstDownbeat; t < songLength && slots.length < needed; t += interval) {
        const at = loopStart + t
        if (at >= this.startDelay && at - last >= interval * 0.75) {
          slots.push(at)
          last = at
        }
      }
    }

    return slots
  }

  private fail(): void {
    this.currentOrder = null
    this.stopMusic()
    this.stopVoice()
    this.timer = this.failGap
    this.stage = Stage.Failed
  }

  private complete(): void {
    this.playVoice(this.completionFor(this.mode))
    this.timer = this.voiceLength() + this.endingGap
    this.stage = Stage.Completing
  }

  private playEnding(): void {
    this.playVoice(this.endingSequence)
    this.timer = this.voiceLength() + this.finishGap
    this.stage = Stage.Ending
  }

  private returnToMenu(): void {
    this.stopMusic()
    this.showMenu(true)
    this.stage = Stage.Menu
  }

  private orderClipFor(order: Order): AudioTrackAsset | null {
    switch (order) {
      case Order.Duplicate:
        return this.duplicateOrder
      case Order.Yoyo:
        return this.yoyoOrder
      default:
        return this.collapseOrder
    }
  }

  private instructionFor(order: Order): AudioTrackAsset | null {
    switch (order) {
      case Order.Duplicate:
        return this.duplicateInstruction
      case Order.Yoyo:
        return this.yoyoInstruction
      default:
        return this.collapseInstruction
    }
  }

  private musicFor(mode: Mode): AudioTrackAsset | null {
    switch (mode) {
      case Mode.Easy:
        return this.easyMusic
      case Mode.Medium:
        return this.mediumMusic
      case Mode.Hard:
        return this.hardMusic
      default:
        return this.tutorialMusic
    }
  }

  private completionFor(mode: Mode): AudioTrackAsset | null {
    switch (mode) {
      case Mode.Easy:
        return this.easyComplete
      case Mode.Medium:
        return this.mediumComplete
      case Mode.Hard:
        return this.hardComplete
      default:
        return this.tutorialComplete
    }
  }

  /** Each order is a rising edge, so holding a state from before the order does not count. */
  private orderSatisfied(order: Order): boolean {
    switch (order) {
      case Order.Duplicate:
        return this.duplicateIsLive() && !this.wasDuplicated

      case Order.Yoyo: {
        const phase = this.readYoyoPhase()
        return phase === YoyoPhase.Throwing && this.lastYoyoPhase !== YoyoPhase.Throwing
      }

      case Order.Collapse: {
        const phase = this.readCrushPhase()
        return phase === CrushPhase.Crushing && this.lastCrushPhase !== CrushPhase.Crushing
      }

      default:
        return false
    }
  }

  /** True when this frame carried out any order other than the one asked for. */
  private otherOrderDone(asked: Order): boolean {
    for (let i = 0; i < ALL_ORDERS.length; i++) {
      if (ALL_ORDERS[i] !== asked && this.orderSatisfied(ALL_ORDERS[i])) {
        return true
      }
    }
    return false
  }

  private snapshotState(): void {
    this.wasDuplicated = this.duplicateIsLive()
    this.lastYoyoPhase = this.readYoyoPhase()
    this.lastCrushPhase = this.readCrushPhase()
  }

  private readYoyoPhase(): number {
    if (this.yoyo === null) {
      return YoyoPhase.Idle
    }
    const phase = (this.yoyo as any).state
    return typeof phase === "number" ? phase : YoyoPhase.Idle
  }

  private readCrushPhase(): CrushPhase {
    return this.crush !== null ? this.crush.crushPhase : CrushPhase.Open
  }

  private duplicateIsLive(): boolean {
    if (this.duplicateObject === null) {
      this.duplicateObject = this.findDuplicateObject()
    }
    return this.duplicateObject !== null && this.duplicateObject.enabled
  }

  private findDuplicateObject(): SceneObject | null {
    if (this.split !== null && this.split.secondSphere != null) {
      return this.split.secondSphere
    }

    const owner = this.sphere != null ? this.sphere : this.getSceneObject()
    const wanted = owner.name + " Copy"
    const count = global.scene.getRootObjectsCount()

    for (let i = 0; i < count; i++) {
      const candidate = global.scene.getRootObject(i)
      if (candidate.name === wanted) {
        return candidate
      }
    }

    return null
  }

  private showMenu(visible: boolean): void {
    if (this.menuRoot != null) {
      this.menuRoot.enabled = visible
    }

    // The sphere and the menu are never up together: the sphere stands between the player and the
    // buttons, and it is not meant to be played with until a mode has been chosen.
    if (this.sphere != null && this.sphere !== this.getSceneObject()) {
      this.sphere.enabled = !visible
    }

    // The copy lives at the scene root, so hiding the sphere does not hide it. A run that fails
    // mid-split would otherwise leave it floating in front of the menu.
    if (visible && this.duplicateIsLive()) {
      this.duplicateObject!.enabled = false
    }
  }

  /** Puts the sphere back where the lens started, so a run never begins with it out of reach. */
  private resetSphere(): void {
    if (this.sphere != null && this.sphereHome !== null) {
      this.sphere.getTransform().setWorldPosition(this.sphereHome)
    }
  }

  private playMusic(track: AudioTrackAsset | null): void {
    if (this.music === null || track == null) {
      return
    }

    this.stopMusic()
    this.music.audioTrack = track
    this.music.volume = this.musicVolume
    this.music.play(-1)
  }

  private stopMusic(): void {
    if (this.music !== null && this.music.isPlaying()) {
      this.music.stop(false)
    }
  }

  private stopVoice(): void {
    if (this.voice !== null && this.voice.isPlaying()) {
      this.voice.stop(false)
    }
  }

  /**
   * Duration of the clip the last playVoice call started, captured at that moment. Zero when that
   * call had no clip to play, so a missing line skips straight past rather than waiting out the
   * stale length of whatever played before it.
   */
  private lastVoiceDuration = 0

  private playVoice(track: AudioTrackAsset | null): void {
    if (this.voice === null || track == null) {
      this.lastVoiceDuration = 0
      return
    }

    if (this.voice.isPlaying()) {
      this.voice.stop(false)
    }

    this.voice.audioTrack = track
    this.voice.volume = this.voiceVolume
    this.voice.play(1)

    this.lastVoiceDuration = this.voice.duration
  }

  /** Length of the clip the voice channel was last told to play, so waits track it exactly. */
  private voiceLength(): number {
    return this.lastVoiceDuration
  }
}
