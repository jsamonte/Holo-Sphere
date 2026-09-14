import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import WorldCameraFinderProvider from "../SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CalibrationMode} from "./CalibrationMode"
import {FingerPoke} from "./FingerPoke"
import {CrushPhase, FistCrush} from "./FistCrush"
import {GestureCues} from "./GestureCues"
import {GlobalLeaderboard} from "./GlobalLeaderboard"
import {PalmSquish, SquishPhase} from "./PalmSquish"
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

/** The five things the game asks for. */
const enum Order {
  Duplicate = 0,
  Yoyo = 1,
  Collapse = 2,
  Compress = 3,
  Poke = 4
}

/** The tutorial asks for each order once, in this order. */
const ORDER_SEQUENCE: Order[] = [Order.Duplicate, Order.Yoyo, Order.Collapse, Order.Compress, Order.Poke]

/** Every order the rhythm game can pick from, each exactly once so each is equally likely. */
const ALL_ORDERS: Order[] = [Order.Duplicate, Order.Yoyo, Order.Collapse, Order.Compress, Order.Poke]

/** Beat grid and win condition for one rhythm mode, read from that mode's Inspector section. */
interface RhythmChart {
  bpm: number
  firstDownbeat: number
  beatsPerBar: number
  barsPerOrder: number
  startDelay: number
  orderCount: number
  beatOffset: number
}

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
  /** Rhythm game: wrong move or too slow. Short pause, then the Ending Sequence and the leaderboard. */
  Failed,
  /** All orders done. The mode's completion line is playing. */
  Completing,
  /** The Ending Sequence is playing before the menu, or a rhythm mode's leaderboard, comes up. */
  Ending,
  /** Rhythm game over: the mode's leaderboard is up until its Main Menu button is pressed. */
  Leaderboard,
  /** The Calibration panel is up, measuring the player, until it hands back to the menu. */
  Calibrating
}

