import { asc } from 'drizzle-orm';
import type { ModelPrice } from '@agent-ops/shared';
import { modelPrices } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { priceToDomain } from '../repositories/mappers.js';

/** The model price list, ordered by model name. `numeric` columns are converted only here. */
export async function listModelPrices(q: Tx): Promise<ModelPrice[]> {
  const rows = await q.select().from(modelPrices).orderBy(asc(modelPrices.model));
  return rows.map(priceToDomain);
}
