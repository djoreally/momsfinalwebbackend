import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Email required to book (Ty, 2026-10-30). reserveBooking rejects a
// booking whose customer has no email, or a malformed one, before any
// pricing or slot work. The gate is the pure validator below; the
// wiring into reserveBooking is asserted as a source contract, in the
// style of test/booking-email-contract.test.mjs.
const { requireCustomerEmailForBooking, BookingValidationError } = await import(
  "../apps/api/src/domain/booking-validation.ts"
);

test("booking without an email is rejected as customer_email_required", () => {
  for (const missing of [null, undefined, "", "   "]) {
    assert.throws(
      () => requireCustomerEmailForBooking(missing),
      (error) => {
        assert.ok(error instanceof BookingValidationError);
        assert.equal(error.message, "customer_email_required");
        return true;
      },
    );
  }
});

test("booking with a malformed email is rejected as customer_email_invalid", () => {
  const malformed = [
    "not-an-email",
    "missing@tld",
    "two@@example.com",
    "sp ace@example.com",
    "@example.com",
    "customer@.com",
    "customer@example.",
    "a".repeat(245) + "@example.com",
  ];
  for (const bad of malformed) {
    assert.throws(
      () => requireCustomerEmailForBooking(bad),
      (error) => {
        assert.ok(error instanceof BookingValidationError);
        assert.equal(error.message, "customer_email_invalid");
        return true;
      },
      `expected ${bad} to be rejected`,
    );
  }
});

test("booking with a well-formed email passes and is trimmed", () => {
  assert.equal(
    requireCustomerEmailForBooking("lbuckman@athenaglobaladvisors.com"),
    "lbuckman@athenaglobaladvisors.com",
  );
  assert.equal(requireCustomerEmailForBooking("  Ty@Example.COM "), "Ty@Example.COM");
});

test("wiring contract: reserveBooking applies the gate to the booking's customer", () => {
  const domain = readFileSync(new URL("../apps/api/src/domain/bookings.ts", import.meta.url), "utf8");
  assert.match(domain, /requireCustomerEmailForBooking\(customer\?\.email\)/);
  assert.match(domain, /getCustomer\(input\.customerId\)/);
});
