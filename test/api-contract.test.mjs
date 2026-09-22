import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.MOMS_API_SMOKE_URL || "http://localhost:3000";

async function json(path, init) {
  const response = await fetch(base + path, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

test("health route responds", async () => {
  const { response } = await json("/health");
  assert.equal(response.status, 200);
});

test("services expose server prices", async () => {
  const { response, body } = await json("/v1/services");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body?.services) && body.services.length);
  for (const service of body.services) {
    assert.ok(Number.isSafeInteger(service.basePriceCents));
    assert.ok(service.basePriceCents >= 0);
  }
});

test("vehicle years are server generated", async () => {
  const { response, body } = await json("/v1/vehicles/years");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body?.years));
  assert.ok(body.years.includes(new Date().getFullYear()));
});

test("invalid VIN is rejected before provider work", async () => {
  const { response } = await json("/v1/vehicles/decode-vin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vin: "BAD" }),
  });
  assert.equal(response.status, 400);
});

test("invalid pricing UUID fails closed", async () => {
  const { response } = await json("/v1/pricing/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serviceId: "not-a-uuid", oilCapacityQuarts: -1 }),
  });
  assert.equal(response.status, 400);
});

test("unknown route is 404", async () => {
  const { response } = await json("/v1/__definitely_not_a_route__");
  assert.equal(response.status, 404);
});
