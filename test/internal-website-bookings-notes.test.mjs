import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Customer notes flow (Ty, 2026-10-31): Service Writer appointment
// notes contain ONLY what the customer entered on the website booking
// form. The form's notes are stored on moms_ops.bookings.notes; the
// internal website-bookings feed must carry them to Service Writer
// verbatim (string or null, no trimming/transformation here — SW
// trims). Before this fix the feed omitted the field entirely, so
// typed notes never reached Service Writer at all.
//
// The feed query is DB-bound, so the wiring is asserted as a source
// contract, in the style of test/catalog-alignment-euro-switch.test.mjs:
// column provenance (schema + booking creation), then the three points
// of the export path — SQL select, row mapping, route serializer.

const repositorySource = readFileSync(
  new URL("../apps/api/src/repositories/internal-website-bookings.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../apps/api/src/routes/internal-website-bookings.ts", import.meta.url),
  "utf8",
);
const bookingsRepositorySource = readFileSync(
  new URL("../apps/api/src/repositories/bookings.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../packages/db/src/schema.ts", import.meta.url),
  "utf8",
);

test("bookings.notes column exists and the booking form write path stores it", () => {
  // The bookings table declares the column (nullable free-form text).
  const bookingsTable = schemaSource.slice(
    schemaSource.indexOf('export const bookings = momsOps.table('),
    schemaSource.indexOf("export const bookingJobs"),
  );
  assert.ok(bookingsTable.includes('notes: text("notes")'), "bookings table must declare notes");

  // createBooking persists the form's notes into that column.
  assert.ok(
    bookingsRepositorySource.includes("quoted_total_cents,notes"),
    "createBooking INSERT must include the notes column",
  );
  assert.ok(
    bookingsRepositorySource.includes("${input.notes ?? null}"),
    "createBooking must store the caller-provided notes verbatim (or null)",
  );
});

test("internal feed query selects bookings.notes", () => {
  assert.ok(
    repositorySource.includes('b.notes AS "notes"'),
    "listInternalWebsiteBookings must select b.notes",
  );
});

test("internal feed type and row mapping carry notes verbatim", () => {
  assert.ok(
    repositorySource.includes("notes: string | null;"),
    "InternalWebsiteBooking must declare notes: string | null",
  );
  assert.ok(
    repositorySource.includes("notes: (row.notes as string | null) ?? null,"),
    "mapRow must carry row.notes through as string | null",
  );
  // Verbatim means verbatim: no trimming/transformation on this side.
  assert.ok(
    !/row\.notes[^,)]*\.trim\(\)/.test(repositorySource),
    "mapRow must not trim the customer's notes",
  );
});

test("internal feed route serializer emits notes on the booking object", () => {
  assert.ok(
    routeSource.includes("notes: booking.notes,"),
    "GET / serializer must emit notes from the mapped booking",
  );
});
