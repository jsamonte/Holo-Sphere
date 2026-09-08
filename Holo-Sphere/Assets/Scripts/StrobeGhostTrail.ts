import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"

/**
 * One pooled "afterimage" sphere: a copy of the main sphere's mesh that is parked in world
 * space at the position the main sphere occupied when a given strobe flash fired.
 */
interface Ghost {
  sceneObject: SceneObject
  transform: Transform
  pass: any
  color: vec4
  age: number
  active: boolean
}

const SEQUENCE_LENGTH = 3

/**
 * Drives a strobe-light effect on the SceneObject this component sits on.
 *
 * The whole effect is gated on the pinch. While the sphere is pinched it cycles
 * red -> green -> blue on a fixed clock, and every flash of that clock also parks a coloured
 * afterimage at the sphere's current world position, which fades out over a fraction of a
 * second. Whenever it is not held it sits at its silver white rest colour.

 *
 * Because flashes fire on a fixed *time* interval, the *distance* between afterimages is
 * simply speed x strobeInterval - so dragging the sphere faster spreads the colours further
 * apart, exactly the way a moving strobe light smears into discrete coloured copies.
 *
 * Requires an Interactable on the same SceneObject (used to detect the pinch).
 */

@component
export class StrobeGhostTrail extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Strobe</span>')

  /**
   * Seconds each colour stays on screen. Smaller = faster strobe and a tighter trail.
   */
  @input
  @label("Strobe Interval (s)")
  @hint("Seconds each colour is held before advancing to the next one. Smaller = faster strobe.")
  @widget(new SliderWidget(0.01, 0.5, 0.01))
  strobeInterval: number = 0.06

  /**
   * First colour of the sequence.
   */
  @input("vec4", "{1, 0, 0, 1}")
  @label("Color 1")
  @widget(new ColorWidget())
  colorA: vec4 = new vec4(1, 0, 0, 1)

  /**
   * Second colour of the sequence.
   */
  @input("vec4", "{0, 1, 0, 1}")
  @label("Color 2")
  @widget(new ColorWidget())
  colorB: vec4 = new vec4(0, 1, 0, 1)

  /**
   * Third colour of the sequence.
   */
  @input("vec4", "{0, 0, 1, 1}")
  @label("Color 3")
  @widget(new ColorWidget())
  colorC: vec4 = new vec4(0, 0, 1, 1)

  /**
   * The colour the sphere sits at whenever it is not being grabbed - a silver white that lets
   * the metallic shader read as bare metal. Also the base the strobe colours blend out of.
   */
  @input("vec4", "{0.88, 0.89, 0.91, 1}")
  @label("Rest Color")
  @hint("Colour of the sphere while it is not being grabbed. Silver white by default.")
  @widget(new ColorWidget())
  restColor: vec4 = new vec4(0.88, 0.89, 0.91, 1)

  /**
   * How much of the strobe colour replaces the rest colour while the sphere is held. 0 keeps
   * the silver metallic tint, 1 fully replaces it.
   */
  @input
  @label("Main Color Mix")
  @hint("0 keeps the silver rest colour while pinched, 1 fully replaces it with the strobe colour.")
  @widget(new SliderWidget(0, 1, 0.05))
  mainColorMix: number = 1


  /**
   * Emissive brightness added to the main sphere so the strobe reads as a light source.
   */
  @input
  @label("Main Emissive")
  @hint("Emissive brightness added to the main sphere so the strobe reads as a light source rather than a tint.")
  @widget(new SliderWidget(0, 4, 0.05))
  mainEmissive: number = 0.6

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Trail</span>')

  /**
   * Number of pooled afterimages. Needs to be at least ghostLifetime / strobeInterval to
   * avoid recycling a ghost that is still visible.
   */
  @input
  @label("Ghost Count")
  @hint("Size of the afterimage pool. Should be at least Ghost Lifetime / Strobe Interval.")
  @widget(new SliderWidget(3, 40, 1))
  ghostCount: number = 16

  /**
   * How long each afterimage lingers. This is the "split second" of the trail.
   */
  @input
  @label("Ghost Lifetime (s)")
  @hint("How long each afterimage lingers before it has fully faded out.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  ghostLifetime: number = 0.35

  /**
   * Opacity of a freshly spawned afterimage. The sphere's own material is authored quite
   * glassy, so the trail is given its own absolute opacity rather than inheriting it.
   */
  @input
  @label("Ghost Opacity")
  @hint("Opacity of a freshly spawned afterimage, before it starts fading out.")
  @widget(new SliderWidget(0, 1, 0.05))
  ghostOpacity: number = 0.35

  /**
   * Emissive brightness of a freshly spawned afterimage.
   */
  @input
  @label("Ghost Emissive")
  @hint("Emissive brightness of a freshly spawned afterimage.")
  @widget(new SliderWidget(0, 4, 0.05))
  ghostEmissive: number = 0.8

  /**
   * Shapes the fade curve. 1 is linear, higher values make afterimages hold their brightness
   * longer and then drop off sharply, which reads more like a strobe than a smear.
   */
  @input
  @label("Fade Sharpness")
  @hint("1 is a linear fade. Higher values hold brightness longer then drop off sharply, more strobe than smear.")
  @widget(new SliderWidget(0.25, 4, 0.25))
  fadeSharpness: number = 1.5

  /**
   * Scale of an afterimage relative to the main sphere.
   */
  @input
  @label("Ghost Scale")
  @hint("Size of an afterimage relative to the main sphere.")
  @widget(new SliderWidget(0.1, 1.5, 0.05))
  ghostScale: number = 0.95

  /**
   * Minimum travel between afterimages, as a fraction of the sphere's world scale. A flash
   * that has not moved at least this far since the last one is skipped, so holding the sphere
   * still while pinched does not stack a pile of overlapping ghosts on top of it.
   */
  @input
  @label("Min Spacing")
  @hint(
    "Minimum travel between afterimages, as a fraction of the sphere's world scale. Stops ghosts \
piling up when the sphere is pinched but held still. Set to 0 to emit on every flash."

  )
  @widget(new SliderWidget(0, 2, 0.05))
  minSpacing: number = 0.2

  /**
   * Hide every afterimage the instant the pinch is released, rather than letting the trail
   * finish its fade.
   */
  @input
  @label("Clear On Release")
  @hint("Hide all afterimages the instant the pinch is released, instead of letting the trail finish fading.")
  clearOnRelease: boolean = true

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Advanced</span>')

  /**
   * Mesh used for the afterimages. Leave empty to reuse the main sphere's mesh.
   */
  @input
  @label("Ghost Mesh")
  @hint("Mesh used for the afterimages. Leave empty to reuse the main sphere's own mesh.")
  @allowUndefined
  ghostMesh: RenderMesh | null = null

  /**
   * Material used for the afterimages. Leave empty to clone the main sphere's material.
   */
  @input
  @label("Ghost Material")
  @hint("Material used for the afterimages. Leave empty to clone the main sphere's own material.")
  @allowUndefined
  ghostMaterial: Material | null = null

  /**
   * Shader graph port carrying emissive colour on the sphere material.
   */
  @input
  @label("Emissive Port")
  @hint("Name of the emissive (vec3) port on the sphere's material. Leave empty to skip emissive.")
  emissivePort: string = "Port_Emissive_N006"

  /**
   * Shader graph port carrying opacity on the sphere material.
   */
  @input
  @label("Opacity Port")
  @hint("Name of the opacity (float) port on the sphere's material. Leave empty to skip fading by opacity.")
  opacityPort: string = "Port_Opacity_N006"

  private interactable: Interactable | null = null
  private mainVisual: RenderMeshVisual | null = null
  private mainPass: any = null
  private mainEmissiveRest: vec3 = new vec3(0, 0, 0)


  private ghosts: Ghost[] = []
  private nextGhost = 0

  private colors: vec4[] = []
  private colorIndex = 0
  private strobeTimer = 0

  private isPinched = false
  private lastEmitPosition: vec3 | null = null

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
    this.createEvent("OnDestroyEvent").bind(() => this.destroyGhosts())
  }

  private init(): void {
    this.colors = [this.colorA, this.colorB, this.colorC]

    this.mainVisual = this.getSceneObject().getComponent("Component.RenderMeshVisual")
    if (this.mainVisual === null) {
      print("StrobeGhostTrail: no RenderMeshVisual on " + this.getSceneObject().name + ", disabling.")
      this.enabled = false
      return
    }

    // Clone so the strobe never writes back into the shared material asset.
    const sourceMaterial = this.mainVisual.mainMaterial
    this.mainVisual.mainMaterial = sourceMaterial.clone()
    this.mainPass = this.mainVisual.mainMaterial.mainPass

    // Emissive is the one part of the rest look taken from the material rather than an input,
    // since it is the shader's own "not glowing" value.
    if (this.emissivePort !== "") {
      this.mainEmissiveRest = this.mainPass[this.emissivePort] ?? new vec3(0, 0, 0)
    }

    this.buildGhostPool(sourceMaterial)

    this.interactable = this.getSceneObject().getComponent(Interactable.getTypeName())
    if (this.interactable === null) {
      print("StrobeGhostTrail: no Interactable on " + this.getSceneObject().name + ", strobe will never run.")
    } else {
      this.bindPinchEvents(this.interactable)
    }

    // Start at rest, so the sphere is silver white until it is first grabbed.
    this.restoreMainColor()
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }



  private buildGhostPool(sourceMaterial: Material): void {
    const mesh = this.ghostMesh ?? this.mainVisual!.mesh
    const material = this.ghostMaterial ?? sourceMaterial
    const layer = this.getSceneObject().layer

    const count = Math.max(1, Math.floor(this.ghostCount))
    for (let i = 0; i < count; i++) {
      // Created at the scene root on purpose: ghosts must stay where they were dropped
      // rather than following the sphere that spawned them.
      const sceneObject = global.scene.createSceneObject("StrobeGhost_" + i)
      sceneObject.layer = layer

      const visual = sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      visual.mesh = mesh
      visual.mainMaterial = material.clone()

      sceneObject.enabled = false

      this.ghosts.push({
        sceneObject: sceneObject,
        transform: sceneObject.getTransform(),
        pass: visual.mainMaterial.mainPass,
        color: this.colors[0],
        age: 0,
        active: false
      })
    }
  }

  private bindPinchEvents(interactable: Interactable): void {
    interactable.onTriggerStart.add(() => this.setPinched(true))
    interactable.onTriggerEnd.add(() => this.setPinched(false))
    interactable.onTriggerEndOutside.add(() => this.setPinched(false))
    interactable.onTriggerCanceled.add(() => this.setPinched(false))
  }

  private setPinched(pinched: boolean): void {
    if (this.isPinched === pinched) {
      return
    }
    this.isPinched = pinched

    if (pinched) {
      // Prime the clock so the first flash fires on the next frame and lands on colour 1,
      // and make sure that first flash emits rather than being held back by minSpacing.
      this.strobeTimer = Math.max(0.01, this.strobeInterval)
      this.colorIndex = SEQUENCE_LENGTH - 1
      this.lastEmitPosition = null
      return
    }


    this.restoreMainColor()
    if (this.clearOnRelease) {
      this.hideAllGhosts()
    }
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()

    // The strobe clock only runs while the sphere is held.
    if (this.isPinched) {
      const interval = Math.max(0.01, this.strobeInterval)
      this.strobeTimer += deltaTime
      while (this.strobeTimer >= interval) {
        this.strobeTimer -= interval
        this.flash()
      }
    }

    // Keeps running when released so a trail left behind by clearOnRelease=false still fades.
    this.ageGhosts(deltaTime)
  }

  /**
   * One tick of the strobe: advance the colour, repaint the sphere, and leave an afterimage of
   * that flash behind at the position the sphere currently occupies.
   */
  private flash(): void {
    this.colorIndex = (this.colorIndex + 1) % SEQUENCE_LENGTH
    const color = this.colors[this.colorIndex]
    this.applyMainColor(color)


    const transform = this.getTransform()
    const position = transform.getWorldPosition()
    const scale = transform.getWorldScale()

    if (this.lastEmitPosition !== null && this.minSpacing > 0) {
      // Largest world scale axis stands in for the sphere's size, so the threshold tracks the
      // sphere if it is ever resized.
      const size = Math.max(scale.x, Math.max(scale.y, scale.z))
      if (position.distance(this.lastEmitPosition) < this.minSpacing * size) {
        return

      }
    }

    this.emitGhost(position, transform.getWorldRotation(), scale, color)
    this.lastEmitPosition = position
  }

  private emitGhost(position: vec3, rotation: quat, scale: vec3, color: vec4): void {
    const ghost = this.ghosts[this.nextGhost]
    this.nextGhost = (this.nextGhost + 1) % this.ghosts.length

    ghost.transform.setWorldPosition(position)
    ghost.transform.setWorldRotation(rotation)
    ghost.transform.setWorldScale(scale.uniformScale(this.ghostScale))
    ghost.color = color
    ghost.age = 0
    ghost.active = true
    ghost.sceneObject.enabled = true

    this.paintGhost(ghost, 1)
  }

  private ageGhosts(deltaTime: number): void {
    const lifetime = Math.max(0.01, this.ghostLifetime)

    for (let i = 0; i < this.ghosts.length; i++) {
      const ghost = this.ghosts[i]
      if (!ghost.active) {
        continue
      }

      ghost.age += deltaTime
      if (ghost.age >= lifetime) {
        ghost.active = false
        ghost.sceneObject.enabled = false
        continue
      }

      this.paintGhost(ghost, Math.pow(1 - ghost.age / lifetime, this.fadeSharpness))
    }
  }

  private paintGhost(ghost: Ghost, fade: number): void {
    ghost.pass.baseColor = ghost.color
    this.writeEmissive(ghost.pass, ghost.color, this.ghostEmissive * fade)
    this.writeOpacity(ghost.pass, this.ghostOpacity * fade)
  }

  private applyMainColor(color: vec4): void {
    const mix = this.mainColorMix
    const rest = this.restColor
    this.mainPass.baseColor = new vec4(
      rest.x + (color.x - rest.x) * mix,
      rest.y + (color.y - rest.y) * mix,
      rest.z + (color.z - rest.z) * mix,
      rest.w
    )
    this.writeEmissive(this.mainPass, color, this.mainEmissive)
  }

  /**
   * Puts the sphere back to its silver white rest colour, so the strobe is visible only for as
   * long as the sphere is actually held.
   */
  private restoreMainColor(): void {
    this.mainPass.baseColor = this.restColor
    if (this.emissivePort !== "") {
      this.mainPass[this.emissivePort] = this.mainEmissiveRest
    }
  }



  private writeEmissive(pass: any, color: vec4, intensity: number): void {
    if (this.emissivePort === "") {
      return
    }
    pass[this.emissivePort] = new vec3(color.x * intensity, color.y * intensity, color.z * intensity)
  }

  private writeOpacity(pass: any, opacity: number): void {
    if (this.opacityPort === "") {
      return
    }
    pass[this.opacityPort] = opacity
  }

  private hideAllGhosts(): void {
    for (let i = 0; i < this.ghosts.length; i++) {
      this.ghosts[i].active = false
      this.ghosts[i].sceneObject.enabled = false
    }
  }

  private destroyGhosts(): void {
    for (let i = 0; i < this.ghosts.length; i++) {
      this.ghosts[i].sceneObject.destroy()
    }
    this.ghosts = []
  }
}
