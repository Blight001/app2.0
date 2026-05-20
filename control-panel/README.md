# control-panel

This folder now has a simple split:

- `index.html` is the entry page served at `/control-panel/`
- `client/app/` contains shared browser controllers and styles reused by the panel
- `client/scripts/` contains the panel-specific browser scripts
- `client/styles/` contains the panel-specific CSS
- `server/` contains the local static server and its JSON config
- `run-control-panel.bat` starts the local server on Windows

The UI still works from the same URL, but the responsibilities are no longer mixed at the top level.
