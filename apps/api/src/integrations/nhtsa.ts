const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

type VpicResponse<T> = { Results?: T[] };

async function vpic<T>(path: string): Promise<T[]> {
  const response = await fetch(`${VPIC_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`nhtsa_request_failed_${response.status}`);
  const data = (await response.json()) as VpicResponse<T>;
  return Array.isArray(data.Results) ? data.Results : [];
}

export type VehicleMake = { id: number; name: string };
export type VehicleModel = { id: number; name: string };
export type DecodedVehicle = {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  displacementLiters: number | null;
  cylinders: number | null;
  fuelType: string | null;
  oilType: string | null;
  oilCapacityQuarts: number | null;
  source: "nhtsa-vpic";
};

export async function listMakes(): Promise<VehicleMake[]> {
  const rows = await vpic<{ MakeId: number; MakeName: string }>("/GetMakesForVehicleType/car?format=json");
  return rows
    .filter((row) => row.MakeId && row.MakeName)
    .map((row) => ({ id: Number(row.MakeId), name: row.MakeName.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listModels(make: string, year: number): Promise<VehicleModel[]> {
  const rows = await vpic<{ Model_ID: number; Model_Name: string }>(
    `/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`,
  );
  const seen = new Set<string>();
  return rows
    .filter((row) => row.Model_ID && row.Model_Name)
    .map((row) => ({ id: Number(row.Model_ID), name: row.Model_Name.trim() }))
    .filter((row) => {
      const key = row.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function value(row: Record<string, unknown>, key: string) {
  const raw = row[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function numeric(row: Record<string, unknown>, key: string) {
  const raw = value(row, key);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export async function decodeVin(vin: string): Promise<DecodedVehicle | null> {
  const rows = await vpic<Record<string, unknown>>(
    `/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
  );
  const row = rows[0];
  if (!row) return null;

  const errorCode = value(row, "ErrorCode");
  if (errorCode && errorCode !== "0") {
    const meaningful = errorCode.split(",").some((code) => !["0", "1", "3", "6", "10"].includes(code.trim()));
    if (meaningful) return null;
  }

  const year = numeric(row, "ModelYear");
  const engineModel = value(row, "EngineModel");
  const displacement = numeric(row, "DisplacementL");
  const cylinders = numeric(row, "EngineCylinders");
  const engine =
    engineModel ??
    (displacement
      ? `${displacement}L${cylinders ? ` ${cylinders}-cyl` : ""}`
      : null);

  return {
    vin,
    year: year ? Math.trunc(year) : null,
    make: value(row, "Make"),
    model: value(row, "Model"),
    trim: value(row, "Trim"),
    engine,
    displacementLiters: displacement,
    cylinders,
    fuelType: value(row, "FuelTypePrimary"),
    oilType: null,
    oilCapacityQuarts: null,
    source: "nhtsa-vpic",
  };
}
