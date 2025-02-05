const Bytes    = imports.byteArray
const GLib     = imports.gi.GLib
const GObject  = imports.gi.GObject
const Meta     = imports.gi.Meta
const Main     = imports.ui.main
const Util     = imports.misc.util
const Unite    = imports.misc.extensionUtils.getCurrentExtension()
const AppMenu  = Main.panel.statusArea.appMenu
const Handlers = Unite.imports.handlers

const VALID_TYPES = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
  Meta.WindowType.UTILITY
]

const UNITE_HINTS = '_UNITE_ORIGINAL_STATE'
const MOTIF_HINTS = '_MOTIF_WM_HINTS'

const _SHOW_FLAGS = ['0x2', '0x0', '0x1', '0x0', '0x0']
const _HIDE_FLAGS = ['0x2', '0x0', '0x2', '0x0', '0x0']

function isValid(win) {
  return win && VALID_TYPES.includes(win.window_type)
}

function getXid(win) {
  const desc  = win.get_description()
  const match = desc && desc.match(/0x[0-9a-f]+/)

  return match && match[0]
}

function getHint(xid, name, fallback) {
  const result = GLib.spawn_command_line_sync(`xprop -id ${xid} ${name}`)
  const string = Bytes.toString(result[1])

  if (!string.match(/=/)) {
    return fallback
  }

  return string.split('=')[1].trim().split(',').map(part => {
    part = part.trim()
    return part.match(/\dx/) ? part : `0x${part}`
  })
}

function setHint(xid, hint, value) {
  value = value.join(', ')
  Util.spawn(['xprop', '-id', xid, '-f', hint, '32c', '-set', hint, value])
}

function getHints(xid) {
  let value = getHint(xid, UNITE_HINTS)

  if (!value) {
    value = getHint(xid, MOTIF_HINTS, _SHOW_FLAGS)
    setHint(xid, UNITE_HINTS, value)
  }

  return value
}

function isDecorated(hints) {
  return hints[2] != '0x2' && hints[2] != '0x0'
}

var ClientDecorations = class ClientDecorations {
  constructor(xid) {
    this.xid = xid
  }

  show() {
    return false
  }

  hide() {
    return false
  }

  reset() {
    return false
  }
}

var ServerDecorations = class ServerDecorations {
  constructor(xid) {
    this.xid     = xid
    this.initial = getHints(xid)
    this.current = this.initial
  }

  get decorated() {
    return isDecorated(this.current)
  }

  get handle() {
    return isDecorated(this.initial)
  }

  show() {
    if (this.handle && !this.decorated) {
      this.current = _SHOW_FLAGS
      setHint(this.xid, MOTIF_HINTS, _SHOW_FLAGS)
    }
  }

  hide() {
    if (this.handle && this.decorated) {
      this.current = _HIDE_FLAGS
      setHint(this.xid, MOTIF_HINTS, _HIDE_FLAGS)
    }
  }

  reset() {
    if (this.handle) {
      setHint(this.xid, MOTIF_HINTS, this.initial)
    }
  }
}

var MetaWindow = GObject.registerClass({
  Signals: {
    'title-changed': {},
    'state-changed': {}
  }
}, class UniteMetaWindow extends GObject.Object {
    _init(win) {
      win._uniteShellManaged = true

      this.win = win
      this.xid = getXid(win)

      this.signals  = new Handlers.Signals()
      this.settings = new Handlers.Settings()

      if (this.xid && !this.clientDecorated) {
        this.decorations = new ServerDecorations(this.xid)
      } else {
        this.decorations = new ClientDecorations(this.xid)
      }

      this.signals.connect(
        win, 'size-changed', this._onStateChanged.bind(this)
      )

      this.signals.connect(
        win, 'notify::title', this._onTitleChanged.bind(this)
      )

      this.settings.connect(
        'restrict-to-primary-screen', this.syncComponents.bind(this)
      )

      this.settings.connect(
        'hide-window-titlebars', this.syncDecorations.bind(this)
      )

      this.settings.connect(
        'show-window-buttons', this.syncControls.bind(this)
      )

      this.settings.connect(
        'show-window-title', this.syncAppmenu.bind(this)
      )

      this.syncComponents()
    }

    get hasFocus() {
      return this.win.has_focus()
    }

    get title() {
      if (this.showTitle) {
        return this.win.get_title()
      } else {
        return AppMenu._targetApp.get_name()
      }
    }

    get clientDecorated() {
      return this.win.is_client_decorated()
    }

    get primaryScreen() {
      return this.win.is_on_primary_monitor()
    }

    get minimized() {
      return this.win.minimized
    }

    get maximized() {
      return this.win.maximized_horizontally && this.win.maximized_vertically
    }

    get tiled() {
      if (this.maximized) {
        return false
      } else {
        return this.win.maximized_horizontally || this.win.maximized_vertically
      }
    }

    get bothMaximized() {
      return this.maximized || this.tiled
    }

    get restrictToPrimary() {
      return this.settings.get('restrict-to-primary-screen')
    }

    get handleScreen() {
      return this.primaryScreen || !this.restrictToPrimary
    }

    get showTitle() {
      return this._parseEnumSetting('show-window-title')
    }

    get showButtons() {
      return this._parseEnumSetting('show-window-buttons')
    }

    get hideTitlebars() {
      return this._parseEnumSetting('hide-window-titlebars')
    }

    minimize() {
      if (this.minimized) {
        this.win.unminimize()
      } else {
        this.win.minimize()
      }
    }

    maximize() {
      if (this.maximized) {
        this.win.unmaximize(Meta.MaximizeFlags.BOTH)
      } else {
        this.win.maximize(Meta.MaximizeFlags.BOTH)
      }
    }

    close() {
      const time = global.get_current_time()
      time && this.win.delete(time)
    }

    syncDecorations() {
      if (this.hideTitlebars) {
        this.decorations.hide()
      } else {
        this.decorations.show()
      }
    }

    syncControls() {
      if (this.hasFocus) {
        const controls = Main.panel.statusArea.uniteWindowControls
        controls && controls.setVisible(this.showButtons)
      }
    }

    syncAppmenu() {
      if (this.hasFocus) {
        const current = AppMenu._label.get_text()
        current != this.title && AppMenu._label.set_text(this.title)
      }
    }

    syncComponents() {
      this.syncDecorations()
      this.syncControls()
      this.syncAppmenu()
    }

    _parseEnumSetting(name) {
      switch (this.settings.get(name)) {
        case 'always':    return true
        case 'never':     return false
        case 'tiled':     return this.handleScreen && this.tiled
        case 'maximized': return this.handleScreen && this.maximized
        case 'both':      return this.handleScreen && this.bothMaximized
      }
    }

    _onStateChanged() {
      this.syncComponents()
      this.emit('state-changed')
    }

    _onTitleChanged() {
      this.syncAppmenu()
      this.emit('title-changed')
    }

    destroy() {
      this.decorations.reset()

      this.signals.disconnectAll()
      this.settings.disconnectAll()

      this.win._uniteShellManaged = false
    }
  }
)

