// Configured barcode lengths/format used to drive the auto-fetch / auto-place scanner UX.
// TODO: Align these with the real hardware scanner's barcode format once known.
export const HU_BARCODE_MAX_LENGTH = 12;
export const BIN_BARCODE_MAX_LENGTH = 8;
export const BATCH_BARCODE_MAX_LENGTH = 10;
export const BARCODE_MIN_LENGTH = 4;
export const BARCODE_PATTERN = /^[A-Za-z0-9-]+$/;

// Bin Location values are often typed by hand rather than scanned (see
// PutawayPage.js), and can be as short as a single digit (e.g. "1", "2", "3"), so
// Bin uses its own, much lower minimum instead of BARCODE_MIN_LENGTH.
export const BIN_MIN_LENGTH = 1;
