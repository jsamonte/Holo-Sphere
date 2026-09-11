import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {
  Interactor,
  InteractorInputType,
  InteractorTriggerType,
  TargetingMode
} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {InteractorEvent} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import {AllHandTypes, HandType} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"
import TrackedHand from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "../SpectaclesInteractionKit.lspkg/SIK"
import {SphereReach} from "./SphereReach"
import {StrobeGhostTrail} from "./StrobeGhostTrail"
import {YoyoFlick} from "./YoyoFlick"

/**
 * One of the two spheres the object splits into. Half A is always the original SceneObject this
 * component sits on; half B is the copy, which only exists while the sphere is pulled apart.
 */
interface Half {
  sceneObject: SceneObject
  transform: Transform
  visual: RenderMeshVisual | null
  /** The hand currently carrying this half, or null once that hand has let go. */
  interactor: Interactor | null
  /** World offset from the hand's pinch point to the sphere's centre, captured when the split fired. */
  offset: vec3
  /** Extra separation pushing this half away from the other one, eased in across the split. */
  pop: vec3
  /** Where this half sits once it has no hand of its own - also its fallback target. */
  restingPosition: vec3
}

enum SplitState {
  Idle,
  Splitting,
  Split,
  Merging
}

/**
 * Lets a sphere be torn in two with both hands and put back together again.
 *
 * Grab the sphere with both hands and pull them apart. The hands do not have to take hold together:
 * pinching the sphere with one hand and then reaching in and pinching it with the other works just
 * the same. Once the hands have separated past Split Travel the sphere duplicates: each hand carries
 * its own copy, held at the same offset from the pinch it grabbed with, so a copy stays stuck to the
 * hand that pulled it out. Bring the hands back together until the two copies overlap, or simply let
 * go with one or both hands, and the copies converge on the point midway between them and become a
 * single sphere again.
 *
 * While the sphere is whole it is dragged by its InteractableManipulation as usual. Translation on
 * that component is switched off for as long as the sphere is split, since the two halves follow
 * their own hands instead, and switched back on the moment they merge - which also re-caches the
 * grab offset, so a hand still holding on carries the merged sphere away without a jump.
 *
 * Requires an Interactable on the same SceneObject (it is what reports which hands are pinching).
 * If a StrobeGhostTrail is on the same SceneObject, the copy is registered with it so both halves
 * trail afterimages rather than just the original.
 */
