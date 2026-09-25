import { getVehicleSpecsSql } from "../../../../packages/db/src/index.js";

export type VehicleOilSpec = {
  id: number;
  year: number;
  make: string;
  model: string;
  engine: string;
  engineOil: string | null;
  oilCapacity: string | null;
  oilPlugTorque: string | null;
  oilLifeResetInstructions: string | null;
  wixOilFilter: string | null;
  napaGoldOilFilter: string | null;
  stpOilFilter: string | null;
  sourceDataset: string;
};

const clean = (value: unknown): string => String(value ?? "").trim();
const nullableClean = (value: unknown): string | null => {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized && !/^(unverified|n\/a(?:\s+qts?\.?(?:\s+with\s+filter)?)?)$/i.test(normalized) ? normalized : null;
};

export async function listSpecYears(): Promise<number[]> {
  const rows = await getVehicleSpecsSql()`SELECT DISTINCT year FROM public.motor_oil_specs WHERE year BETWEEN 1999 AND 2027 AND nullif(trim(engine_oil), '') IS NOT NULL AND lower(trim(engine_oil)) NOT IN ('unverified','n/a') AND nullif(trim(oil_capacity), '') IS NOT NULL AND lower(trim(oil_capacity)) NOT LIKE 'unverified%' AND lower(trim(oil_capacity)) NOT LIKE 'n/a%' ORDER BY year DESC`;
  return rows.map((row) => Number(row.year));
}

export async function listSpecMakes(year: number): Promise<string[]> {
  const rows = await getVehicleSpecsSql()`
    SELECT DISTINCT trim(make) AS make FROM public.motor_oil_specs
    WHERE year = ${year} AND nullif(trim(make), '') IS NOT NULL
      AND nullif(trim(engine_oil), '') IS NOT NULL AND lower(trim(engine_oil)) NOT IN ('unverified','n/a')
      AND nullif(trim(oil_capacity), '') IS NOT NULL AND lower(trim(oil_capacity)) NOT LIKE 'unverified%' AND lower(trim(oil_capacity)) NOT LIKE 'n/a%'
    ORDER BY make`;
  return rows.map((row) => clean(row.make));
}

export async function listSpecModels(year: number, make: string): Promise<string[]> {
  const rows = await getVehicleSpecsSql()`
    SELECT DISTINCT trim(model) AS model FROM public.motor_oil_specs
    WHERE year = ${year} AND lower(trim(make)) = lower(trim(${make})) AND nullif(trim(model), '') IS NOT NULL
      AND nullif(trim(engine_oil), '') IS NOT NULL AND lower(trim(engine_oil)) NOT IN ('unverified','n/a')
      AND nullif(trim(oil_capacity), '') IS NOT NULL AND lower(trim(oil_capacity)) NOT LIKE 'unverified%' AND lower(trim(oil_capacity)) NOT LIKE 'n/a%'
    ORDER BY model`;
  return rows.map((row) => clean(row.model));
}

export async function listSpecEngines(year: number, make: string, model: string): Promise<string[]> {
  const rows = await getVehicleSpecsSql()`
    SELECT DISTINCT trim(engine) AS engine FROM public.motor_oil_specs
    WHERE year = ${year}
      AND lower(trim(make)) = lower(trim(${make}))
      AND lower(trim(model)) = lower(trim(${model}))
      AND nullif(trim(engine), '') IS NOT NULL
      AND nullif(trim(engine_oil), '') IS NOT NULL AND lower(trim(engine_oil)) NOT IN ('unverified','n/a')
      AND nullif(trim(oil_capacity), '') IS NOT NULL AND lower(trim(oil_capacity)) NOT LIKE 'unverified%' AND lower(trim(oil_capacity)) NOT LIKE 'n/a%'
    ORDER BY engine`;
  return rows.map((row) => clean(row.engine));
}

export async function resolveVehicleSpec(year: number, make: string, model: string, engine: string): Promise<VehicleOilSpec | null> {
  const rows = await getVehicleSpecsSql()`
    SELECT id, year, make, model, engine, engine_oil, oil_capacity, oil_plug_torque,
           oil_life_reset_instructions, wix_oil_filter, napa_gold_oil_filter, stp_oil_filter, source_dataset
    FROM public.motor_oil_specs
    WHERE year = ${year}
      AND lower(trim(make)) = lower(trim(${make}))
      AND lower(trim(model)) = lower(trim(${model}))
      AND lower(trim(engine)) = lower(trim(${engine}))
    ORDER BY id DESC LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id), year: Number(row.year), make: clean(row.make), model: clean(row.model), engine: clean(row.engine),
    engineOil: nullableClean(row.engine_oil),
    oilCapacity: nullableClean(row.oil_capacity),
    oilPlugTorque: nullableClean(row.oil_plug_torque),
    oilLifeResetInstructions: nullableClean(row.oil_life_reset_instructions),
    wixOilFilter: nullableClean(row.wix_oil_filter),
    napaGoldOilFilter: nullableClean(row.napa_gold_oil_filter),
    stpOilFilter: nullableClean(row.stp_oil_filter),
    sourceDataset: clean(row.source_dataset),
  };
}
