import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {MenuPanel} from "./MenuPanel"

/** One menu button and the neon pieces built around it. */
interface ButtonStyle {
  transform: Transform
  baseScale: vec3
  text: Text3D
  textPass: any
  outlinePass: any
  fillPass: any
  /** Eased 0 to 1 towards whether a ray is on the button. */
  hover: number
  hovered: boolean
  /** Brief burst of brightness when the button is pressed, decaying to 0. */
  flash: number
}

function withAlpha(color: vec4, alpha: number): vec4 {
  return new vec4(color.x, color.y, color.z, Math.max(0, Math.min(1, alpha)))
}

/** Appends one flat rectangle facing +Z. */
function quad(builder: MeshBuilder, x0: number, y0: number, x1: number, y1: number): void {
  const first = builder.getVerticesCount()
  builder.appendVerticesInterleaved([
    x0, y0, 0, 0, 0, 1, 0, 0,
    x1, y0, 0, 0, 0, 1, 1, 0,
    x1, y1, 0, 0, 0, 1, 1, 1,
    x0, y1, 0, 0, 0, 1, 0, 1
  ])
  builder.appendIndices([first, first + 1, first + 2, first, first + 2, first + 3])
}

/** A rectangle's outline, `thickness` wide, drawn inside its edges. */
function outline(builder: MeshBuilder, cx: number, cy: number, w: number, h: number, thickness: number): void {
  const l = cx - w / 2
  const r = cx + w / 2
  const b = cy - h / 2
  const t = cy + h / 2
  quad(builder, l, t - thickness, r, t)
  quad(builder, l, b, r, b + thickness)
  quad(builder, l, b + thickness, l + thickness, t - thickness)
  quad(builder, r - thickness, b + thickness, r, t - thickness)
}

function newBuilder(): MeshBuilder {
  const builder = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3},
    {name: "texture0", components: 2}
  ])
  builder.topology = MeshTopology.Triangles
  builder.indexType = MeshIndexType.UInt16
  return builder
}

/**
 * Retro-futuristic dressing for the main menu: '80s synthwave neon over the silver glass panel.
 *
 * - **Panel.** A neon frame round the glass with brighter corner brackets, and faint scanlines
 *   drifting slowly down it like an old CRT. Sized from the MenuPanel beside it, so the two always
 *   line up.
 * - **Buttons.** Every child with a Text3D is a button. Each gets a translucent backing plate and a
 *   neon outline, all the same size - fitted to the widest label - and its lettering is repainted
 *   in the neon palette.
 * - **Hover.** A ray on a button eases it up in size, swings its outline from the accent colour to
 *   the frame colour and brightens its lettering. Pressing it flashes.
 *
 * Everything is drawn semi-transparent with the unlit Line Material, cloned per piece so each can
 * be coloured on its own. The geometry is built in code, so nothing here needs placing by hand.
 *
 * Spectacles' display is additive - dark reads as see-through, not dark - which is why the style
 * is bright lines on faint glass rather than dark shapes.
 */
