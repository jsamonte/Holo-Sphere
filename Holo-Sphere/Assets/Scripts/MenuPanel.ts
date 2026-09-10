/**
 * Dresses the menu's backing panel in the sphere's own glass.
 *
 * The panel is given the sphere's Iridescence material in the Inspector. At start this clones it -
 * so nothing written here reaches the sphere - tints it the same silver the sphere rests at, and
 * sets its own opacity, the same way StrobeGhostTrail dresses the sphere itself.
 *
 * It also sizes the panel to sit behind the buttons. The mesh is measured rather than assumed, so a
 * plane authored lying flat is stood up to face the player, and Width and Height are in centimetres
 * whatever size the mesh was built at.
 *
 * The panel has no collider, so it never catches the rays aimed at the buttons in front of it.
 */
@component
export class MenuPanel extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Look</span>')

  @input("vec4", "{0.88, 0.89, 0.91, 1}")
  @label("Color")
  @hint("Tint of the panel. Matches the sphere's silver rest colour by default.")
  @widget(new ColorWidget())
  color: vec4 = new vec4(0.88, 0.89, 0.91, 1)

  @input
  @label("Opacity")
  @hint("How solid the panel is. Keep it low so the buttons' text stands out in front of it.")
  @widget(new SliderWidget(0, 1, 0.01))
  opacity: number = 0.3

  @input
  @label("Opacity Port")
  @hint("Name of the opacity (float) port on the material. Matches the sphere's Iridescence material.")
  opacityPort: string = "Port_Opacity_N006"

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Size</span>')

  @input
  @label("Width (cm)")
  @widget(new SliderWidget(5, 100, 0.5))
  width: number = 26

  @input
  @label("Height (cm)")
  @widget(new SliderWidget(5, 100, 0.5))
  height: number = 48

  @input
  @label("Depth Behind Buttons (cm)")
  @hint("How far behind the buttons the panel sits, so the text is always drawn in front of it.")
  @widget(new SliderWidget(0, 10, 0.1))
  depth: number = 1

  onAwake(): void {
    const visual = this.getSceneObject().getComponent("Component.RenderMeshVisual")
    if (visual === null) {
      print("MenuPanel: no RenderMeshVisual on " + this.getSceneObject().name + ", nothing to dress.")
      return
    }

    this.dress(visual)
    this.fit(visual)
  }

  private dress(visual: RenderMeshVisual): void {
    // Cloned so the panel's tint and opacity never write back into the sphere's material.
    visual.mainMaterial = visual.mainMaterial.clone()
    const pass = visual.mainMaterial.mainPass as any

    pass.baseColor = this.color
    if (this.opacityPort !== "" && pass[this.opacityPort] !== undefined) {
      pass[this.opacityPort] = this.opacity
    }

    // The sphere's material only draws front faces. Two-sided means the panel shows whichever way
    // its mesh happens to face.
    pass.twoSided = true
  }

  /**
   * A plane has one axis with no thickness. Lying flat that is Y, so it is turned a quarter about X
   * to stand up facing the player; already upright it is Z and needs no turn. Either way the two
   * broad axes are then scaled to Width and Height.
   */
  private fit(visual: RenderMeshVisual): void {
    const size = visual.mesh.aabbMax.sub(visual.mesh.aabbMin)
    const transform = this.getTransform()
    const lyingFlat = size.y < size.z

    transform.setLocalPosition(new vec3(0, 0, -this.depth))

    if (lyingFlat) {
      transform.setLocalRotation(quat.angleAxis(Math.PI / 2, vec3.right()))
      transform.setLocalScale(new vec3(this.width / Math.max(size.x, 0.0001), 1, this.height / Math.max(size.z, 0.0001)))
      return
    }

    transform.setLocalRotation(quat.quatIdentity())
    transform.setLocalScale(new vec3(this.width / Math.max(size.x, 0.0001), this.height / Math.max(size.y, 0.0001), 1))
  }
}
