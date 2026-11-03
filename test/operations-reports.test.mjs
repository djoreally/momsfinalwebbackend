import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { resolveReportPeriodRange } = await import(
  "../apps/api/src/domain/report-period.ts"
);

const appSource = readFileSync(
  new URL("../apps/api/src/app.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../apps/api/src/routes/operations-reports.ts", import.meta.url),
  "utf8",
);
const repositorySource = readFileSync(
  new URL("../apps/api/src/repositories/operations-reports.ts", import.meta.url),
  "utf8",
);

test("daily report range uses America/New_York midnight boundaries", () => {
  assert.deepEqual(resolveReportPeriodRange("daily", "2026-11-03"), {
    period: "daily",
    start: "2026-11-03T05:00:00.000Z",
    end: "2026-11-04T05:00:00.000Z",
  });
});

test("daily report range preserves the 25-hour fall-back day", () => {
  assert.deepEqual(resolveReportPeriodRange("daily", "2026-11-01"), {
    period: "daily",
    start: "2026-11-01T04:00:00.000Z",
    end: "2026-11-02T05:00:00.000Z",
  });
});

test("weekly report range is Monday through Sunday in New York", () => {
  const expected = {
    period: "weekly",
    start: "2026-11-02T05:00:00.000Z",
    end: "2026-11-09T05:00:00.000Z",
  };
  assert.deepEqual(resolveReportPeriodRange("weekly", "2026-11-04"), expected);
  assert.deepEqual(resolveReportPeriodRange("weekly", "2026-11-08"), expected);
});

test("weekly report range preserves a daylight-saving transition week", () => {
  assert.deepEqual(resolveReportPeriodRange("weekly", "2026-03-08"), {
    period: "weekly",
    start: "2026-03-02T05:00:00.000Z",
    end: "2026-03-09T04:00:00.000Z",
  });
});

test("monthly report range uses the anchor's calendar month", () => {
  assert.deepEqual(resolveReportPeriodRange("monthly", "2026-12-15"), {
    period: "monthly",
    start: "2026-12-01T05:00:00.000Z",
    end: "2027-01-01T05:00:00.000Z",
  });
});

test("report period rejects malformed and impossible anchor dates", () => {
  assert.equal(resolveReportPeriodRange("daily", "11/03/2026"), null);
  assert.equal(resolveReportPeriodRange("daily", "2026-02-30"), null);
});

test("reports routes are mounted below /v1/operations/reports", () => {
  assert.ok(
    appSource.includes('app.route("/v1/operations/reports", operationsReportRoutes)'),
    "app must mount the operations report routes",
  );
});

test("case study is public-by-registration while summary requires admin session", () => {
  const caseStudyIndex = routeSource.indexOf('get("/case-study"');
  const authIndex = routeSource.indexOf(
    'operationsReportRoutes.use("*", requireAdminSession)',
  );
  const summaryIndex = routeSource.indexOf('get("/summary"');

  assert.ok(caseStudyIndex >= 0, "case-study route must exist");
  assert.ok(authIndex > caseStudyIndex, "case-study must be registered before auth middleware");
  assert.ok(summaryIndex > authIndex, "summary must be registered after auth middleware");
  assert.ok(routeSource.includes('z.enum(["daily", "weekly", "monthly"])'));
});

test("summary SQL follows the scheduled, created, and payment-period definitions", () => {
  for (const fragment of [
    "b.created_at >= ${start}::timestamptz",
    "b.scheduled_start >= ${start}::timestamptz",
    "p.status = 'paid'",
    "p.created_at >= ${start}::timestamptz",
    "p.status = 'due_at_appointment'",
    "MIN(b.created_at) >= ${start}::timestamptz",
    "BOOL_OR(",
    "LIMIT 5",
  ]) {
    assert.ok(repositorySource.includes(fragment), `summary SQL must include ${fragment}`);
  }
});

test("case study SQL is aggregate-only and groups months in New York", () => {
  for (const fragment of [
    "COUNT(DISTINCT b.customer_id)::int",
    "p.status = 'paid'",
    "p.status = 'due_at_appointment'",
    "b.scheduled_start AT TIME ZONE 'America/New_York'",
    "'YYYY-MM'",
  ]) {
    assert.ok(repositorySource.includes(fragment), `case-study SQL must include ${fragment}`);
  }

  for (const forbidden of ["first_name", "last_name", "b.customer_id AS", "p.booking_id AS"]) {
    assert.ok(
      !repositorySource.includes(forbidden),
      `case-study repository must not expose ${forbidden}`,
    );
  }
});