var WindowManager = GObject.registerClass({
  Signals: {
    'focus-changed': {}
  }
}, class UniteWindowManager extends GObject.Object {
    _init() {
      this.windows  = new Map()
      this.signals  = new Handlers.Signals()
      this.settings = new Handlers.Settings()
      this.styles   = new Handlers.Styles()

      this.signals.connect(
        global.window_manager, 'map', this._onMapWindow.bind(this)
      )

      this.signals.connect(
        global.window_manager, 'destroy', this._onDestroyWindow.bind(this)
      )

      this.signals.connect(
        global.display, 'notify::focus-window', this._onFocusWindow.bind(this)
      )

      this.signals.connect(
        global.display, 'window-demands-attention', this._onAttention.bind(this)
      )

      this.signals.connect(
        AppMenu._label, 'notify::text', this._onAppmenuChanged.bind(this)
      )

      this.settings.connect(
        'hide-window-titlebars', this._onStylesChange.bind(this)
      )

      this.settings.connect(
        'window-buttons-position', this._onStylesChange.bind(this)
      )
    }

    get focusWindow() {
      const win = global.display.get_focus_window()
      return this.getWindow(win)
    }

    get hideTitlebars() {
      return this.settings.get('hide-window-titlebars')
    }

    hasWindow(win) {
      return win && this.windows.has(`${win}`)
    }

    getWindow(win) {
      return win && this.windows.get(`${win}`)
    }

    setWindow(win) {
      if (!this.hasWindow(win)) {
        const meta = new MetaWindow(win)
        this.windows.set(`${win}`, meta)
      }
    }

    deleteWindow(win) {
      if (this.hasWindow(win)) {
        const meta = this.getWindow(win)
        meta.destroy()

        this.windows.delete(`${win}`)
      }
    }

    clearWindows() {
      for (const key of this.windows.keys()) {
        this.deleteWindow(key)
      }
    }

    _onMapWindow(shellwm, { meta_window }) {
      if (isValid(meta_window)) {
        this.setWindow(meta_window)
      }
    }

    _onDestroyWindow(shellwm, { meta_window }) {
      if (isValid(meta_window)) {
        this.deleteWindow(meta_window)
      }
    }

    _onFocusWindow(display) {
      if (this.focusWindow) {
        this.focusWindow.syncComponents()
      }

      this.emit('focus-changed')
    }

    _onAppmenuChanged() {
      const focused = this.focusWindow
      const current = AppMenu._label.get_text()

      if (focused && current != focused.title) {
        AppMenu._label.set_text(focused.title)
      }
    }

    _onAttention(actor, win) {
      const auto = this.settings.get('autofocus-windows')
      const time = global.get_current_time()

      auto && Main.activateWindow(win, time)
    }

    _onStylesChange() {
      if (this.hideTitlebars != 'never') {
        const variant = this.settings.get('window-buttons-position')
        const folder  = `${Unite.path}/styles/buttons-${variant}`
        const content = `@import url('${folder}/${this.hideTitlebars}.css');\n`

        this.styles.addGtkStyle('windowDecorations', content)
      } else {
        this.styles.deleteStyle('windowDecorations')
      }
    }

    activate() {
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        const actors = global.get_window_actors()
        actors.forEach(actor => this._onMapWindow(null, actor))
      })

      this._onStylesChange()
    }

    destroy() {
      this.clearWindows()

      this.signals.disconnectAll()
      this.settings.disconnectAll()
      this.styles.removeAll()
    }
  }
)
