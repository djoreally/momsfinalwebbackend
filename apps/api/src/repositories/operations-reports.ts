import { getSql } from "../../../../packages/db/src/index.js";
import type {
  ReportPeriodRange,
  ReportPeriod,
} from "../domain/report-period.js";

export interface ReportServiceCount {
  name: string;
  count: number;
}

export interface OperationsReportSummary {
  period: ReportPeriod;
  start: string;
  end: string;
  bookingsCreated: number;
  bookingsScheduled: number;
  jobsCount: number;
  quotedCents: number;
  collectedCents: number;
  dueCents: number;
  averageQuotedCents: number;
  topServices: ReportServiceCount[];
  newCustomers: number;
  repeatCustomers: number;
}

export interface OperationsReportMonth {
  month: string;
  bookings: number;
  quotedCents: number;
}

export interface OperationsCaseStudy {
  from: string | null;
  bookings: number;
  jobs: number;
  customers: number;
  repeatCustomers: number;
  quotedCents: number;
  collectedCents: number;
  prepaidCount: number;
  payAtAppointmentCount: number;
  averageQuotedCents: number;
  topServices: ReportServiceCount[];
  byMonth: OperationsReportMonth[];
}

type NumericValue = number | string | null | undefined;

interface SummaryAggregateRow {
  bookingsCreated: NumericValue;
  bookingsScheduled: NumericValue;
  jobsCount: NumericValue;
  quotedCents: NumericValue;
  collectedCents: NumericValue;
  dueCents: NumericValue;
  newCustomers: NumericValue;
  repeatCustomers: NumericValue;
}

interface CaseStudyAggregateRow {
  from: string | null;
  bookings: NumericValue;
  jobs: NumericValue;
  customers: NumericValue;
  repeatCustomers: NumericValue;
  quotedCents: NumericValue;
  collectedCents: NumericValue;
  prepaidCount: NumericValue;
  payAtAppointmentCount: NumericValue;
}

interface ServiceCountRow {
  name: string;
  count: NumericValue;
}

interface MonthRow {
  month: string;
  bookings: NumericValue;
  quotedCents: NumericValue;
}

function asCount(value: NumericValue): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function averageCents(totalCents: number, count: number): number {
  return count > 0 ? Math.round(totalCents / count) : 0;
}

function mapTopServices(rows: ServiceCountRow[]): ReportServiceCount[] {
  return rows.map((row) => ({ name: row.name, count: asCount(row.count) }));
}

export async function getOperationsReportSummary(
  range: ReportPeriodRange,
): Promise<OperationsReportSummary> {
  const sql = getSql();
  const start = range.start;
  const end = range.end;

  const aggregateRows = (await sql`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM moms_ops.bookings b
        WHERE b.created_at >= ${start}::timestamptz
          AND b.created_at < ${end}::timestamptz
      ) AS "bookingsCreated",
      (
        SELECT COUNT(*)::int
        FROM moms_ops.bookings b
        WHERE b.scheduled_start >= ${start}::timestamptz
          AND b.scheduled_start < ${end}::timestamptz
      ) AS "bookingsScheduled",
      (
        SELECT COUNT(*)::int
        FROM moms_ops.booking_jobs bj
        JOIN moms_ops.bookings b ON b.id = bj.booking_id
        WHERE b.scheduled_start >= ${start}::timestamptz
          AND b.scheduled_start < ${end}::timestamptz
      ) AS "jobsCount",
      (
        SELECT COALESCE(SUM(b.quoted_total_cents), 0)::int
        FROM moms_ops.bookings b
        WHERE b.scheduled_start >= ${start}::timestamptz
          AND b.scheduled_start < ${end}::timestamptz
      ) AS "quotedCents",
      (
        SELECT COALESCE(SUM(p.amount_cents), 0)::int
        FROM moms_ops.payments p
        WHERE p.status = 'paid'
          AND p.created_at >= ${start}::timestamptz
          AND p.created_at < ${end}::timestamptz
      ) AS "collectedCents",
      (
        SELECT COALESCE(SUM(p.amount_cents), 0)::int
        FROM moms_ops.payments p
        JOIN moms_ops.bookings b ON b.id = p.booking_id
        WHERE p.status = 'due_at_appointment'
          AND b.scheduled_start >= ${start}::timestamptz
          AND b.scheduled_start < ${end}::timestamptz
      ) AS "dueCents",
      (
        SELECT COUNT(*)::int
        FROM (
          SELECT b.customer_id
          FROM moms_ops.bookings b
          GROUP BY b.customer_id
          HAVING MIN(b.created_at) >= ${start}::timestamptz
            AND MIN(b.created_at) < ${end}::timestamptz
        ) AS first_bookings
      ) AS "newCustomers",
      (
        SELECT COUNT(*)::int
        FROM (
          SELECT b.customer_id
          FROM moms_ops.bookings b
          GROUP BY b.customer_id
          HAVING COUNT(*) > 1
            AND BOOL_OR(
              b.scheduled_start >= ${start}::timestamptz
              AND b.scheduled_start < ${end}::timestamptz
            )
        ) AS repeat_bookings
      ) AS "repeatCustomers"
  `) as SummaryAggregateRow[];

  const topServiceRows = (await sql`
    SELECT s.name AS "name", COUNT(*)::int AS "count"
    FROM moms_ops.booking_jobs bj
    JOIN moms_ops.bookings b ON b.id = bj.booking_id
    JOIN moms_ops.services s ON s.id = bj.service_id
    WHERE b.scheduled_start >= ${start}::timestamptz
      AND b.scheduled_start < ${end}::timestamptz
    GROUP BY s.name
    ORDER BY COUNT(*) DESC, s.name ASC
    LIMIT 5
  `) as ServiceCountRow[];

  const aggregate = aggregateRows[0];
  const bookingsScheduled = asCount(aggregate?.bookingsScheduled);
  const quotedCents = asCount(aggregate?.quotedCents);

  return {
    period: range.period,
    start: range.start,
    end: range.end,
    bookingsCreated: asCount(aggregate?.bookingsCreated),
    bookingsScheduled,
    jobsCount: asCount(aggregate?.jobsCount),
    quotedCents,
    collectedCents: asCount(aggregate?.collectedCents),
    dueCents: asCount(aggregate?.dueCents),
    averageQuotedCents: averageCents(quotedCents, bookingsScheduled),
    topServices: mapTopServices(topServiceRows),
    newCustomers: asCount(aggregate?.newCustomers),
    repeatCustomers: asCount(aggregate?.repeatCustomers),
  };
}

