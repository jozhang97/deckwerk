`dna.pse` is the PyMOL DNA demonstration session distributed by the Jmol
project: https://chemapps.stolaf.edu/jmol/jsmol/data/dna.pse
Downloaded 2026-10-01. Used to exercise the real PSE reader, molecular renderer,
and pointer interaction, without a PyMOL installation or network access.

`dna-compressed.pse` contains the same public DNA session, wrapped with
Python 3 `pickle.dumps(zlib.compress(data), protocol=1)` to match compressed
PyMOL saves. No private user sessions are included in these fixtures.

`cartoon-opacity.pse` is a synthetic pair of 20-residue peptides generated
locally with PyMOL 3.1.6.1 (`fab ACDEFGHIKLMNPQRSTVWY`). Both use cartoons only;
the blue peptide is opaque, the red peptide is 65% transparent except for its
first five opaque residues. It checks that saved representations survive import
while both object-level and per-atom transparency render opaque for performance.
It contains no user data.
