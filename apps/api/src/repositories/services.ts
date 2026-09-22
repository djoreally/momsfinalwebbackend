import { asc, eq } from "drizzle-orm";
import { getDb, services } from "../../../../packages/db/src/index.js";

export async function listActiveServices() {
  return getDb()
    .select()
    .from(services)
    .where(eq(services.active, true))
    .orderBy(asc(services.name));
}

export async function getService(serviceId: string) {
  const [service] = await getDb()
    .select()
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  return service ?? null;
}

export async function getServiceBySlug(slug: string) {
  const [service] = await getDb()
    .select()
    .from(services)
    .where(eq(services.slug, slug))
    .limit(1);
  return service ?? null;
}