export async function getOperationsCaseStudy(): Promise<OperationsCaseStudy> {
  const sql = getSql();

  const aggregateRows = (await sql`
    SELECT
      (
        SELECT TO_CHAR(
          (MIN(b.scheduled_start) AT TIME ZONE 'UTC'),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
        FROM moms_ops.bookings b
      ) AS "from",
      (SELECT COUNT(*)::int FROM moms_ops.bookings b) AS "bookings",
      (SELECT COUNT(*)::int FROM moms_ops.booking_jobs bj) AS "jobs",
      (
        SELECT COUNT(DISTINCT b.customer_id)::int
        FROM moms_ops.bookings b
      ) AS "customers",
      (
        SELECT COUNT(*)::int
        FROM (
          SELECT b.customer_id
          FROM moms_ops.bookings b
          GROUP BY b.customer_id
          HAVING COUNT(*) > 1
        ) AS repeat_bookings
      ) AS "repeatCustomers",
      (
        SELECT COALESCE(SUM(b.quoted_total_cents), 0)::int
        FROM moms_ops.bookings b
      ) AS "quotedCents",
      (
        SELECT COALESCE(SUM(p.amount_cents), 0)::int
        FROM moms_ops.payments p
        WHERE p.status = 'paid'
      ) AS "collectedCents",
      (
        SELECT COUNT(*)::int
        FROM moms_ops.payments p
        WHERE p.status = 'paid'
      ) AS "prepaidCount",
      (
        SELECT COUNT(*)::int
        FROM moms_ops.payments p
        WHERE p.status = 'due_at_appointment'
      ) AS "payAtAppointmentCount"
  `) as CaseStudyAggregateRow[];

  const topServiceRows = (await sql`
    SELECT s.name AS "name", COUNT(*)::int AS "count"
    FROM moms_ops.booking_jobs bj
    JOIN moms_ops.services s ON s.id = bj.service_id
    GROUP BY s.name
    ORDER BY COUNT(*) DESC, s.name ASC
    LIMIT 5
  `) as ServiceCountRow[];

  const monthRows = (await sql`
    SELECT
      TO_CHAR(
        (b.scheduled_start AT TIME ZONE 'America/New_York'),
        'YYYY-MM'
      ) AS "month",
      COUNT(*)::int AS "bookings",
      COALESCE(SUM(b.quoted_total_cents), 0)::int AS "quotedCents"
    FROM moms_ops.bookings b
    GROUP BY TO_CHAR(
      (b.scheduled_start AT TIME ZONE 'America/New_York'),
      'YYYY-MM'
    )
    ORDER BY TO_CHAR(
      (b.scheduled_start AT TIME ZONE 'America/New_York'),
      'YYYY-MM'
    ) ASC
  `) as MonthRow[];

  const aggregate = aggregateRows[0];
  const bookings = asCount(aggregate?.bookings);
  const quotedCents = asCount(aggregate?.quotedCents);

  return {
    from: aggregate?.from ?? null,
    bookings,
    jobs: asCount(aggregate?.jobs),
    customers: asCount(aggregate?.customers),
    repeatCustomers: asCount(aggregate?.repeatCustomers),
    quotedCents,
    collectedCents: asCount(aggregate?.collectedCents),
    prepaidCount: asCount(aggregate?.prepaidCount),
    payAtAppointmentCount: asCount(aggregate?.payAtAppointmentCount),
    averageQuotedCents: averageCents(quotedCents, bookings),
    topServices: mapTopServices(topServiceRows),
    byMonth: monthRows.map((row) => ({
      month: row.month,
      bookings: asCount(row.bookings),
      quotedCents: asCount(row.quotedCents),
    })),
  };
}
