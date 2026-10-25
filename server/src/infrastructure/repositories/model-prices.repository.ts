import { asc, eq } from 'drizzle-orm';
import type { ModelPrice } from '@agent-ops/shared';
import type { ModelPriceRepository } from '../../application/ports/repositories.js';
import type { Db } from '../db/client.js';
import { modelPrices } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { priceToDomain } from './mappers.js';

/** Read-only model price list. */
export class ModelPricesRepository implements ModelPriceRepository {
  constructor(private readonly q: Db | Tx) {}

  async get(model: string): Promise<ModelPrice | null> {
    const [r] = await this.q
      .select()
      .from(modelPrices)
      .where(eq(modelPrices.model, model))
      .limit(1);
    return r === undefined ? null : priceToDomain(r);
  }

  async list(): Promise<ModelPrice[]> {
    const rows = await this.q.select().from(modelPrices).orderBy(asc(modelPrices.model));
    return rows.map(priceToDomain);
  }
}

export const createModelPriceRepository = (q: Db | Tx): ModelPriceRepository =>
  new ModelPricesRepository(q);
