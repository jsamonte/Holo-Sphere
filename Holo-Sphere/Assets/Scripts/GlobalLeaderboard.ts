import {Interactable} from "../SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "../SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"

/** One line of the board. A rank of 0 means Snap did not give one. */
interface Entry {
  rank: number
  name: string
  score: number
  isPlayer: boolean
}

/** One score as kept on the headset. */
interface SavedScore {
  name: string
  score: number
}

const enum Status {
  /** A score has been posted to the global board and the board is still on its way. */
  Loading,
  Ready
}

/** Where the board on show comes from. */
const enum Source {
  /** Snap's leaderboard, shared by everyone who plays the Lens. */
  Global,
  /** This headset's own board, used whenever the global one cannot be reached. */
  Local
}

/** Most characters of a name. The font is monospaced, so padding is what lines the columns up. */
const NAME_WIDTH = 12

const DEFAULT_NAME = "PLAYER"
const LAST_NAME_KEY = "lastName"

/**
 * Emoji and the characters that join them. The font has no glyphs for any of them, and cutting a
 * name to length could otherwise split one in half.
 */
function isGlyphless(code: number): boolean {
  return (code >= 0xd800 && code <= 0xdfff) || (code >= 0x2600 && code <= 0x27bf) || code === 0xfe0f || code === 0x200d
}

/** Upper case, without emoji, spaces tidied, and cut to NAME_WIDTH. Empty when nothing usable is left. */
function cleanName(text: string): string {
  let kept = ""
  for (let i = 0; i < text.length; i++) {
    if (!isGlyphless(text.charCodeAt(i))) {
      kept += text[i]
    }
  }
  return kept.replace(/\s+/g, " ").trim().toUpperCase().substring(0, NAME_WIDTH).trim()
}

/** Snap withholds names on global boards for anyone who is not the player or one of their friends. */
function nameOf(record: Leaderboard.UserRecord): string {
  const user = record.snapchatUser
  const name = user != null && user.displayName ? cleanName(user.displayName) : ""
  return name !== "" ? name : DEFAULT_NAME
}

/**
 * The rhythm modes' top scores, one board per mode so an Easy run is only ever ranked against
 * other Easy runs.
 *
 * GameMenu posts a run's score the moment it ends, and shows this panel in place of the menu once
 * the Ending Sequence is over. Scroll Up and Scroll Down move the list by Rows Per Scroll, and Main
 * Menu hands back to GameMenu.
 *
 * - **Global.** With internet the score goes to Snap's leaderboard, but only when it beats the
 *   player's best, so a weak run never costs them their place. Their row is marked with a > and
 *   listed as YOU; everyone else is named only when Snap shares it, which on a global board means
 *   friends.
 * - **Local.** With no internet, or when Snap's board cannot be reached, the headset keeps its own
 *   board instead. A run that makes it opens the keyboard for the player's name, filled in with the
 *   last one typed, and the score is kept whether or not they change it.
 */
