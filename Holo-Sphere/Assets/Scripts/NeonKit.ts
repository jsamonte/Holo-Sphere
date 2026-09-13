import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {newBuilder, outline, quad, withAlpha} from "./RetroMenuStyle"

/**
 * Building blocks for the neon panels drawn in code - the name keyboard, the calibration panel and
 * the gesture cues - so they all match RetroMenuStyle's menus.
 */

/** A clone of the unlit line material, seen from either side and never hiding anything behind a depth write. */
export function newLineMaterial(line: Material): Material {
  const material = line.clone()
  const pass = material.mainPass as any
  pass.twoSided = true
  pass.depthWrite = false
  return material
}

export function tint(material: Material | null, color: vec4, alpha: number): void {
  if (material !== null) {
    material.mainPass.baseColor = withAlpha(color, alpha)
  }
}

/** Draws `builder` on `owner` with `material`, which it hands back. */
export function addVisual(owner: SceneObject, builder: MeshBuilder, material: Material): Material {
  builder.updateMesh()
  const visual = owner.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  visual.mesh = builder.getMesh()
  visual.mainMaterial = material
  return material
}

/** A child of `parent` holding one built mesh, `z` in front of it. */
export function makePiece(name: string, parent: SceneObject, builder: MeshBuilder, z: number, material: Material): Material {
  const piece = global.scene.createSceneObject(name)
  piece.setParent(parent)
  piece.layer = parent.layer
  piece.getTransform().setLocalPosition(new vec3(0, 0, z))
  return addVisual(piece, builder, material)
}

/** Centred Text3D lettering on a new child of `parent`. */
export function makeText(label: string, parent: SceneObject, position: vec3, size: number, font: Font, material: Material): Text3D {
  const owner = global.scene.createSceneObject(label)
  owner.setParent(parent)
  owner.layer = parent.layer
  owner.getTransform().setLocalPosition(position)

  const text = owner.createComponent("Component.Text3D") as Text3D
  text.font = font
  text.mainMaterial = material
  text.size = size
  text.horizontalAlignment = HorizontalAlignment.Center
  text.verticalAlignment = VerticalAlignment.Center
  text.extrusionDepth = 0.15
  text.text = label
  return text
}

/** Colours a Text3D material the way RetroMenuStyle colours the menu lettering. */
export function paintText(material: Material, face: vec4, edge: vec4, opacity: number = 1): void {
  const pass = material.mainPass as any
  const front = withAlpha(face, 0.9 * opacity)
  const side = withAlpha(edge, 0.8 * opacity)
  pass.frontCapStartingColor = front
  pass.backCapStartingColor = side
  pass.outerEdgeStartingColor = side
  pass.outerEdgeEndingColor = side
  pass.InnerEdgeStartingColor = side
  pass.InnerEdgeEndingColor = side
}

/** Materials, font and palette a {@link NeonButton} is drawn with. */
export interface NeonStyle {
  lineMaterial: Material
  font: Font
  textMaterial: Material
  frameColor: vec4
  accentColor: vec4
  fillColor: vec4
}

/**
 * One neon button built in code: lettering on a translucent plate inside an outline, which lights up
 * while a ray is on it and brightens when selected. Aimed at and pinched like any menu button.
 */
export class NeonButton {
  readonly sceneObject: SceneObject
  readonly width: number

  private text: Text3D
  private style: NeonStyle
  private outlineMaterial: Material
  private glow: SceneObject
  private selected = false

  constructor(style: NeonStyle, parent: SceneObject, label: string, width: number, height: number, letterSize: number, onPress: () => void) {
    this.style = style
    this.width = width

    this.text = makeText(label, parent, vec3.zero(), letterSize, style.font, style.textMaterial)
    const owner = this.text.getSceneObject()
    owner.name = label + " Button"
    this.sceneObject = owner

    const thickness = Math.max(0.08, height * 0.05)

    const edge = newBuilder()
    outline(edge, 0, 0, width, height, thickness)
    const plate = newBuilder()
    quad(plate, -width / 2, -height / 2, width / 2, height / 2)

    this.outlineMaterial = makePiece("Button Outline", owner, edge, -0.15, newLineMaterial(style.lineMaterial))
    tint(makePiece("Button Plate", owner, plate, -0.2, newLineMaterial(style.lineMaterial)), style.fillColor, 0.12)

    const glowLine = newBuilder()
    outline(glowLine, 0, 0, width, height, thickness * 1.8)
    const glowFill = newBuilder()
    quad(glowFill, -width / 2, -height / 2, width / 2, height / 2)

    this.glow = global.scene.createSceneObject("Button Glow")
    this.glow.setParent(owner)
    this.glow.layer = owner.layer
    this.glow.getTransform().setLocalPosition(new vec3(0, 0, -0.12))
    tint(addVisual(this.glow, glowLine, newLineMaterial(style.lineMaterial)), style.frameColor, 0.9)
    tint(addVisual(this.glow, glowFill, newLineMaterial(style.lineMaterial)), style.fillColor, 0.3)
    this.glow.enabled = false

    // Collider before Interactable: SIK looks for the button's colliders as the Interactable wakes.
    const collider = owner.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(width, height, 0.8)
    collider.shape = shape
    collider.fitVisual = false

    const interactable = owner.createComponent(Interactable.getTypeName()) as Interactable
    interactable.onHoverEnter.add(() => (this.glow.enabled = true))
    interactable.onHoverExit.add(() => (this.glow.enabled = false))
    interactable.onTriggerStart.add(() => onPress())

    this.paint()
  }

  setLabel(label: string): void {
    this.text.text = label
  }

  setPosition(x: number, y: number): void {
    this.sceneObject.getTransform().setLocalPosition(new vec3(x, y, 0))
  }

  /** Hidden with a ray still on it, a button gets no hover exit, so it always comes back un-hovered. */
  setVisible(visible: boolean): void {
    this.sceneObject.enabled = visible
    this.glow.enabled = false
  }

  setSelected(selected: boolean): void {
    this.selected = selected
    this.paint()
  }

  private paint(): void {
    if (this.selected) {
      tint(this.outlineMaterial, this.style.frameColor, 0.95)
    } else {
      tint(this.outlineMaterial, this.style.accentColor, 0.6)
    }
  }
}
