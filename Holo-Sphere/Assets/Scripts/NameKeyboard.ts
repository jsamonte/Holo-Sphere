import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {newBuilder, outline, quad, withAlpha} from "./RetroMenuStyle"

/** One key of the layout: what it shows, what it types, and how many key widths it spans. */
interface KeyDef {
  label: string
  value: string
  units: number
}

const DELETE = "\b"
const ENTER = "\n"

function letters(row: string): KeyDef[] {
  return row.split("").map((character) => ({label: character, value: character, units: 1}))
}

const LAYOUT: KeyDef[][] = [
  letters("1234567890"),
  letters("QWERTYUIOP"),
  letters("ASDFGHJKL"),
  letters("ZXCVBNM").concat([{label: "DEL", value: DELETE, units: 2}]),
  [
    {label: "SPACE", value: " ", units: 5},
    {label: "ENTER", value: ENTER, units: 3}
  ]
]

/**
 * A holographic keyboard for typing a name, drawn in the menus' neon style.
 *
 * Spectacles' system keyboard does not come up in this Lens, so the leaderboard brings this one up
 * instead. Every key is its own Interactable with a box collider, so it is aimed at and pinched
 * like any menu button. A line above the keys shows the name as it is typed.
 *
 * - **DEL** removes the last character.
 * - **ENTER** hands the name back and closes the keyboard.
 *
 * The keys are built in code the first time the keyboard opens, so nothing here needs placing by
 * hand. Put this on an empty SceneObject and position that where the keyboard should float.
 */