@component
export class GlobalLeaderboard extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Text</span>')

  @input
  @label("Title")
  @allowUndefined
  titleText: Text3D | null = null

  @input
  @label("Info")
  @hint("Two lines: this run's score and standing, then which ranks are showing - or, while a name is being typed, how to finish.")
  @allowUndefined
  infoText: Text3D | null = null

  @input
  @label("Rows")
  @hint("The list itself. Needs a monospaced font, like VT323, for its columns to line up.")
  @allowUndefined
  rowsText: Text3D | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Buttons</span>')

  @input @label("Scroll Up Button") @allowUndefined upButton: SceneObject | null = null
  @input @label("Scroll Down Button") @allowUndefined downButton: SceneObject | null = null
  @input @label("Main Menu Button") @allowUndefined menuButton: SceneObject | null = null

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">List</span>')

  @input
  @label("Visible Rows")
  @widget(new SliderWidget(3, 15, 1))
  visibleRows: number = 10

  @input
  @label("Rows Per Scroll")
  @widget(new SliderWidget(1, 15, 1))
  scrollStep: number = 5

  @input
  @label("Scores To Fetch")
  @hint("How many top scores are downloaded, or kept on the headset, and so how far down the list can be scrolled.")
  @widget(new SliderWidget(10, 100, 5))
  fetchLimit: number = 50

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Palette</span>')

  @input("vec4", "{0, 0.95, 1, 1}")
  @label("Title")
  @widget(new ColorWidget())
  titleColor: vec4 = new vec4(0, 0.95, 1, 1)

  @input("vec4", "{1, 0.4, 0.85, 1}")
  @label("Text")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(1, 0.4, 0.85, 1)

  @input("vec4", "{0, 0.9, 1, 1}")
  @label("Text Edge")
  @hint("Sides of all the lettering.")
  @widget(new ColorWidget())
  edgeColor: vec4 = new vec4(0, 0.9, 1, 1)

  private module: LeaderboardModule | null = null
  private boards: {[name: string]: Leaderboard} = {}

  /** Bumped by every post, so replies still arriving for an earlier run are dropped. */
  private request = 0
  private status: Status = Status.Loading
  private source: Source = Source.Global
  private boardName = ""
  private runScore = 0
  private entries: Entry[] = []
  /** The player's own row: their global record, or this run's entry on the headset's board. */
  private player: Entry | null = null
  /** Index into entries of the top visible row. */
  private first = 0

  /** The headset's board as stored, and this run's place in it. */
  private saved: SavedScore[] = []
  private savedIndex = -1
  /** This run made the headset's board and its name is still open for typing. */
  private naming = false
  private keyboardOpen = false

  private onMainMenu: (() => void) | null = null
  private ready = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.setup()
      // Hidden only now, rather than in the scene, so the buttons' Interactables were awake to bind.
      this.hide()
    })
  }

  /** Posts a finished run's score to the named board, then downloads the board to show it against. */
  postScore(boardName: string, score: number): void {
    const request = ++this.request
    this.boardName = boardName
    this.runScore = score
    this.source = Source.Global
    this.entries = []
    this.player = null
    this.first = 0
    this.naming = false
    this.setStatus(Status.Loading)

    if (!global.deviceInfoSystem.isInternetAvailable()) {
      this.useLocal(request, "no internet")
      return
    }

    this.getBoard(boardName, request, (board) =>
      this.load(board, request, () => {
        const best = this.player !== null ? this.player.score : 0
        if (score <= best) {
          this.setStatus(Status.Ready)
          return
        }

        board.submitScore(
          score,
          () => this.load(board, request, () => this.setStatus(Status.Ready)),
          (status) => this.useLocal(request, "submitScore failed, status " + status)
        )
      })
    )
  }

  show(onMainMenu: () => void): void {
    this.onMainMenu = onMainMenu
    this.getSceneObject().enabled = true
    this.setup()
    this.render()
    if (this.naming) {
      this.openKeyboard()
    }
  }

  hide(): void {
    this.finishNaming()
    this.onMainMenu = null
    this.getSceneObject().enabled = false
  }

  private setup(): void {
    if (this.ready) {
      return
    }
    this.ready = true

    this.paint(this.titleText, this.titleColor)
    this.paint(this.infoText, this.textColor)
    this.paint(this.rowsText, this.textColor)

    this.bindButton(this.upButton, () => this.scroll(-1))
    this.bindButton(this.downButton, () => this.scroll(1))
    this.bindButton(this.menuButton, () => {
      if (this.onMainMenu !== null) {
        this.onMainMenu()
      }
    })
  }

  private getBoard(name: string, request: number, done: (board: Leaderboard) => void): void {
    const cached = this.boards[name]
    if (cached !== undefined) {
      done(cached)
      return
    }

    const module = this.leaderboardModule()
    if (module === null) {
      this.useLocal(request, "LeaderboardModule is not available")
      return
    }

    const options = Leaderboard.CreateOptions.create()
    options.name = name
    options.orderingType = Leaderboard.OrderingType.Descending
    // Snap rejects 0 here despite documenting it as "the default", so the one year is spelled out.
    options.ttlSeconds = 365 * 24 * 60 * 60

    module.getLeaderboard(
      options,
      (board) => {
        this.boards[name] = board
        if (request === this.request) {
          done(board)
        }
      },
      (message) => this.useLocal(request, "getLeaderboard failed: " + message)
    )
  }

  private load(board: Leaderboard, request: number, done: () => void): void {
    const options = Leaderboard.RetrievalOptions.create()
    options.usersLimit = Math.max(1, Math.round(this.fetchLimit))
    options.usersType = Leaderboard.UsersType.Global

    board.getLeaderboardInfo(
      options,
      (others, current) => {
        if (request !== this.request) {
          return
        }
        this.readRecords(others, current)
        done()
      },
      (status) => this.useLocal(request, "getLeaderboardInfo failed, status " + status)
    )
  }

  /**
   * Snap does not document whether ranks count from 0 or 1, or whether the player also appears in
   * the list next to their own record, so both are handled: ranks are shown counting from 1, and
   * the player's row is only added when the list does not already hold it.
   */
  private readRecords(others: Leaderboard.UserRecord[], current?: Leaderboard.UserRecord): void {
    const all = current != null ? others.concat([current]) : others
    const shift = all.some((record) => record.globalExactRank === 0) ? 1 : 0

    this.entries = others.map((record, i) => ({
      rank: record.globalExactRank != null ? record.globalExactRank + shift : i + 1,
      name: nameOf(record),
      score: record.score,
      isPlayer: false
    }))

    this.player = null
    if (current == null) {
      return
    }

    const player: Entry = {
      rank: current.globalExactRank != null ? current.globalExactRank + shift : 0,
      name: "YOU",
      score: current.score,
      isPlayer: true
    }
    this.player = player

    const listed = this.entries.find((entry) => entry.rank === player.rank && entry.score === player.score)
    if (listed !== undefined) {
      listed.name = player.name
      listed.isPlayer = true
    } else if (player.rank > 0) {
      this.entries.push(player)
      this.entries.sort((a, b) => a.rank - b.rank)
    }
  }

  /**
   * Switches to the headset's own board, adding this run to it when it makes the cut - under the
   * last name typed until the player types another.
   */
  private useLocal(request: number, reason: string): void {
    if (request !== this.request) {
      return
    }
    print("GlobalLeaderboard: showing this headset's scores (" + reason + ")")

    const store = global.persistentStorageSystem.store
    const json = store.getString(this.localKey())
    this.saved = json !== "" ? (JSON.parse(json) as SavedScore[]) : []

    // Below any equal score already there, so the older entry keeps its place.
    const limit = Math.max(1, Math.round(this.fetchLimit))
    const below = this.saved.findIndex((entry) => this.runScore > entry.score)
    this.savedIndex = below >= 0 ? below : this.saved.length
    this.naming = this.runScore > 0 && this.savedIndex < limit

    if (this.naming) {
      const last = store.getString(LAST_NAME_KEY)
      this.saved.splice(this.savedIndex, 0, {name: last !== "" ? last : DEFAULT_NAME, score: this.runScore})
      this.saved.length = Math.min(this.saved.length, limit)
      // Kept straight away, so the score survives even if the Lens closes before a name is typed.
      this.saveLocal()
    }

    this.source = Source.Local
    this.entries = this.saved.map((entry, i) => ({
      rank: i + 1,
      name: entry.name,
      score: entry.score,
      isPlayer: this.naming && i === this.savedIndex
    }))
    this.player = this.naming ? this.entries[this.savedIndex] : null
    // Opened on the new entry, so the player can see the name they are typing.
    this.first = this.naming ? Math.max(0, Math.min(this.savedIndex - 2, this.entries.length - this.rowCount())) : 0
    this.setStatus(Status.Ready)

    if (this.naming && this.getSceneObject().enabled) {
      this.openKeyboard()
    }
  }

  private localKey(): string {
    return "scores:" + this.boardName
  }

  private saveLocal(): void {
    global.persistentStorageSystem.store.putString(this.localKey(), JSON.stringify(this.saved))
  }

  private openKeyboard(): void {
    const player = this.player
    if (player === null || this.keyboardOpen) {
      return
    }

    const options = new TextInputSystem.KeyboardOptions()
    options.enablePreview = true
    options.keyboardType = TextInputSystem.KeyboardType.Text
    options.returnKeyType = TextInputSystem.ReturnKeyType.Done
    options.initialText = player.name !== DEFAULT_NAME ? player.name : ""
    options.onTextChanged = (text: string) => {
      player.name = cleanName(text)
      this.render()
    }
    options.onReturnKeyPressed = () => this.finishNaming()
    options.onKeyboardStateChanged = (isOpen: boolean) => {
      if (!isOpen) {
        this.keyboardOpen = false
        this.finishNaming()
      }
    }
    options.onError = (code: number, description: string) => {
      print("GlobalLeaderboard: keyboard error " + code + ", " + description)
      this.keyboardOpen = false
      this.finishNaming()
    }

    this.keyboardOpen = true
    global.textInputSystem.requestKeyboard(options)
  }

  /** Keeps the name as typed - PLAYER if it was cleared - and closes the keyboard. */
  private finishNaming(): void {
    if (!this.naming || this.player === null) {
      return
    }
    this.naming = false

    const name = this.player.name !== "" ? this.player.name : DEFAULT_NAME
    this.player.name = name
    this.saved[this.savedIndex].name = name
    this.saveLocal()
    if (name !== DEFAULT_NAME) {
      global.persistentStorageSystem.store.putString(LAST_NAME_KEY, name)
    }

    if (this.keyboardOpen) {
      this.keyboardOpen = false
      global.textInputSystem.dismissKeyboard()
    }
    this.render()
  }

  private setStatus(status: Status): void {
    this.status = status
    this.render()
  }

  private scroll(direction: number): void {
    const last = Math.max(0, this.entries.length - this.rowCount())
    const step = Math.max(1, Math.round(this.scrollStep))
    this.first = Math.max(0, Math.min(last, this.first + direction * step))
    this.render()
  }

  private rowCount(): number {
    return Math.max(1, Math.round(this.visibleRows))
  }

  private render(): void {
    const scope = this.source === Source.Local ? " LOCAL" : " GLOBAL"
    this.setText(this.titleText, this.boardName + scope + " LEADERBOARD")

    const rank = this.player !== null && this.player.rank > 0 ? "#" + this.player.rank : "--"
    let info = "SCORE " + this.runScore
    if (this.source === Source.Global) {
      info += "   BEST " + (this.player !== null ? this.player.score : "--") + "   RANK " + rank
    } else if (this.player !== null) {
      info += "   RANK " + rank
    }

    let rows = ""
    if (this.status === Status.Loading) {
      rows = "LOADING..."
    } else if (this.entries.length === 0) {
      rows = "NO SCORES YET"
    } else {
      const end = Math.min(this.entries.length, this.first + this.rowCount())
      info += this.naming ? "\nTYPE YOUR NAME, THEN DONE" : "\nRANKS " + (this.first + 1) + "-" + end + " OF " + this.entries.length
      rows = this.entries
        .slice(this.first, end)
        .map((entry) => this.formatRow(entry))
        .join("\n")
    }

    this.setText(this.infoText, info)
    this.setText(this.rowsText, rows)
  }

  private formatRow(entry: Entry): string {
    const marker = entry.isPlayer ? ">" : " "
    const rank = (entry.rank > 0 ? entry.rank + "." : "").padStart(4)
    // One column wider than a name, to fit the cursor while it is being typed.
    const name = (entry.isPlayer && this.naming ? entry.name + "_" : entry.name).padEnd(NAME_WIDTH + 1)
    return marker + rank + " " + name + String(entry.score).padStart(6)
  }

  private setText(text: Text3D | null, value: string): void {
    if (text != null) {
      text.text = value
    }
  }

  /** Cloned first, so the Text3D material the menu's lettering starts from is never recoloured. */
  private paint(text: Text3D | null, face: vec4): void {
    if (text == null) {
      return
    }

    text.mainMaterial = text.mainMaterial.clone()
    const pass = text.mainMaterial.mainPass as any
    pass.frontCapStartingColor = face
    pass.backCapStartingColor = this.edgeColor
    pass.outerEdgeStartingColor = this.edgeColor
    pass.outerEdgeEndingColor = this.edgeColor
    pass.InnerEdgeStartingColor = this.edgeColor
    pass.InnerEdgeEndingColor = this.edgeColor
  }

  private bindButton(button: SceneObject | null, onPress: () => void): void {
    if (button == null) {
      return
    }

    const interactable = button.getComponent(Interactable.getTypeName()) as Interactable
    if (interactable === null) {
      print("GlobalLeaderboard: " + button.name + " has no Interactable, it will not be clickable.")
      return
    }

    interactable.onInteractorTriggerStart.add((_event: InteractorEvent) => onPress())
  }

  /** Missing where leaderboards are not supported, in which case the headset's board is shown. */
  private leaderboardModule(): LeaderboardModule | null {
    if (this.module === null) {
      try {
        this.module = (require("LensStudio:LeaderboardModule") as LeaderboardModule) ?? null
      } catch (error) {
        print("GlobalLeaderboard: " + error)
      }
    }
    return this.module
  }
}
