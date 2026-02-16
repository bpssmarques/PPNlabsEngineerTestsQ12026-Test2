import {PayoutRepo, PayoutRequestRow, PayoutStatus} from "../db/repo";

function mapToGraphQL(row: PayoutRequestRow) {
  return {
    id: row.id,
    requestId: row.requestId,
    to: row.to,
    asset: row.asset,
    amount: row.amount,
    status: row.status,
    riskReason: row.riskReason ?? null,
    txHash: row.txHash ?? null,
    submittedAt: row.submittedAt != null ? String(row.submittedAt) : null,
    confirmedAt: row.confirmedAt != null ? String(row.confirmedAt) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function createResolvers(repo: PayoutRepo) {
  return {
    Query: {
      health: () => "ok",

      payoutRequest: async (_: unknown, args: {id: string}) => {
        const row = repo.getById(args.id);
        return row ? mapToGraphQL(row) : null;
      },

      payoutRequests: async (
        _: unknown,
        args: {status?: PayoutStatus; first: number; after?: string | null}
      ) => {
        const limit = Math.max(1, Math.min(100, args.first));
        const rows = repo.list({status: args.status, first: limit + 1, after: args.after});
        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;

        return {
          edges: items.map((row) => ({
            cursor: row.id,
            node: mapToGraphQL(row),
          })),
          pageInfo: {
            endCursor: items.length > 0 ? items[items.length - 1].id : null,
            hasNextPage,
          },
        };
      },
    },

    Mutation: {
      noop: () => "noop",

      createPayoutRequest: async (_: unknown, args: {to: string; amount: string; asset: string}) => {
        const now = Math.floor(Date.now() / 1000);
        const row = repo.create({to: args.to, amount: args.amount, asset: args.asset, now});
        return mapToGraphQL(row);
      },

      approvePayoutRequest: async (_: unknown, args: {id: string}) => {
        const now = Math.floor(Date.now() / 1000);
        const row = repo.approve(args.id, now);
        if (!row) {
          throw new Error("Request not found or not in PENDING_RISK status");
        }
        return mapToGraphQL(row);
      },
    },
  };
}
