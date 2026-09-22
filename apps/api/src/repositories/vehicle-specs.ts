import { getVehicleSpecsSql } from "../../../packages/db/src/index.js";

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

export async function listSpecYears(): Promise<number[]> {
  const rows = await getVehicleSpecsSql()`SELECT DISTINCT year FROM public.motor_oil_specs ORDER BY year DESC`;
  return rows.map((row) => Number(row.year));
}

export async function listSpecMakes(year: number): Promise<string[]> {
  const rows = await getVehicleSpecsSql()`SELECT DISTINCT make FROM public.motor_oil_specs WHERE year = ${year} ORDER BY make`;
  return rows.map((row) => String(row.make));
}

export async function listSpecModels(year: number, make: string): Promise<string[]> {
  const rows = await getVehicleSpecsSql()`SELECT DISTINCT model FROM public.motor_oil_specs WHERE year = ${year} AND lower(make) = lower(${make}) ORDER BY model`;
  return rows.map((row) => String(row.model));
}

export async function listSpecEngines(year: number, make: string, model: string): Promise<string[]> {
  const rows = await getVehicleSpecsSql()`SELECT DISTINCT engine FROM public.motor_oil_specs WHERE year = ${year} AND lower(make) = lower(${make}) AND lower(model) = lower(${model}) ORDER BY engine`;
  return rows.map((row) => String(row.engine));
}

export async function resolveVehicleSpec(year: number, make: string, model: string, engine: string): Promise<VehicleOilSpec | null> {
  const rows = await getVehicleSpecsSql()`
    SELECT id, year, make, model, engine, engine_oil, oil_capacity, oil_plug_torque,
           oil_life_reset_instructions, wix_oil_filter, napa_gold_oil_filter, stp_oil_filter, source_dataset
    FROM public.motor_oil_specs
    WHERE year = ${year} AND lower(make) = lower(${make}) AND lower(model) = lower(${model}) AND lower(engine) = lower(${engine})
    ORDER BY id DESC LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id), year: Number(row.year), make: String(row.make), model: String(row.model), engine: String(row.engine),
    engineOil: row.engine_oil == null ? null : String(row.engine_oil),
    oilCapacity: row.oil_capacity == null ? null : String(row.oil_capacity),
    oilPlugTorque: row.oil_plug_torque == null ? null : String(row.oil_plug_torque),
    oilLifeResetInstructions: row.oil_life_reset_instructions == null ? null : String(row.oil_life_reset_instructions),
    wixOilFilter: row.wix_oil_filter == null ? null : String(row.wix_oil_filter),
    napaGoldOilFilter: row.napa_gold_oil_filter == null ? null : String(row.napa_gold_oil_filter),
    stpOilFilter: row.stp_oil_filter == null ? null : String(row.stp_oil_filter),
    sourceDataset: String(row.source_dataset),
  };
}