@component
export class TwoHandSplit extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Split</span>')

  /**
   * How much further apart the hands have to travel, after they have both taken hold, before the
   * sphere comes apart. Measured against the closest the two hands have been while holding it, so
   * a grab that starts wide still needs a deliberate pull.
   */
  @input
  @label("Split Travel")
  @hint(
    "How much further the hands must pull apart before the sphere splits, as a fraction of the \
sphere's world scale. Higher values need a longer pull."
  )
  @widget(new SliderWidget(0.1, 3, 0.05))
  splitTravel: number = 0.8

  /**
   * How close a second hand's pinch has to start to the sphere for it to take hold while the first
   * hand is already holding on. See {@link watchSecondHand} for why this is needed at all.
   */
  @input
  @label("Second Hand Reach")
  @hint(
    "While one hand holds the sphere, how close the other hand's pinch must start to the sphere to \
grab it too, as a multiple of the sphere's radius. 1 means at the surface; the default roughly matches \
the sphere's grab collider."
  )
  @widget(new SliderWidget(0.5, 4, 0.1))
  secondHandReach: number = 2.2

  /**
   * Extra separation added between the halves at the moment of the split, on top of whatever the
   * hands are doing. Without it the two copies would come apart exactly as slowly as the hands
   * move, and the instant of duplication would be invisible.
   */
  @input
  @label("Split Pop")
  @hint(
    "Extra push apart applied when the sphere duplicates, as a fraction of the sphere's world \
scale. Set to 0 for the halves to separate only as fast as the hands do."
  )
  @widget(new SliderWidget(0, 2, 0.05))
  splitPop: number = 0.5

  /**
   * Seconds the pop takes to ease in.
   */
  @input
  @label("Split Time (s)")
  @hint("How long the halves take to push apart once the split fires.")
  @widget(new SliderWidget(0.05, 1, 0.01))
  splitDuration: number = 0.18

  /**
   * Size of each half relative to the whole sphere. 1 keeps both copies full size.
   */
  @input
  @label("Split Scale")
  @hint("Size of each half while the sphere is apart, relative to the whole sphere. 1 keeps both copies full size.")
  @widget(new SliderWidget(0.25, 1, 0.05))
  splitScale: number = 1

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Merge</span>')

  /**
   * How close the halves have to come back before they snap together. Kept well below Split Pop so
   * the sphere cannot split and merge on alternating frames.
   */
  @input
  @label("Merge Distance")
  @hint(
    "How close the two halves must come before they merge again, as a fraction of the sphere's \
world scale. Keep it below Split Pop so the sphere does not split and merge on alternating frames."
  )
  @widget(new SliderWidget(0.05, 1, 0.05))
  mergeDistance: number = 0.25

  /**
   * Seconds the halves take to converge on the midpoint.
   */
  @input
  @label("Merge Time (s)")
  @hint("How long the halves take to come back together once they merge.")
  @widget(new SliderWidget(0.05, 1, 0.01))
  mergeDuration: number = 0.22

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Advanced</span>')

  /**
   * The SceneObject used as the second sphere. Left empty, a copy of this sphere's mesh and
   * material is built at runtime, which is enough for the halves to be indistinguishable.
   */
  @input
  @label("Second Sphere")
  @hint("SceneObject to use as the second sphere. Leave empty to build one from this sphere's own mesh and material.")
  @allowUndefined
  secondSphere: SceneObject | null = null

  /**
   * Copies the main sphere's material colour onto the copy every frame, so anything animating the
   * original - the strobe, most obviously - shows on both halves.
   */
  @input
  @label("Mirror Appearance")
  @hint("Copy the main sphere's colour onto the second sphere each frame, so both halves strobe together.")
  mirrorAppearance: boolean = true

  /**
   * Registers the copy with the StrobeGhostTrail on this SceneObject, so it leaves afterimages too.
   */
  @input
  @label("Mirror Trail")
  @hint("Also give the second sphere the StrobeGhostTrail's afterimages, if that component is present.")
  mirrorTrail: boolean = true

  /**
   * Shader graph port carrying emissive colour, mirrored onto the copy. Matches StrobeGhostTrail.
   */
  @input
  @label("Emissive Port")
  @hint("Name of the emissive (vec3) port to mirror onto the second sphere. Leave empty to skip emissive.")
  emissivePort: string = "Port_Emissive_N006"

  /**
   * Shader graph port carrying opacity, mirrored onto the copy. Matches StrobeGhostTrail.
   */
  @input
  @label("Opacity Port")
  @hint("Name of the opacity (float) port to mirror onto the second sphere. Leave empty to skip opacity.")
  opacityPort: string = "Port_Opacity_N006"

  private interactable: Interactable | null = null
  private manipulation: InteractableManipulation | null = null
  private trail: StrobeGhostTrail | null = null
  private yoyo: YoyoFlick | null = null
  private sphereReach: SphereReach | null = null
  private mainVisual: RenderMeshVisual | null = null

  private halfA: Half | null = null
  private halfB: Half | null = null
  private ownsSecondSphere = false

  private state = SplitState.Idle
  private progress = 0

  /** Hands currently pinching the sphere, in the order they took hold. */
  private held: Interactor[] = []

  /** Closest the two hands have been since they both took hold. Negative until both are on. */
  private grabSeparation = -1

  /** World scale of the whole sphere, which the halves scale out of and back into. */
  private homeScale = vec3.one()

  /** Translation setting to hand back to InteractableManipulation once the halves merge. */
  private manipulationCouldTranslate = true

  /** Whether each hand was pinching last frame, so a second hand's pinch is caught as it starts. */
  private wasPinching = new Map<string, boolean>()

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
    this.createEvent("OnDestroyEvent").bind(() => this.destroySecondSphere())
  }

  private init(): void {
    this.mainVisual = this.getSceneObject().getComponent("Component.RenderMeshVisual")
    if (this.mainVisual === null) {
      print("TwoHandSplit: no RenderMeshVisual on " + this.getSceneObject().name + ", disabling.")
      this.enabled = false
      return
    }

    this.interactable = this.getSceneObject().getComponent(Interactable.getTypeName())
    if (this.interactable === null) {
      print("TwoHandSplit: no Interactable on " + this.getSceneObject().name + ", the sphere will never split.")
      this.enabled = false
      return
    }

    this.manipulation = this.getSceneObject().getComponent(InteractableManipulation.getTypeName())
    this.trail = this.getSceneObject().getComponent(StrobeGhostTrail.getTypeName())
    this.yoyo = this.getSceneObject().getComponent(YoyoFlick.getTypeName())
    this.sphereReach = this.getSceneObject().getComponent(SphereReach.getTypeName()) as SphereReach

    this.homeScale = this.getTransform().getWorldScale()
    this.halfA = this.buildHalf(this.getSceneObject(), this.mainVisual)
    this.halfB = this.buildSecondHalf()

    this.bindPinchEvents(this.interactable)

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private buildHalf(sceneObject: SceneObject, visual: RenderMeshVisual | null): Half {
    const transform = sceneObject.getTransform()
    return {
      sceneObject: sceneObject,
      transform: transform,
      visual: visual,
      interactor: null,
      offset: vec3.zero(),
      pop: vec3.zero(),
      restingPosition: transform.getWorldPosition()
    }
  }

  /**
   * The copy lives at the scene root rather than under the sphere, so the two halves can be moved
   * independently once they come apart.
   */
  private buildSecondHalf(): Half {
    let sceneObject = this.secondSphere

    // Loose == so this catches undefined too: an object input left empty in the Inspector comes
    // through as undefined rather than null, and a strict === null check would fall past this
    // and try to configure a sphere that was never built.
    if (sceneObject == null) {
      sceneObject = global.scene.createSceneObject(this.getSceneObject().name + " Copy")
      sceneObject.layer = this.getSceneObject().layer

      const created = sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      created.mesh = this.mainVisual!.mesh
      created.mainMaterial = this.mainVisual!.mainMaterial
      this.ownsSecondSphere = true
    }

    sceneObject.enabled = false

    const visual = sceneObject.getComponent("Component.RenderMeshVisual")
    if (visual !== null) {
      // Cloned so mirroring the strobe onto the copy never writes back into the material the
      // original sphere is drawn with.
      visual.mainMaterial = visual.mainMaterial.clone()
    }

    return this.buildHalf(sceneObject, visual)
  }

  private bindPinchEvents(interactable: Interactable): void {
    interactable.onInteractorTriggerStart.add((event: InteractorEvent) => this.grab(event.interactor))
    interactable.onInteractorTriggerEnd.add((event: InteractorEvent) => this.release(event.interactor))
    interactable.onInteractorTriggerEndOutside.add((event: InteractorEvent) => this.release(event.interactor))
    interactable.onTriggerCanceled.add((event: InteractorEvent) => this.release(event.interactor))
  }

  private grab(interactor: Interactor): void {
    if (this.held.indexOf(interactor) < 0) {
      this.held.push(interactor)
    }
  }

  private release(interactor: Interactor): void {
    const index = this.held.indexOf(interactor)
    if (index >= 0) {
      this.held.splice(index, 1)
    }

    this.dropHalf(this.halfA, interactor)
    this.dropHalf(this.halfB, interactor)
  }

  /**
   * A half whose hand has let go stops following anything and waits where it is for the merge.
   */
  private dropHalf(half: Half | null, interactor: Interactor): void {
    if (half === null || half.interactor !== interactor) {
      return
    }
    half.restingPosition = half.transform.getWorldPosition()
    half.interactor = null
  }

  /**
   * Trigger events are the primary signal, but an interactor can also go away without one - a hand
   * leaving tracking, for instance - so the held list is re-checked every frame.
   */
  private pruneHeld(): void {
    for (let i = this.held.length - 1; i >= 0; i--) {
      const interactor = this.held[i]
      if (!this.stillHolding(interactor)) {
        this.release(interactor)
      }
    }
  }

  /**
   * A hand that took hold through {@link watchSecondHand} never started a trigger on the sphere, so
   * SIK reports no trigger for it and will never send it a trigger end either - its own pinch is what
   * says it is still holding. Either signal is enough, so a hand SIK did see keeps its old behaviour.
   */
  private stillHolding(interactor: Interactor): boolean {
    if (!interactor.isActive()) {
      return false
    }

    const hand = this.handOf(interactor)
    if (hand !== null && hand.isPinching()) {
      return true
    }

    return interactor.currentTrigger !== InteractorTriggerType.None
  }

  /**
   * SIK only starts a trigger on the sphere if the pinching hand was already targeting it on the
   * frame the pinch began, and it then keeps that hand's targeting locked for the rest of the pinch.
   * The sphere only accepts direct targeting, so a hand reaching in beside the one already holding
   * on - usually still in its pointing pose, on its ray - pinches on nothing and is never reported
   * here. Grabbing with both hands at once works because both are already resting on the sphere.
   *
   * So while exactly one hand holds the sphere, the other is watched directly: a pinch that starts
   * within Second Hand Reach of the sphere counts as that hand taking hold.
   */
  private watchSecondHand(): void {
    for (let i = 0; i < AllHandTypes.length; i++) {
      const handType = AllHandTypes[i]
      const hand = SIK.HandInputData.getHand(handType)
      const pinching = hand !== null && hand.isTracked() && hand.isPinching()
      const started = pinching && !(this.wasPinching.get(handType) ?? false)
      this.wasPinching.set(handType, pinching)

      if (!started || this.held.length !== 1 || this.state !== SplitState.Idle) {
        continue
      }

      const interactor = this.handInteractor(handType)
      if (interactor === null || this.held.indexOf(interactor) >= 0) {
        continue
      }

      const point = this.handPinchPoint(hand)
      if (point === null) {
        continue
      }

      // Measured to the sphere's reach - its centre stretched out towards the player by SphereReach -
      // so a pinch landing a little short in front of the sphere still takes hold.
      const reach = this.sphereSize() * 0.5 * this.secondHandReach
      const distance =
        this.sphereReach !== null
          ? this.sphereReach.distanceTo(point)
          : point.distance(this.halfA!.transform.getWorldPosition())
      if (distance > reach) {
        continue
      }

      this.grab(interactor)
    }
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()
    this.pruneHeld()
    this.watchSecondHand()

    // A two handed grab is a split, never a flick, and the yoyo drives the same transform - so it
    // is stood down for as long as both hands are on the sphere or the halves are apart.
    this.setYoyoSuspended(this.state !== SplitState.Idle || this.held.length >= 2)

    switch (this.state) {
      case SplitState.Idle:
        this.updateIdle()
        break
      case SplitState.Splitting:
      case SplitState.Split:
        this.updateSplit(deltaTime)
        break
      case SplitState.Merging:
        this.updateMerging(deltaTime)
        break
    }
  }

  /**
   * Whole sphere: InteractableManipulation is doing the dragging, and all this watches for is two
   * hands pulling away from each other.
   */
  private updateIdle(): void {
    this.homeScale = this.halfA!.transform.getWorldScale()

    if (this.held.length < 2) {
      this.grabSeparation = -1
      return
    }

    const interactorA = this.held[0]
    const interactorB = this.held[1]
    const pointA = this.interactorPoint(interactorA)
    const pointB = this.interactorPoint(interactorB)
    if (pointA === null || pointB === null) {
      return
    }

    const separation = pointA.distance(pointB)
    if (this.grabSeparation < 0) {
      this.grabSeparation = separation
      return
    }

    // Measured from the tightest grip so far, so bringing the hands together and pulling apart
    // again splits the sphere however wide apart the hands first landed on it.
    this.grabSeparation = Math.min(this.grabSeparation, separation)

    if (separation - this.grabSeparation > this.splitTravel * this.sphereSize()) {
      this.beginSplit(interactorA, interactorB, pointA, pointB)
    }
  }

  private beginSplit(interactorA: Interactor, interactorB: Interactor, pointA: vec3, pointB: vec3): void {
    const halfA = this.halfA!
    const halfB = this.halfB!
    const position = halfA.transform.getWorldPosition()

    // Each half keeps the offset its hand had from the sphere's centre, so the copies start out
    // exactly on top of each other and come apart only as far as the hands do.
    halfA.interactor = interactorA
    halfA.offset = position.sub(pointA)
    halfB.interactor = interactorB
    halfB.offset = position.sub(pointB)

    const separation = pointA.distance(pointB)
    const direction = separation > 0.0001 ? pointB.sub(pointA).uniformScale(1 / separation) : vec3.right()
    const pop = direction.uniformScale(this.splitPop * this.sphereSize() * 0.5)
    halfA.pop = pop.uniformScale(-1)
    halfB.pop = pop

    halfA.restingPosition = position
    halfB.restingPosition = position
    halfB.transform.setWorldPosition(position)
    halfB.transform.setWorldRotation(halfA.transform.getWorldRotation())
    halfB.transform.setWorldScale(this.homeScale)
    halfB.sceneObject.enabled = true

    this.suppressManipulation()

    if (this.mirrorTrail && this.trail !== null) {
      this.trail.addTrailMirror(halfB.transform)
    }

    this.progress = 0
    this.state = SplitState.Splitting
  }

  /**
   * Split sphere: each half is placed on its own hand every frame, and the pair is watched for the
   * two conditions that put them back together - hands closing up, or a hand letting go.
   */
  private updateSplit(deltaTime: number): void {
    if (this.state === SplitState.Splitting) {
      this.progress = Math.min(1, this.progress + deltaTime / Math.max(0.01, this.splitDuration))
      if (this.progress >= 1) {
        this.state = SplitState.Split
      }
    }

    const eased = this.smoothstep(this.progress)
    const targetA = this.halfTarget(this.halfA!, eased)
    const targetB = this.halfTarget(this.halfB!, eased)
    const scale = vec3.lerp(this.homeScale, this.homeScale.uniformScale(this.splitScale), eased)

    this.placeHalf(this.halfA!, targetA, scale)
    this.placeHalf(this.halfB!, targetB, scale)
    this.mirrorAppearanceOntoCopy()

    if (this.halfA!.interactor === null || this.halfB!.interactor === null) {
      this.beginMerge()
      return
    }

    // Only once the halves have fully come apart, so the merge cannot fire on the split's own
    // first frames while the two copies are still sitting on top of each other.
    if (this.state === SplitState.Split && targetA.distance(targetB) < this.mergeDistance * this.sphereSize()) {
      this.beginMerge()
    }
  }

  private beginMerge(): void {
    this.progress = 0
    this.state = SplitState.Merging
  }

  /**
   * Merging: both halves keep following whatever they were following, and are drawn towards the
   * point midway between them until they arrive together.
   */
  private updateMerging(deltaTime: number): void {
    this.progress = Math.min(1, this.progress + deltaTime / Math.max(0.01, this.mergeDuration))

    const targetA = this.halfTarget(this.halfA!, 1)
    const targetB = this.halfTarget(this.halfB!, 1)
    const middle = vec3.lerp(targetA, targetB, 0.5)

    const eased = this.smoothstep(this.progress)
    const scale = vec3.lerp(this.homeScale.uniformScale(this.splitScale), this.homeScale, eased)

    this.placeHalf(this.halfA!, vec3.lerp(targetA, middle, eased), scale)
    this.placeHalf(this.halfB!, vec3.lerp(targetB, middle, eased), scale)
    this.mirrorAppearanceOntoCopy()

    if (this.progress >= 1) {
      this.finishMerge(middle)
    }
  }

  private finishMerge(position: vec3): void {
    const halfA = this.halfA!
    const halfB = this.halfB!

    halfA.transform.setWorldPosition(position)
    halfA.transform.setWorldScale(this.homeScale)
    halfA.interactor = null
    halfA.restingPosition = position

    if (this.mirrorTrail && this.trail !== null) {
      this.trail.removeTrailMirror(halfB.transform)
    }
    halfB.sceneObject.enabled = false
    halfB.interactor = null

    this.restoreManipulation()

    // Re-baselined rather than kept, so hands that are still holding on can pull the sphere apart
    // again straight away from wherever they now are.
    this.grabSeparation = -1
    this.state = SplitState.Idle
  }

  /**
   * Where a half wants to be: on its own hand, at the offset it was grabbed with, pushed out by
   * the eased-in pop. A half with no hand left simply stays where it was.
   */
  private halfTarget(half: Half, popAmount: number): vec3 {
    if (half.interactor === null) {
      return half.restingPosition
    }

    const point = this.interactorPoint(half.interactor)
    if (point === null) {
      return half.restingPosition
    }

    return point.add(half.offset).add(half.pop.uniformScale(popAmount))
  }

  private placeHalf(half: Half, position: vec3, scale: vec3): void {
    half.transform.setWorldPosition(position)
    half.transform.setWorldScale(scale)
    half.restingPosition = position
  }

  /**
   * Where a hand is holding the sphere. A tracked hand's own pinch - between the index and thumb
   * tips - is used whenever there is one: a hand that took hold through {@link watchSecondHand} may
   * still be on its ray, whose points lie out along the ray rather than at the fingers.
   *
   * Anything that is not a hand, such as the mouse in the editor, falls back to the interactor: a
   * direct pinch is held at the fingertips, an indirect one from the ray's origin.
   */
  private interactorPoint(interactor: Interactor): vec3 | null {
    const hand = this.handOf(interactor)
    if (hand !== null) {
      const pinch = this.handPinchPoint(hand)
      if (pinch !== null) {
        return pinch
      }
    }

    if (interactor.activeTargetingMode === TargetingMode.Direct) {
      return interactor.endPoint ?? interactor.startPoint
    }
    return interactor.startPoint ?? interactor.endPoint
  }

  /** The tracked hand behind a hand interactor, or null for anything else. */
  private handOf(interactor: Interactor): TrackedHand | null {
    if (interactor.inputType === InteractorInputType.LeftHand) {
      return SIK.HandInputData.getHand("left")
    }
    if (interactor.inputType === InteractorInputType.RightHand) {
      return SIK.HandInputData.getHand("right")
    }
    return null
  }

  /** SIK's own interactor for a hand, so a hand that took hold is tracked like any other. */
  private handInteractor(handType: HandType): Interactor | null {
    const inputType = handType === "left" ? InteractorInputType.LeftHand : InteractorInputType.RightHand
    const found = SIK.InteractionManager.getInteractorsByType(inputType)

    for (let i = 0; i < found.length; i++) {
      if (found[i].inputType === inputType) {
        return found[i]
      }
    }
    return found.length > 0 ? found[0] : null
  }

  /** Midway between the index and thumb tips, the same point SIK's own direct pinch uses. */
  private handPinchPoint(hand: TrackedHand): vec3 | null {
    if (!hand.isTracked() || hand.indexTip == null || hand.thumbTip == null) {
      return null
    }
    return hand.indexTip.position.add(hand.thumbTip.position).uniformScale(0.5)
  }

  /**
   * Largest world scale axis, standing in for the sphere's size the same way StrobeGhostTrail does
   * it, so the split and merge distances track the sphere if it is ever resized.
   */
  private sphereSize(): number {
    return Math.max(this.homeScale.x, Math.max(this.homeScale.y, this.homeScale.z))
  }

  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t)
  }

  /**
   * Translation is turned off through the component's own setter rather than by disabling it, so
   * it ends its manipulation cleanly - and re-caches the grab offset when it is turned back on,
   * letting a hand that never let go carry the merged sphere off without a jump.
   */
  private suppressManipulation(): void {
    if (this.manipulation === null) {
      return
    }
    this.manipulationCouldTranslate = this.manipulation.canTranslate()
    this.manipulation.setCanTranslate(false)
  }

  private restoreManipulation(): void {
    if (this.manipulation === null) {
      return
    }
    this.manipulation.setCanTranslate(this.manipulationCouldTranslate)

    // The manipulation has to re-read the sphere, or a hand that never let go would carry the
    // merged sphere off from wherever its drag left off instead of from the merge.
    if (this.manipulationCouldTranslate && this.manipulation.isManipulating()) {
      this.manipulation.updateStartTransform()
    }
  }

  private setYoyoSuspended(suspended: boolean): void {
    if (this.yoyo === null) {
      return
    }
    this.yoyo.setSuspended(suspended)
  }

  private mirrorAppearanceOntoCopy(): void {
    if (!this.mirrorAppearance || this.mainVisual === null || this.halfB === null || this.halfB.visual === null) {
      return
    }

    // Read fresh every frame: StrobeGhostTrail swaps the sphere's material for a clone of its own
    // at startup, so a pass cached at init would be the wrong one.
    const source = this.mainVisual.mainMaterial.mainPass
    const destination = this.halfB.visual.mainMaterial.mainPass

    this.copyPassProperty(source, destination, "baseColor")
    if (this.emissivePort !== "") {
      this.copyPassProperty(source, destination, this.emissivePort)
    }
    if (this.opacityPort !== "") {
      this.copyPassProperty(source, destination, this.opacityPort)
    }
  }

  private copyPassProperty(source: any, destination: any, port: string): void {
    const value = source[port]
    if (value === undefined || value === null) {
      return
    }
    destination[port] = value
  }

  private destroySecondSphere(): void {
    if (this.halfB === null) {
      return
    }
    if (this.ownsSecondSphere) {
      this.halfB.sceneObject.destroy()
    }
    this.halfB = null
  }
}
