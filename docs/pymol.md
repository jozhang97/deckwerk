# PyMOL sessions

With a presentation open in the desktop app, click **PyMOL…** in the toolbar
and choose a `.pse` file, or drag the file directly onto the slide. The session is inserted on the current slide as one
resizable, undoable interactive element. Import progress appears in the status
bar; cancelling or an unreadable session leaves the slide unchanged.

While presenting, drag inside the molecule to rotate it and scroll to zoom.
Arrow keys still navigate slides while the molecule has focus.
In the editor, double-click the element (or use **Props → Interact with page**)
to interact; Escape returns to editing. Each newly opened viewer starts from
the session's saved view. Rotations during playback do not edit the source
session or its saved preview.

Molecular transparency is disabled for faster interaction. Structures retain their
colors and representations but render fully opaque.
Rotation and zoom temporarily reduce mesh detail and antialiasing; the saved
detail settings return after interaction stops. Wheel input is combined once
per frame so trackpad gestures do not accumulate a script backlog.

The deck embeds the session and JSmol viewer in one local HTML asset. No network
connection or PyMOL installation is needed, including in a web export. Editor
thumbnails and PDF exports use a still captured during import.

JSmol reads the session; this is not the PyMOL application. Its support for
representations, surfaces, saved views and session versions differs from PyMOL,
so inspect the imported view before presenting. PyMOL commands, plugins and
session editing are not available. Compressed and uncompressed sessions are
supported. Imports are limited to 100 MB (including decompressed data), and sessions
that cannot load within 30 seconds are rejected. The original `.pse` is unchanged.

Viewer distribution and licensing: [JSmol vendor notes](../src/main/vendor/jsmol/README.md).
