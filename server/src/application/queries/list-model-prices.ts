import type { ModelPricesResponse } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';

/** API-AC-37: the model price list, marked as mock data. */
export function listModelPrices(snapshots: SnapshotReader) {
  return snapshots.read(async (q): Promise<ModelPricesResponse> => ({
    items: await q.modelPrices(),
    dataSource: 'mock',
  }));
}