@component
export class NameKeyboard extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Look</span>')

  @input
  @label("Line Material")
  @hint("Unlit material the keys are drawn with, cloned per piece. Assets/Neon Line.mat, the same as the menus.")
  @allowUndefined
  lineMaterial: Material | null = null

  @input
  @label("Font Source")
  @hint("Any Text3D in the VT323 font, like the leaderboard's Rows. The keys copy its font and material.")
  @allowUndefined
  fontSource: Text3D | null = null

  @input("vec4", "{0, 0.95, 1, 1}")
  @label("Frame")
  @hint("The frame round the keyboard, and a key's outline while it is pointed at.")
  @widget(new ColorWidget())
  frameColor: vec4 = new vec4(0, 0.95, 1, 1)

  @input("vec4", "{1, 0.2, 0.8, 1}")
  @label("Key Outline")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(1, 0.2, 0.8, 1)

  @input("vec4", "{1, 0.4, 0.85, 1}")
  @label("Text")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(1, 0.4, 0.85, 1)

  @input("vec4", "{0, 0.9, 1, 1}")
  @label("Text Edge")
  @widget(new ColorWidget())
  edgeColor: vec4 = new vec4(0, 0.9, 1, 1)

  @input("vec4", "{0.45, 0.15, 0.85, 1}")
  @label("Key Fill")
  @widget(new ColorWidget())
  fillColor: vec4 = new vec4(0.45, 0.15, 0.85, 1)

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Layout</span>')

  @input
  @label("Key Size (cm)")
  @widget(new SliderWidget(1.5, 6, 0.1))
  keySize: number = 2.9

  @input
  @label("Key Gap (cm)")
  @widget(new SliderWidget(0, 1.5, 0.05))
  keyGap: number = 0.3

  @input
  @label("Letter Size")
  @hint("Text3D size of the key labels.")
  @widget(new SliderWidget(20, 120, 1))
  letterSize: number = 56

  @input
  @label("Name Size")
  @hint("Text3D size of the name shown above the keys.")
  @widget(new SliderWidget(20, 120, 1))
  nameSize: number = 60

  @input
  @label("Max Length")
  @hint("Most characters a name can have. Matches the leaderboard's name column.")
  @widget(new SliderWidget(1, 24, 1))
  maxLength: number = 12

  private built = false
  /** Each key's glow, lit only while a ray is on that key. */
  private glows: SceneObject[] = []
  private nameText: Text3D | null = null
  /** Shared by every key's glow, so a press can brighten whichever key is lit. */
  private glowLineMaterial: Material | null = null
  private glowFillMaterial: Material | null = null

  private text = ""
  private onChange: ((text: string) => void) | null = null
  private onEnter: (() => void) | null = null
  /** Brief burst of brightness on the key glow when a key is pressed, decaying to 0. */
  private flash = 0

  onAwake(): void {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /**
   * Shows the keyboard holding `initial`. `onChange` hears every edit and `onEnter` the ENTER key;
   * the keyboard stays up until {@link close} is called.
   */
  open(initial: string, onChange: (text: string) => void, onEnter: () => void): void {
    this.onChange = onChange
    this.onEnter = onEnter
    this.text = initial.toUpperCase().substring(0, this.limit())
    this.flash = 0

    this.getSceneObject().enabled = true
    this.build()
    // The keyboard is hidden with a key still under the ray that pressed it, so no hover exit ever
    // arrives. Coming back, every key starts un-hovered.
    for (let i = 0; i < this.glows.length; i++) {
      this.glows[i].enabled = false
    }
    this.refresh()
  }

  close(): void {
    this.onChange = null
    this.onEnter = null
    this.getSceneObject().enabled = false
  }

  private press(def: KeyDef): void {
    const onEnter = this.onEnter
    if (onEnter === null) {
      return
    }
    this.flash = 1

    if (def.value === ENTER) {
      onEnter()
      return
    }

    if (def.value === DELETE) {
      this.text = this.text.substring(0, this.text.length - 1)
    } else if (this.text.length >= this.limit()) {
      return
    } else if (def.value === " " && (this.text === "" || this.text.endsWith(" "))) {
      // No leading or doubled spaces: the leaderboard would only tidy them away again.
      return
    } else {
      this.text += def.value
    }

    this.refresh()
    if (this.onChange !== null) {
      this.onChange(this.text)
    }
  }

  private refresh(): void {
    if (this.nameText !== null) {
      const cursor = this.text.length < this.limit() ? "_" : ""
      this.nameText.text = "NAME: " + this.text + cursor
    }
  }

  private limit(): number {
    return Math.max(1, Math.round(this.maxLength))
  }

  private onUpdate(): void {
    if (this.flash <= 0) {
      return
    }
    this.flash = Math.max(0, this.flash - getDeltaTime() * 5)
    this.tintGlow()
  }

  private tintGlow(): void {
    this.tint(this.glowLineMaterial, this.frameColor, 0.8 + 0.2 * this.flash)
    this.tint(this.glowFillMaterial, this.fillColor, 0.3 + 0.4 * this.flash)
  }

  /**
   * Lays the keys out in rows centred on this object, the name line above them and a frame round
   * the lot. Every key's outline and plate share one mesh each, so the whole board costs a handful
   * of draws plus its lettering.
   */
  private build(): void {
    if (this.built) {
      return
    }
    this.built = true

    if (this.lineMaterial == null || this.fontSource == null) {
      print("NameKeyboard: needs a Line Material and a Font Source to build its keys.")
      return
    }

    const size = this.keySize
    const pitch = size + this.keyGap
    const thickness = Math.max(0.06, size * 0.05)
    const rows = LAYOUT.length

    const textMaterial = this.fontSource.mainMaterial.clone()
    this.paintText(textMaterial)

    this.glowLineMaterial = this.newLineMaterial()
    this.glowFillMaterial = this.newLineMaterial()
    this.tintGlow()

    const outlines = newBuilder()
    const plates = newBuilder()

    let widest = 0
    for (let r = 0; r < rows; r++) {
      const row = LAYOUT[r]
      const units = row.reduce((sum, def) => sum + def.units, 0)
      widest = Math.max(widest, units * pitch)

      const y = ((rows - 1) / 2 - r) * pitch
      let x = -(units * pitch) / 2
      for (let k = 0; k < row.length; k++) {
        const def = row[k]
        const width = def.units * pitch - this.keyGap
        const cx = x + (def.units * pitch) / 2

        outline(outlines, cx, y, width, size, thickness)
        quad(plates, cx - width / 2, y - size / 2, cx + width / 2, y + size / 2)
        this.makeKey(def, cx, y, width, textMaterial)

        x += def.units * pitch
      }
    }

    // The name line sits above the top row, and the frame takes in both with a margin.
    const margin = pitch * 0.4
    const keysTop = ((rows - 1) / 2) * pitch + size / 2
    const keysBottom = -keysTop
    const nameY = keysTop + pitch * 0.8
    const frameTop = nameY + pitch * 0.7
    const frameBottom = keysBottom - margin
    const frameWidth = widest + margin * 2

    // A faint glass backing, drawn in the key plates' mesh so the plates read brighter over it.
    quad(plates, -frameWidth / 2, frameBottom, frameWidth / 2, frameTop)

    const frame = newBuilder()
    outline(frame, 0, (frameTop + frameBottom) / 2, frameWidth, frameTop - frameBottom, thickness * 1.6)

    const owner = this.getSceneObject()
    this.tint(this.makePiece("Keyboard Plates", owner, plates, -0.15), this.fillColor, 0.12)
    this.tint(this.makePiece("Keyboard Outlines", owner, outlines, 0), this.accentColor, 0.6)
    this.tint(this.makePiece("Keyboard Frame", owner, frame, 0), this.frameColor, 0.7)

    this.nameText = this.makeText("Typed Name", owner, new vec3(0, nameY, 0.05), this.nameSize, textMaterial)
  }

  private makeKey(def: KeyDef, cx: number, cy: number, width: number, textMaterial: Material): void {
    const size = this.keySize
    const owner = this.makeText(def.label, this.getSceneObject(), new vec3(cx, cy, 0.05), this.letterSize, textMaterial).getSceneObject()
    owner.name = "Key " + def.label

    // Collider before Interactable: SIK looks for the key's colliders as the Interactable wakes.
    const collider = owner.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(width, size, 0.8)
    collider.shape = shape
    collider.fitVisual = false

    const glowLine = newBuilder()
    outline(glowLine, 0, 0, width, size, Math.max(0.1, size * 0.08))
    const glowFill = newBuilder()
    quad(glowFill, -width / 2, -size / 2, width / 2, size / 2)

    const glow = global.scene.createSceneObject("Key Glow")
    glow.setParent(owner)
    glow.layer = owner.layer
    glow.getTransform().setLocalPosition(new vec3(0, 0, -0.03))
    this.addVisual(glow, glowLine, this.glowLineMaterial!)
    this.addVisual(glow, glowFill, this.glowFillMaterial!)
    glow.enabled = false
    this.glows.push(glow)

    const interactable = owner.createComponent(Interactable.getTypeName()) as Interactable
    interactable.onHoverEnter.add(() => (glow.enabled = true))
    interactable.onHoverExit.add(() => (glow.enabled = false))
    interactable.onTriggerStart.add(() => this.press(def))
  }

  private makeText(label: string, parent: SceneObject, position: vec3, size: number, material: Material): Text3D {
    const owner = global.scene.createSceneObject(label)
    owner.setParent(parent)
    owner.layer = parent.layer
    owner.getTransform().setLocalPosition(position)

    const text = owner.createComponent("Component.Text3D") as Text3D
    text.font = this.fontSource!.font
    text.mainMaterial = material
    text.size = size
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.extrusionDepth = 0.15
    text.text = label
    return text
  }

  /** Text3D material cloned from the Font Source, recoloured once for every key label. */
  private paintText(material: Material): void {
    const pass = material.mainPass as any
    const face = withAlpha(this.textColor, 0.9)
    const side = withAlpha(this.edgeColor, 0.8)
    pass.frontCapStartingColor = face
    pass.backCapStartingColor = side
    pass.outerEdgeStartingColor = side
    pass.outerEdgeEndingColor = side
    pass.InnerEdgeStartingColor = side
    pass.InnerEdgeEndingColor = side
  }

  /** A child holding one built mesh, drawn with its own clone of the line material. */
  private makePiece(name: string, parent: SceneObject, builder: MeshBuilder, z: number): Material {
    const piece = global.scene.createSceneObject(name)
    piece.setParent(parent)
    piece.layer = parent.layer
    piece.getTransform().setLocalPosition(new vec3(0, 0, z))
    return this.addVisual(piece, builder, this.newLineMaterial())
  }

  private addVisual(owner: SceneObject, builder: MeshBuilder, material: Material): Material {
    builder.updateMesh()
    const visual = owner.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = builder.getMesh()
    visual.mainMaterial = material
    return material
  }

  private newLineMaterial(): Material {
    const material = this.lineMaterial!.clone()
    const pass = material.mainPass as any
    // Seen from either side, and never hiding the glass or each other behind a depth write.
    pass.twoSided = true
    pass.depthWrite = false
    return material
  }

  private tint(material: Material | null, color: vec4, alpha: number): void {
    if (material !== null) {
      material.mainPass.baseColor = withAlpha(color, alpha)
    }
  }
}