/**
 * Difficulty menu, the tutorial, and the rhythm game.
 *
 * **Tutorial** calls out the five orders in turn - duplicate, yoyo, collapse, compress, poke -
 * explains each one, and waits as long as the player needs, explaining it again each time Repeat
 * Instructions After seconds go by without it being done.
 *
 * **Easy** is the rhythm game. Orders are called out on the beat of the Easy song, one every
 * Bars Per Order bars, with nothing asked during the first Silent Intro seconds. Each order must be
 * carried out before the next order's beat comes round, with no Good Job in between - the next
 * order arriving on the beat is the only sign it counted. Doing a different move, or not doing it
 * in time, ends the run with the Ending Sequence, and the leaderboard follows. With Orders To Win
 * at 0 the run is endless; above 0, that many correct orders in a row wins, playing the Easy
 * completion line before the Ending Sequence.
 *
 * **Medium** and **Hard** are the same game on their own songs, each with its own beat grid,
 * silent intro and pace from its Rhythm section, and its own completion line. Each is faster than
 * the one before: an order every 3.9 s on Easy, 3.5 s on Medium and 2.4 s on Hard.
 *
 * **Leaderboard.** A rhythm run's score - its correct orders in a row - is posted to that mode's
 * global leaderboard the moment the run ends, or with no internet kept on the headset under a name
 * the player types. The leaderboard takes the menu's place once the Ending Sequence is over, and
 * its Main Menu button brings the menu back. The Tutorial is not scored.
 *
 * **Calibrate** brings up the Calibration panel over its own music: the player's hand size,
 * each gesture done a few times, and a sensitivity, all saved on the headset for every mode. See
 * CalibrationMode. Its Done or Exit brings the menu back.
 *
 * The beat clock is the music's own playback position rather than a timer, so the orders cannot
 * drift away from the song however long the run goes on, including across the song looping. The
 * BPM and First Downbeat defaults were measured from each song itself.
 *
 * Orders are recognised by watching the sphere's own components, so an order is satisfied by
 * actually doing the thing rather than by any separate gesture plumbing:
 *
 * - **Duplicate** - TwoHandSplit's copy turning on.
 * - **Yoyo** - YoyoFlick leaving the hand.
 * - **Collapse** - FistCrush starting to shrink the sphere.
 * - **Compress** - PalmSquish pressing the sphere at least Compress Depth of the way flat.
 * - **Poke** - FingerPoke seeing a straight index finger pushed into the sphere.
 *
 * The rhythm game picks each order at random from all five, so every order is equally likely.
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

  @input
  @label("Calibrate Button")
  @allowUndefined
  calibrateButton: SceneObject | null = null

  @input
  @label("Calibration")
  @hint("The Calibration panel, whose CalibrationMode measures the player's hands and gestures. Left empty, the Calibrate button does nothing.")
  @allowUndefined
  calibrationRoot: SceneObject | null = null

  @input
  @label("Leaderboard")
  @hint(
    "The Leaderboard panel, whose GlobalLeaderboard shows each rhythm mode's top scores after a run - \
global, or the headset's own when offline. Left empty, runs go straight back to the menu."
  )
  @allowUndefined
  leaderboardRoot: SceneObject | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Music</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Menu Music loops while the menu is up. Each mode\'s bed loops until its run ends.</span>'
  )

  @input
  @label("Menu Music")
  @hint("Loops for as long as the menu is showing, and stops the moment a mode is chosen.")
  @allowUndefined
  menuMusic: AudioTrackAsset | null = null

  @input @label("Tutorial Music") @allowUndefined tutorialMusic: AudioTrackAsset | null = null
  @input @label("Easy Music") @allowUndefined easyMusic: AudioTrackAsset | null = null
  @input @label("Medium Music") @allowUndefined mediumMusic: AudioTrackAsset | null = null
  @input @label("Hard Music") @allowUndefined hardMusic: AudioTrackAsset | null = null

  @input
  @label("Calibration Music")
  @hint("Loops while the Calibration panel is up. Left empty, calibration uses the Tutorial Music.")
  @allowUndefined
  calibrationMusic: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Orders</span>')

  @input @label("Duplicate It") @allowUndefined duplicateOrder: AudioTrackAsset | null = null
  @input @label("Yoyo It") @allowUndefined yoyoOrder: AudioTrackAsset | null = null
  @input @label("Collapse It") @allowUndefined collapseOrder: AudioTrackAsset | null = null
  @input @label("Compress It") @allowUndefined compressOrder: AudioTrackAsset | null = null
  @input @label("Poke It") @allowUndefined pokeOrder: AudioTrackAsset | null = null
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

  @input
  @label("Compress Instruction")
  @hint("Explains how to squish the sphere between two flat hands. Assets/Audio/Instruction/Compress Instructions.mp3.")
  @allowUndefined
  compressInstruction: AudioTrackAsset | null = null

  @input
  @label("Poke Instruction")
  @hint("Explains how to poke the sphere with an index finger. Assets/Audio/Instruction/Poke Instructions.mp3.")
  @allowUndefined
  pokeInstruction: AudioTrackAsset | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Completion</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">The mode\'s line plays first, then the Ending Sequence. Rhythm modes only get here when their Orders To Win is above 0.</span>'
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
    "The Holo Sphere, whose TwoHandSplit, YoyoFlick, FistCrush, PalmSquish and FingerPoke are \
watched to tell when an order has been carried out. Hidden while the menu is up."
  )
  @allowUndefined
  sphere: SceneObject | null = null

  @input
  @label("Compress Depth")
  @hint(
    "How flat the sphere has to be squished for Compress It to count, from 0 (palms just touching \
it) to 1 (as flat as PalmSquish goes)."
  )
  @widget(new SliderWidget(0.05, 1, 0.05))
  compressDepth: number = 0.5

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
  @label("Repeat Instructions After (s)")
  @hint(
    "Tutorial mode: if an order still is not done this many seconds after its instructions finish \
playing, they play again - and again after each repeat - until it is. 0 never repeats them."
  )
  @widget(new SliderWidget(0, 60, 1))
  repeatInstructionsAfter: number = 15

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
  @hint("Pause between the Ending Sequence finishing and the menu, or a rhythm mode's leaderboard, coming up.")
  @widget(new SliderWidget(0, 5, 0.1))
  finishGap: number = 2.5

  @input
  @label("Gap Before Ending On Fail (s)")
  @hint(
    "Rhythm modes: pause between a failed order and the Ending Sequence starting. The leaderboard \
follows the Ending Sequence."
  )
  @widget(new SliderWidget(0, 5, 0.1))
  failGap: number = 1

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Rhythm (Easy)</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Measured from the Easy song: 123 BPM, first downbeat at 0.148 s. After the 4 s silent intro the first order lands on the downbeat at 4.05 s.</span>'
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
  startDelay: number = 4

  @input
  @label("Orders To Win")
  @hint("Correct orders in a row that win the run. 0 never ends it: the run goes on until an order is missed.")
  orderCount: number = 0

  @input
  @label("Beat Offset (s)")
  @hint(
    "Nudges every order later (positive) or earlier (negative) against the music, if they sound \
slightly off the beat on device."
  )
  @widget(new SliderWidget(-0.25, 0.25, 0.005))
  beatOffset: number = 0

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Rhythm (Medium)</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Measured from the Medium song, Fridays: 136 BPM, first downbeat at 1.060 s. After the 4 s silent intro the first order lands on the downbeat at 4.59 s.</span>'
  )

  @input
  @label("BPM")
  @hint("Tempo of the Medium song, Fridays. Measured at 136.0 and steady for the whole track.")
  mediumBpm: number = 136

  @input
  @label("First Downbeat (s)")
  @hint("Seconds into the song file where bar 1 lands. Every order is placed on a bar line counted from here.")
  mediumFirstDownbeat: number = 1.06

  @input
  @label("Beats Per Bar")
  @widget(new SliderWidget(2, 8, 1))
  mediumBeatsPerBar: number = 4

  @input
  @label("Bars Per Order")
  @hint(
    "An order is called on the first beat of every this-many bars, and must be done before the \
next one. 2 bars at 136 BPM is 3.5 s per order; 1 bar is 1.76 s."
  )
  @widget(new SliderWidget(1, 8, 1))
  mediumBarsPerOrder: number = 2

  @input
  @label("Silent Intro (s)")
  @hint("No orders until this many seconds into the song. The first order is the first bar line after it.")
  @widget(new SliderWidget(0, 30, 0.5))
  mediumStartDelay: number = 4

  @input
  @label("Orders To Win")
  @hint("Correct orders in a row that win the run. 0 never ends it: the run goes on until an order is missed.")
  mediumOrderCount: number = 0

  @input
  @label("Beat Offset (s)")
  @hint(
    "Nudges every order later (positive) or earlier (negative) against the music, if they sound \
slightly off the beat on device."
  )
  @widget(new SliderWidget(-0.25, 0.25, 0.005))
  mediumBeatOffset: number = 0

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Rhythm (Hard)</span>')
  @ui.label(
    '<span style="color: #94A3B8; font-size: 11px;">Measured from the Hard song, The Cutback: 147 BPM, first downbeat at 0.230 s. The grid starts on that downbeat, so after the 4 s silent intro the first order lands on beat 1 at 5.13 s. The drop is at 13.29 s.</span>'
  )

  @input
  @label("BPM")
  @hint("Tempo of the Hard song, The Cutback. Measured at 147.0 and steady for the whole track.")
  hardBpm: number = 147

  @input
  @label("First Downbeat (s)")
  @hint(
    "Seconds into the song file of the downbeat the order grid is counted from, in beats. Any downbeat \
works; 0.230 s is the song's first, which puts the first order after the silent intro on beat 1. With 6 beats \
between orders the grid alternates beats 1 and 3, so a grid a bar later would put it on beat 3 instead."
  )
  hardFirstDownbeat: number = 0.23

  @input
  @label("Beats Per Bar")
  @widget(new SliderWidget(2, 8, 1))
  hardBeatsPerBar: number = 4

  @input
  @label("Bars Per Order")
  @hint(
    "An order is called every this-many bars, rounded to the nearest beat, and must be done before \
the next one. 1.5 bars at 147 BPM is 6 beats, 2.4 s per order, alternating the first and third beat \
of the bar and clearly faster than Medium's 3.5 s. 2 bars would be 3.3 s, every order on beat 1."
  )
  @widget(new SliderWidget(1, 8, 0.25))
  hardBarsPerOrder: number = 1.5

  @input
  @label("Silent Intro (s)")
  @hint("No orders until this many seconds into the song. The first order is the first bar line after it.")
  @widget(new SliderWidget(0, 30, 0.5))
  hardStartDelay: number = 4

  @input
  @label("Orders To Win")
  @hint("Correct orders in a row that win the run. 0 never ends it: the run goes on until an order is missed.")
  hardOrderCount: number = 0

  @input
  @label("Beat Offset (s)")
  @hint(
    "Nudges every order later (positive) or earlier (negative) against the music, if they sound \
slightly off the beat on device."
  )
  @widget(new SliderWidget(-0.25, 0.25, 0.005))
  hardBeatOffset: number = 0

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
   * Tutorial mode: seconds of quiet left before the current order's instructions play again. Only
   * runs down while nothing is being said, so it is always measured from the end of the last line.
   */
  private repeatTimer = 0

  /** Rhythm game: the beat grid of the mode being played, picked when the run starts. */
  private chart: RhythmChart | null = null

  /**
   * Rhythm game: song times, in seconds since the music started and counting across loops, at
   * which each order is called - the slot after an order being its deadline. Built a loop of the
   * song at a time once the music reports its length, and extended as the run goes on.
   */
  private schedule: number[] = []
  /** How many loops of the song the schedule covers so far, and the time of its last slot. */
  private scheduledLoops = 0
  private lastSlot = Number.NEGATIVE_INFINITY
  private nextSlot = 0
  private ordersDone = 0
  /** The order waiting to be carried out, or null between an order being done and the next beat. */
  private currentOrder: Order | null = null

  private songLength = 0
  private songLoops = 0
  private lastSongPosition = 0

  private music: AudioComponent | null = null
  private voice: AudioComponent | null = null
  /** What the music channel was last told to loop, so the menu song carries on from the leaderboard. */
  private musicTrack: AudioTrackAsset | null = null

  private board: GlobalLeaderboard | null = null
  private calibration: CalibrationMode | null = null

  private split: TwoHandSplit | null = null
  private yoyo: YoyoFlick | null = null
  private crush: FistCrush | null = null
  private squish: PalmSquish | null = null
  private poke: FingerPoke | null = null

  private duplicateObject: SceneObject | null = null

  /** Where the sphere sat when the lens started, the fallback start for every run. */
  private sphereHome: vec3 | null = null

  /**
   * How far in front of the player's eyes, and how far above them, the sphere sat when the lens
   * started - where every run puts it back, relative to wherever the player now is.
   */
  private sphereDistance = 40
  private sphereHeight = 0

  private camera = WorldCameraFinderProvider.getInstance()

  // Previous-frame snapshots, so each order is satisfied by a fresh transition rather than by a
  // state that already happened to be true when the order was given.
  private wasDuplicated = false
  private lastYoyoPhase: number = YoyoPhase.Idle
  private lastCrushPhase: CrushPhase = CrushPhase.Open
  private wasCompressed = false
  private wasPoked = false

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
    this.squish = owner.getComponent(PalmSquish.getTypeName()) as PalmSquish
    this.poke = owner.getComponent(FingerPoke.getTypeName()) as FingerPoke

    // The compress guide marks how flat Compress It needs the sphere, which is set here.
    const cues = owner.getComponent(GestureCues.getTypeName()) as GestureCues
    if (cues !== null) {
      cues.compressTarget = this.compressDepth
    }

    if (this.sphere != null) {
      this.sphereHome = this.sphere.getTransform().getWorldPosition()
      const offset = this.sphereHome.sub(this.camera.getWorldPosition())
      this.sphereDistance = Math.max(10, new vec3(offset.x, 0, offset.z).length)
      this.sphereHeight = offset.y
    }

    this.music = this.getSceneObject().createComponent("Component.AudioComponent") as AudioComponent
    this.music.volume = this.musicVolume

    this.voice = this.getSceneObject().createComponent("Component.AudioComponent") as AudioComponent
    this.voice.volume = this.voiceVolume

    if (this.leaderboardRoot != null) {
      this.board = this.leaderboardRoot.getComponent(GlobalLeaderboard.getTypeName()) as GlobalLeaderboard
    }

    this.bindButton(this.tutorialButton, Mode.Tutorial)
    this.bindButton(this.easyButton, Mode.Easy)
    this.bindButton(this.mediumButton, Mode.Medium)
    this.bindButton(this.hardButton, Mode.Hard)

    if (this.calibrationRoot != null) {
      this.calibration = this.calibrationRoot.getComponent(CalibrationMode.getTypeName()) as CalibrationMode
    }
    this.bindCalibrateButton()

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

  private bindCalibrateButton(): void {
    if (this.calibrateButton == null) {
      return
    }

    const interactable = this.calibrateButton.getComponent(Interactable.getTypeName()) as Interactable
    if (interactable === null) {
      print("GameMenu: " + this.calibrateButton.name + " has no Interactable, it will not be clickable.")
      return
    }

    interactable.onInteractorTriggerStart.add((_event: InteractorEvent) => {
      if (this.stage === Stage.Menu) {
        this.startCalibration()
      }
    })
  }

  /** The sphere comes out for the player to calibrate against, over the calibration's own music. */
  private startCalibration(): void {
    if (this.calibration === null) {
      print("GameMenu: no Calibration assigned, or it has no CalibrationMode.")
      return
    }

    this.resetSphere()
    this.showMenu(false)
    this.playMusic(this.calibrationMusic != null ? this.calibrationMusic : this.tutorialMusic)
    this.stage = Stage.Calibrating
    this.calibration.start(() => this.finishCalibration(), this.sphereStart())
  }

  private finishCalibration(): void {
    if (this.stage !== Stage.Calibrating) {
      return
    }
    this.returnToMenu()
  }

  private startRun(mode: Mode): void {
    this.mode = mode

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
    this.repeatTimer = this.repeatInstructionsAfter

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
          this.tickRepeat()
        }
        break

      case Stage.Praising:
        this.countDown(() => this.giveOrder())
        break

      case Stage.Rhythm:
        this.updateRhythm()
        break

      case Stage.Failed:
        this.countDown(() => this.playEnding())
        break

      case Stage.Completing:
        this.countDown(() => this.playEnding())
        break

      case Stage.Ending:
        this.countDown(() => this.finishRun())
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

  /**
   * Tutorial mode: an order still not done Repeat Instructions After seconds after its
   * instructions finished is explained again, and again after each repeat, until it is done. The
   * wait only counts down in silence, so it never talks over the first explanation or a repeat.
   */
  private tickRepeat(): void {
    if (this.mode !== Mode.Tutorial || this.repeatInstructionsAfter <= 0) {
      return
    }
    if (this.instructionPending || (this.voice !== null && this.voice.isPlaying())) {
      return
    }

    this.repeatTimer -= getDeltaTime()
    if (this.repeatTimer > 0) {
      return
    }

    // An order with no instruction clip repeats the order itself, so the player still hears it.
    const order = ORDER_SEQUENCE[this.orderIndex]
    this.playVoice(this.instructionFor(order) ?? this.orderClipFor(order))
    this.repeatTimer = this.repeatInstructionsAfter
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
    this.chart = this.chartFor(this.mode)

    // The schedule waits for the music to report its length, which is what places the orders
    // after each loop of the song back on that loop's own bar lines.
    this.schedule = []
    this.scheduledLoops = 0
    this.lastSlot = Number.NEGATIVE_INFINITY
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

  /** Each rhythm mode reads its own Inspector section. */
  private chartFor(mode: Mode): RhythmChart {
    if (mode === Mode.Medium) {
      return {
        bpm: this.mediumBpm,
        firstDownbeat: this.mediumFirstDownbeat,
        beatsPerBar: this.mediumBeatsPerBar,
        barsPerOrder: this.mediumBarsPerOrder,
        startDelay: this.mediumStartDelay,
        orderCount: this.mediumOrderCount,
        beatOffset: this.mediumBeatOffset
      }
    }

    if (mode === Mode.Hard) {
      return {
        bpm: this.hardBpm,
        firstDownbeat: this.hardFirstDownbeat,
        beatsPerBar: this.hardBeatsPerBar,
        barsPerOrder: this.hardBarsPerOrder,
        startDelay: this.hardStartDelay,
        orderCount: this.hardOrderCount,
        beatOffset: this.hardBeatOffset
      }
    }

    return {
      bpm: this.bpm,
      firstDownbeat: this.firstDownbeat,
      beatsPerBar: this.beatsPerBar,
      barsPerOrder: this.barsPerOrder,
      startDelay: this.startDelay,
      orderCount: this.orderCount,
      beatOffset: this.beatOffset
    }
  }

  private updateRhythm(): void {
    if (this.music === null || this.chart === null || !this.music.isPlaying()) {
      return
    }

    if (this.songLength <= 0) {
      this.songLength = this.music.duration
      if (this.songLength <= 0) {
        return
      }
    }

    // Kept a slot ahead of the order being called, so it always has a deadline however long the run
    // goes on. A few loops at most per frame, in case a loop's worth of song holds no slot at all.
    for (let i = 0; i < 4 && this.nextSlot >= this.schedule.length; i++) {
      this.scheduleLoop(this.chart)
    }

    const now = this.songTime(this.chart)

    if (this.currentOrder !== null) {
      if (this.orderSatisfied(this.currentOrder)) {
        this.currentOrder = null
        this.ordersDone++

        if (this.chart.orderCount > 0 && this.ordersDone >= this.chart.orderCount) {
          this.complete()
          return
        }

        // No Good Job here: the next order arriving on its beat is the only sign it counted.
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

    // Uniform over ALL_ORDERS, which lists each order once, so all five are equally likely.
    this.currentOrder = ALL_ORDERS[Math.floor(Math.random() * ALL_ORDERS.length)]
    this.nextSlot++
    this.playVoice(this.orderClipFor(this.currentOrder))
  }

  /**
   * Seconds since the music started, counting across loops. The track's own position restarts at
   * zero each time it comes round again, so a jump backwards is counted as one more loop.
   */
  private songTime(chart: RhythmChart): number {
    const position = this.music!.position

    if (position + 1 < this.lastSongPosition) {
      this.songLoops++
    }
    this.lastSongPosition = position

    return this.songLoops * this.songLength + position - chart.beatOffset
  }

  /**
   * Adds the next loop of the song's slots: every Bars Per Order bars from the first downbeat, from
   * the end of the silent intro on. The spacing is rounded to a whole number of beats rather than
   * bars, so a fractional setting still lands exactly on the beat: 1.5 bars in 4/4 is 6 beats,
   * alternating orders between the first and third beat of the bar. The song's length is not a
   * whole number of bars, so each loop restarts the grid at its own first downbeat - and a slot
   * that would come too soon after the last one of the previous loop is skipped, so the seam never
   * leaves less than most of a normal window to do an order in.
   */
  private scheduleLoop(chart: RhythmChart): void {
    const beatsPerBar = Math.max(1, Math.round(chart.beatsPerBar))
    const beatLength = 60 / Math.max(1, chart.bpm)
    const beatsPerOrder = Math.max(1, Math.round(chart.barsPerOrder * beatsPerBar))
    const interval = beatLength * beatsPerOrder
    const loopStart = this.scheduledLoops * this.songLength

    for (let t = chart.firstDownbeat; t < this.songLength; t += interval) {
      const at = loopStart + t
      if (at >= chart.startDelay && at - this.lastSlot >= interval * 0.75) {
        this.schedule.push(at)
        this.lastSlot = at
      }
    }

    this.scheduledLoops++
  }

  private fail(): void {
    this.currentOrder = null
    this.stopMusic()
    this.stopVoice()
    this.postScore()
    this.timer = this.failGap
    this.stage = Stage.Failed
  }

  private complete(): void {
    this.postScore()
    this.playVoice(this.completionFor(this.mode))
    this.timer = this.voiceLength() + this.endingGap
    this.stage = Stage.Completing
  }

  private playEnding(): void {
    this.playVoice(this.endingSequence)
    this.timer = this.voiceLength() + this.finishGap
    this.stage = Stage.Ending
  }

  /** Posted the moment the run ends, so the board has usually arrived by the time it is shown. */
  private postScore(): void {
    const name = this.boardFor(this.mode)
    if (this.board !== null && name !== null) {
      this.board.postScore(name, this.ordersDone)
    }
  }

  /** Rhythm modes show their leaderboard next. The Tutorial goes straight back to the menu. */
  private finishRun(): void {
    if (this.board === null || this.boardFor(this.mode) === null) {
      this.returnToMenu()
      return
    }

    this.showSphere(false)
    this.playMusic(this.menuMusic)
    this.board.show(() => this.closeLeaderboard())
    this.stage = Stage.Leaderboard
  }

  private closeLeaderboard(): void {
    if (this.stage !== Stage.Leaderboard || this.board === null) {
      return
    }

    this.board.hide()
    this.showMenu(true)
    this.stage = Stage.Menu
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
      case Order.Compress:
        return this.compressOrder
      case Order.Poke:
        return this.pokeOrder
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
      case Order.Compress:
        return this.compressInstruction
      case Order.Poke:
        return this.pokeInstruction
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

  /** Each rhythm mode keeps its own board, since a score on one pace says nothing about another. */
  private boardFor(mode: Mode): string | null {
    switch (mode) {
      case Mode.Easy:
        return "EASY"
      case Mode.Medium:
        return "MEDIUM"
      case Mode.Hard:
        return "HARD"
      default:
        return null
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

      case Order.Compress:
        return this.isCompressed() && !this.wasCompressed

      case Order.Poke:
        return this.isPoked() && !this.wasPoked

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
    this.wasCompressed = this.isCompressed()
    this.wasPoked = this.isPoked()
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

  /**
   * Squished at least Compress Depth of the way flat. Measured on depth rather than on the squish
   * starting, so palms merely brushing the sphere do not count as compressing it.
   */
  private isCompressed(): boolean {
    return (
      this.squish !== null &&
      this.squish.squishPhase === SquishPhase.Squishing &&
      this.squish.squishAmount >= this.compressDepth
    )
  }

  /** A straight index finger pushed into the sphere. */
  private isPoked(): boolean {
    return this.poke !== null && this.poke.isPoked
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
    this.showSphere(!visible)

    // Menu music belongs to the menu: on while it is up, off the moment it goes. Stopped here
    // rather than left for the mode's own song to replace, because a mode with no song assigned
    // would otherwise carry the menu track into the run - and the rhythm game would then read its
    // beat clock off the menu song instead of the mode's.
    if (visible) {
      this.playMusic(this.menuMusic)
    } else {
      this.stopMusic()
    }
  }

  private showSphere(visible: boolean): void {
    if (this.sphere != null && this.sphere !== this.getSceneObject()) {
      this.sphere.enabled = visible
    }

    // The copy lives at the scene root, so hiding the sphere does not hide it. A run that fails
    // mid-split would otherwise leave it floating in front of the menu.
    if (!visible && this.duplicateIsLive()) {
      this.duplicateObject!.enabled = false
    }
  }

  /** Puts the sphere where a run starts, so a run never begins with it out of reach. */
  private resetSphere(): void {
    const start = this.sphereStart()
    if (this.sphere != null && start !== null) {
      this.sphere.getTransform().setWorldPosition(start)
    }
  }

  /**
   * Where the sphere sat when the lens started, relative to the player: the same distance in front
   * of their eyes and the same height, towards the menu they have just pressed. The menu follows the
   * player about, so the lens's starting spot in the room could by now be anywhere.
   */
  private sphereStart(): vec3 | null {
    if (this.sphereHome === null) {
      return null
    }
    if (this.menuRoot == null) {
      return this.sphereHome
    }

    const eye = this.camera.getWorldPosition()
    const toMenu = this.menuRoot.getTransform().getWorldPosition().sub(eye)
    const flat = new vec3(toMenu.x, 0, toMenu.z)
    if (flat.length < 1) {
      return this.sphereHome
    }

    return eye.add(flat.normalize().uniformScale(this.sphereDistance)).add(vec3.up().uniformScale(this.sphereHeight))
  }

  private playMusic(track: AudioTrackAsset | null): void {
    if (this.music === null || track == null) {
      return
    }

    // Already looping it, as the menu song is when the leaderboard hands back to the menu.
    if (track === this.musicTrack && this.music.isPlaying()) {
      return
    }

    this.stopMusic()
    this.music.audioTrack = track
    this.music.volume = this.musicVolume
    this.music.play(-1)
    this.musicTrack = track
  }

  private stopMusic(): void {
    this.musicTrack = null
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
