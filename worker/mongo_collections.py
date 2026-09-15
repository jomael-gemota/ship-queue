"""MongoDB collection names shared with the Ship Queue server.

The server writes these collections through Mongoose, which would otherwise
pluralise the model name into something this worker cannot derive
(``DocTidyParseJob`` becomes ``doctidyparsejobs``). Both sides therefore pin the
names explicitly: change one and you must change the matching ``collection``
option in ``src/models/DocTidy*.ts``.

Named ``mongo_collections`` rather than ``collections`` because the worker's own
directory leads ``sys.path``, so the shorter name would shadow the standard
library module of that name for every import in the process.
"""

from __future__ import annotations

PARSE_JOBS = "doctidy_parse_jobs"
CORRECTIONS = "doctidy_corrections"
VENDORS = "doctidy_vendors"

#: GridFS bucket holding PDFs the server mirrored out of Google Drive.
PDF_BUCKET = "doctidy_pdfs"
