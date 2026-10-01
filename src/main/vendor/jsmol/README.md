JSmol 16.4.23 (Jmol HTML5), distribution dated 2026-08-28, downloaded 2026-10-01.

`runtime.json` contains unmodified JavaScript files from
https://chemapps.stolaf.edu/jmol/jsmol/ keyed by their distribution paths.
It includes the minified entry point, core modules (excluding JSpecView and
Swing), translation PO support, JmolSelectionListener, and BioMeshRenderer (required
for protein cartoons rendered as meshes), with its MeshRenderer and Mesh dependencies.

Jmol is licensed under LGPL 2.1 or later; see LICENSE.txt. Source:
https://github.com/BobHanson/Jmol-SwingJS
Java2Script source: https://github.com/java2script/java2script
The entry point also includes jQuery, whose license notice is retained.

The loader in ../../pymolPage.ts serves these files from memory without
changing the vendor files. `../../pymolRuntime.ts` applies checked compatibility
fixes: mark the data as a PyMOL session so the generic large-PDB preset cannot
overwrite its representations, and disable molecular transparency to avoid the
software renderer's expensive second pass. Review these checked patches when
updating the pinned JSmol distribution.
Each generated page carries the runtime, session bytes and license, so exported
presentations run offline with no PyMOL installation.
