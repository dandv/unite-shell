const Lang        = imports.lang;
const Shell       = imports.gi.Shell;
const Gtk         = imports.gi.Gtk;
const Main        = imports.ui.main;
const Unite       = imports.misc.extensionUtils.getCurrentExtension();
const Base        = Unite.imports.module.BaseModule;
const isWindow    = Unite.imports.helpers.isWindow;
const isMaximized = Unite.imports.helpers.isMaximized;

var ApplicationMenu = new Lang.Class({
  Name: 'Unite.ApplicationMenu',
  Extends: Base,

  _enableKey: 'show-window-title',
  _disableValue: 'never',

  _onInitialize() {
    this._appMenu     = Main.panel.statusArea.appMenu;
    this._gtkSettings = Gtk.Settings.get_default();
    this._winTracker  = Shell.WindowTracker.get_default();
    this._appSystem   = Shell.AppSystem.get_default();
  },

  _onActivate() {
    this._signals.connect(global.display, 'notify::focus-window', 'updateMenu');
    this._signals.connect(global.window_manager, 'size-change', 'updateMenu');

    this._signals.connect(this._gtkSettings, 'notify::gtk-shell-shows-app-menu', 'syncMenu');
    this._signals.connect(Main.overview, 'hiding', 'showMenu');

    this._signals.connect(this._winTracker, 'notify::focus-app', 'showMenu');
    this._signals.connect(this._appSystem, 'app-state-changed', 'showMenu');

    this._syncMenu();
    this._updateMenu();
  },

  _onDeactivate() {
    this._syncMenu();
    this._showMenu();
  },

  _syncMenu() {
    this._appMenuEnabled = this._gtkSettings.gtk_shell_shows_app_menu;
  },

  _showMenu() {
    this._appMenuEnabled ? this._resetMenu() : this._forceShowMenu()
  },

  _resetMenu() {
    if (!this._appMenu._nonSensitive) return;

    this._appMenu.setSensitive(true);
    delete this._appMenu._nonSensitive;
  },

  _forceShowMenu() {
    let visible = this._appMenu._targetApp != null && !Main.overview.visibleTarget;
    if (!visible && this._appMenu._visible) return;

    this._appMenu.show();
    this._appMenu.setSensitive(false);

    this._appMenu._nonSensitive = true;
  },

  _updateMenu() {
    this._activeApp    = this._winTracker.focus_app;
    this._activeWindow = global.display.focus_window;

    if (!isWindow(this._activeWindow)) return;

    if (!this._activeWindow._updateTitleID) {
      let handler = this._activeWindow.connect(
        'notify::title', Lang.bind(this, this._updateTitle)
      );

      this._activeWindow._updateTitleID = handler;
    }

    this._updateTitle();
    this._showMenu();
  },

  _updateTitle() {
    let title     = null;
    let current   = this._appMenu._label.get_text();
    let maximized = isMaximized(this._activeWindow, this._setting);
    let always    = this._setting == 'always' && this._activeWindow;

    if (always || maximized)
      title = this._activeWindow.title;

    if (!title && this._activeApp)
      title = this._activeApp.get_name();

    if (title && title != current)
      this._appMenu._label.set_text(title);
  }
});