@component
export class RetroMenuStyle extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Material</span>')

  @input
  @label("Line Material")
  @hint("Unlit material every neon piece is drawn with, cloned per piece. Assets/Neon Line.mat.")
  @allowUndefined
  lineMaterial: Material | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Palette</span>')

  @input("vec4", "{0, 0.95, 1, 1}")
  @label("Frame")
  @hint("Panel frame and scanlines, and a button's outline while it is pointed at.")
  @widget(new ColorWidget())
  frameColor: vec4 = new vec4(0, 0.95, 1, 1)

  @input("vec4", "{1, 0.2, 0.8, 1}")
  @label("Accent")
  @hint("Corner brackets and the buttons' resting outlines.")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(1, 0.2, 0.8, 1)

  @input("vec4", "{1, 0.4, 0.85, 1}")
  @label("Text")
  @hint("Face of the button lettering.")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(1, 0.4, 0.85, 1)

  @input("vec4", "{0, 0.9, 1, 1}")
  @label("Text Edge")
  @hint("Sides of the button lettering.")
  @widget(new ColorWidget())
  textEdgeColor: vec4 = new vec4(0, 0.9, 1, 1)

  @input("vec4", "{0.8, 1, 1, 1}")
  @label("Hover Text")
  @hint("Face of the lettering while the button is pointed at.")
  @widget(new ColorWidget())
  hoverTextColor: vec4 = new vec4(0.8, 1, 1, 1)

  @input("vec4", "{0.45, 0.15, 0.85, 1}")
  @label("Button Fill")
  @hint("Tint of the plate behind each button.")
  @widget(new ColorWidget())
  fillColor: vec4 = new vec4(0.45, 0.15, 0.85, 1)

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Transparency</span>')

  @input
  @label("Line Opacity")
  @widget(new SliderWidget(0, 1, 0.01))
  lineOpacity: number = 0.65

  @input
  @label("Scanline Opacity")
  @widget(new SliderWidget(0, 1, 0.01))
  scanlineOpacity: number = 0.1

  @input
  @label("Text Opacity")
  @widget(new SliderWidget(0, 1, 0.01))
  textOpacity: number = 0.8

  @input
  @label("Button Fill Opacity")
  @widget(new SliderWidget(0, 1, 0.01))
  fillOpacity: number = 0.12

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Layout</span>')

  @input
  @label("Line Thickness (cm)")
  @widget(new SliderWidget(0.05, 1, 0.05))
  lineThickness: number = 0.25

  @input
  @label("Corner Length (cm)")
  @widget(new SliderWidget(0.5, 10, 0.25))
  cornerLength: number = 3

  @input
  @label("Scanline Spacing (cm)")
  @widget(new SliderWidget(0.3, 5, 0.1))
  scanlineSpacing: number = 1.2

  @input
  @label("Button Padding (cm)")
  @hint("Space between a button's lettering and its outline.")
  @widget(new SliderWidget(0, 5, 0.1))
  buttonPadding: number = 1.2

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Motion</span>')

  @input
  @label("Hover Scale")
  @widget(new SliderWidget(1, 1.3, 0.01))
  hoverScale: number = 1.06

  @input
  @label("Frame Pulse Speed")
  @hint("Breaths per second of the panel frame's glow. 0 holds it steady.")
  @widget(new SliderWidget(0, 3, 0.05))
  pulseSpeed: number = 0.5

  @input
  @label("Scanline Drift (cm/s)")
  @hint("How fast the scanlines crawl down the panel. 0 holds them still.")
  @widget(new SliderWidget(0, 5, 0.1))
  scanlineDrift: number = 0.6

  private panelWidth = 26
  private panelHeight = 48
  private panelDepth = 1

  private framePass: any = null
  private cornerPass: any = null
  private scanlinePass: any = null
  private scanlines: Transform | null = null

  private buttons: ButtonStyle[] = []
  /** Button outlines wait for the lettering to have a size, which it may not on the first frame. */
  private buttonsBuilt = false
  private buildAttempts = 0

  private clock = 0

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())

    // The menu is hidden with the button still under the ray that pressed it, so no hover exit
    // ever arrives. Coming back, every button starts un-hovered.
    this.createEvent("OnEnableEvent").bind(() => this.clearHover())
  }

  private init(): void {
    if (this.lineMaterial == null) {
      print("RetroMenuStyle: no Line Material assigned, the menu will not be styled.")
      return
    }

    this.readPanel()
    this.buildPanel()
    this.collectButtons()

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** Takes the frame's size from the MenuPanel under this object, so the two always match. */
  private readPanel(): void {
    const owner = this.getSceneObject()
    for (let i = 0; i < owner.getChildrenCount(); i++) {
      const panel = owner.getChild(i).getComponent(MenuPanel.getTypeName()) as MenuPanel
      if (panel != null) {
        this.panelWidth = panel.width
        this.panelHeight = panel.height
        this.panelDepth = panel.depth
        return
      }
    }
  }

  private buildPanel(): void {
    const w = this.panelWidth
    const h = this.panelHeight
    const t = this.lineThickness

    // Just in front of the glass, so the lines never z-fight with it.
    const z = -this.panelDepth + 0.05

    const frame = newBuilder()
    outline(frame, 0, 0, w, h, t)
    this.framePass = this.makePiece("Retro Frame", this.getSceneObject(), frame, z + 0.02)

    // Brackets straddle the frame at each corner, thicker than it, so the corners read as bolted on.
    const corners = newBuilder()
    const c = t * 2.4
    const length = Math.min(this.cornerLength, Math.min(w, h) / 2)
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        const x = (sx * w) / 2
        const y = (sy * h) / 2
        quad(corners, Math.min(x, x - sx * length), Math.min(y, y - sy * c), Math.max(x, x - sx * length), Math.max(y, y - sy * c))
        quad(corners, Math.min(x, x - sx * c), Math.min(y - sy * c, y - sy * length), Math.max(x, x - sx * c), Math.max(y - sy * c, y - sy * length))
      }
    }
    this.cornerPass = this.makePiece("Retro Corners", this.getSceneObject(), corners, z + 0.03)

    // One spacing is left clear at each end, which is the room the lines have to drift into.
    const lines = newBuilder()
    const spacing = Math.max(0.3, this.scanlineSpacing)
    const inset = t * 2
    for (let y = -h / 2 + spacing; y <= h / 2 - spacing * 2; y += spacing) {
      quad(lines, -w / 2 + inset, y, w / 2 - inset, y + Math.max(0.04, t * 0.4))
    }
    this.scanlinePass = this.makePiece("Retro Scanlines", this.getSceneObject(), lines, z)
    this.scanlines = this.scanlinePass === null ? null : this.findChild("Retro Scanlines")
  }

  /** Every child with Text3D lettering is a button. Its outline is built once it has a size. */
  private collectButtons(): void {
    const owner = this.getSceneObject()

    for (let i = 0; i < owner.getChildrenCount(); i++) {
      const child = owner.getChild(i)
      const text = child.getComponent("Component.Text3D") as Text3D
      if (text == null) {
        continue
      }

      // Cloned so hovering one button never recolours the others.
      text.mainMaterial = text.mainMaterial.clone()

      const button: ButtonStyle = {
        transform: child.getTransform(),
        baseScale: child.getTransform().getLocalScale(),
        text: text,
        textPass: text.mainMaterial.mainPass,
        outlinePass: null,
        fillPass: null,
        hover: 0,
        hovered: false,
        flash: 0
      }

      const interactable = child.getComponent(Interactable.getTypeName()) as Interactable
      if (interactable != null) {
        interactable.onHoverEnter.add(() => (button.hovered = true))
        interactable.onHoverExit.add(() => (button.hovered = false))
        interactable.onTriggerStart.add(() => (button.flash = 1))
      }

      this.buttons.push(button)
      this.paintButton(button)
    }
  }

  /**
   * All outlines share one size - the widest label plus padding - so the column reads as a set.
   * Lettering is measured from its own mesh, which can still be empty on the first frame or two.
   */
  private tryBuildButtons(): void {
    this.buildAttempts++

    let width = 0
    let height = 0
    const centres: vec3[] = []

    for (let i = 0; i < this.buttons.length; i++) {
      const box = this.measure(this.buttons[i].text)
      if (box === null && this.buildAttempts < 10) {
        return
      }
      const min = box !== null ? box[0] : new vec3(-7.5, -2.25, 0)
      const max = box !== null ? box[1] : new vec3(7.5, 2.25, 0)
      width = Math.max(width, max.x - min.x)
      height = Math.max(height, max.y - min.y)
      centres.push(min.add(max).uniformScale(0.5))
    }

    const pad = this.buttonPadding
    const maxWidth = this.panelWidth - this.lineThickness * 2 - 2
    const w = Math.min(width + pad * 2, maxWidth)
    const h = height + pad

    print("RetroMenuStyle: lettering " + width.toFixed(1) + " x " + height.toFixed(1) + " cm, buttons " + w.toFixed(1) + " x " + h.toFixed(1) + " cm, panel " + this.panelWidth + " x " + this.panelHeight + " cm")

    for (let i = 0; i < this.buttons.length; i++) {
      const button = this.buttons[i]
      const owner = button.text.getSceneObject()
      const cy = centres[i].y

      const edge = newBuilder()
      outline(edge, 0, cy, w, h, this.lineThickness * 0.8)
      button.outlinePass = this.makePiece("Retro Button Outline", owner, edge, -0.3)

      const plate = newBuilder()
      quad(plate, -w / 2, cy - h / 2, w / 2, cy + h / 2)
      button.fillPass = this.makePiece("Retro Button Fill", owner, plate, -0.35)
    }

    this.buttonsBuilt = true
  }

  private measure(text: Text3D): vec3[] | null {
    const visual = text as any
    if (typeof visual.localAabbMin !== "function") {
      return null
    }
    const min: vec3 = visual.localAabbMin()
    const max: vec3 = visual.localAabbMax()
    if (max.x - min.x < 0.01 || max.y - min.y < 0.01) {
      return null
    }
    return [min, max]
  }

  private onUpdate(): void {
    const deltaTime = getDeltaTime()
    this.clock += deltaTime

    if (!this.buttonsBuilt) {
      this.tryBuildButtons()
    }

    const pulse = this.pulseSpeed > 0 ? 0.82 + 0.18 * Math.sin(this.clock * this.pulseSpeed * Math.PI * 2) : 1
    this.tint(this.framePass, this.frameColor, this.lineOpacity * pulse)
    this.tint(this.cornerPass, this.accentColor, Math.min(1, this.lineOpacity * 1.3 * pulse))
    this.tint(this.scanlinePass, this.frameColor, this.scanlineOpacity)

    if (this.scanlines !== null && this.scanlineDrift > 0) {
      const spacing = Math.max(0.3, this.scanlineSpacing)
      const offset = (this.clock * this.scanlineDrift) % spacing
      this.scanlines.setLocalPosition(new vec3(0, -offset, this.scanlines.getLocalPosition().z))
    }

    const ease = Math.min(1, deltaTime * 12)
    for (let i = 0; i < this.buttons.length; i++) {
      const button = this.buttons[i]
      button.hover += ((button.hovered ? 1 : 0) - button.hover) * ease
      button.flash = Math.max(0, button.flash - deltaTime * 4)
      this.paintButton(button)
    }
  }

  private paintButton(button: ButtonStyle): void {
    const k = button.hover
    const glow = Math.min(1, k + button.flash)

    button.transform.setLocalScale(button.baseScale.uniformScale(1 + (this.hoverScale - 1) * k))

    const face = withAlpha(vec4.lerp(this.textColor, this.hoverTextColor, glow), this.textOpacity + (1 - this.textOpacity) * glow)
    const side = withAlpha(this.textEdgeColor, this.textOpacity)
    const pass = button.textPass
    pass.frontCapStartingColor = face
    pass.backCapStartingColor = side
    pass.outerEdgeStartingColor = side
    pass.outerEdgeEndingColor = side
    pass.InnerEdgeStartingColor = side
    pass.InnerEdgeEndingColor = side

    this.tint(button.outlinePass, vec4.lerp(this.accentColor, this.frameColor, glow), this.lineOpacity * (0.65 + 0.35 * glow) + button.flash * 0.3)
    this.tint(button.fillPass, this.fillColor, this.fillOpacity * (1 + glow))
  }

  private clearHover(): void {
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].hovered = false
      this.buttons[i].hover = 0
      this.buttons[i].flash = 0
      this.paintButton(this.buttons[i])
    }
  }

  private tint(pass: any, color: vec4, alpha: number): void {
    if (pass !== null) {
      pass.baseColor = withAlpha(color, alpha)
    }
  }

  /** A child holding one built mesh, drawn with its own clone of the line material. */
  private makePiece(name: string, parent: SceneObject, builder: MeshBuilder, z: number): any {
    if (builder.getVerticesCount() === 0) {
      return null
    }
    builder.updateMesh()

    const piece = global.scene.createSceneObject(name)
    piece.setParent(parent)
    piece.layer = parent.layer
    piece.getTransform().setLocalPosition(new vec3(0, 0, z))

    const visual = piece.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = builder.getMesh()
    visual.mainMaterial = this.lineMaterial!.clone()

    const pass = visual.mainMaterial.mainPass as any
    // Seen from either side, and never hiding the glass or each other behind a depth write.
    pass.twoSided = true
    pass.depthWrite = false
    return pass
  }

  private findChild(name: string): Transform | null {
    const owner = this.getSceneObject()
    for (let i = owner.getChildrenCount() - 1; i >= 0; i--) {
      if (owner.getChild(i).name === name) {
        return owner.getChild(i).getTransform()
      }
    }
    return null
  }
}
