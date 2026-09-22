import { and, desc, eq } from "drizzle-orm";
import { appointments, getDb } from "@moms/db";

export type CreateAppointmentInput = {
  customerId: string;
  vehicleId: string;
  serviceId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  quotedPriceCents: number;
  notes?: string | null;
};

export async function createAppointment(input: CreateAppointmentInput) {
  const [appointment] = await getDb()
    .insert(appointments)
    .values({ ...input, status: "pending" })
    .returning();
  return appointment;
}

export async function getAppointment(appointmentId: string) {
  const [appointment] = await getDb()
    .select()
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  return appointment ?? null;
}

export async function listCustomerAppointments(customerId: string) {
  return getDb()
    .select()
    .from(appointments)
    .where(and(eq(appointments.customerId, customerId)))
    .orderBy(desc(appointments.scheduledStart));
}
