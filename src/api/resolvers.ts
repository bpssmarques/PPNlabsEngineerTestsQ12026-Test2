import {createDb} from "../db/db";
import {PayoutRepo} from "../db/repo";
import {PayoutRequest, PayoutStatus} from "../types/payout.types";

let db: Awaited<ReturnType<typeof createDb>> | null = null;
let repo: PayoutRepo | null = null;

async function getRepo(): Promise<PayoutRepo> {
  if (!repo) {
    db = await createDb();
    repo = new PayoutRepo(db);
  }
  return repo;
}

function mapRowToGraphQL(row: PayoutRequest) {
  return {
    id: row.id,
    requestId: row.requestId,
    to: row.to,
    asset: row.asset,
    amount: row.amount,
    status: row.status,
    riskReason: row.riskReason,
    txHash: row.txHash,
    submittedAt: row.submittedAt?.toString(),
    confirmedAt: row.confirmedAt?.toString(),
    createdAt: row.createdAt.toString(),
    updatedAt: row.updatedAt.toString()
  };
}

interface QueryPayoutRequestArgs {
  id: string;
}

interface QueryPayoutRequestsArgs {
  status?: PayoutStatus;
  first: number;
  after?: string | null;
}

interface MutationCreatePayoutRequestArgs {
  to: string;
  amount: string;
  asset: string;
}

interface MutationApprovePayoutRequestArgs {
  id: string;
}

export const resolvers = {
  Query: {
    health: () => "ok",
    payoutRequest: async (_parent: unknown, args: QueryPayoutRequestArgs) => {
      const repo = await getRepo();
      console.log(`[GraphQL] Query payoutRequest(id: ${args.id})`);
      const row = repo.getById(args.id);
      console.log(`[GraphQL] Result: ${row ? `found ${row.status}` : 'not found'}`);
      return row ? mapRowToGraphQL(row) : null;
    },
    payoutRequests: async (_parent: unknown, args: QueryPayoutRequestsArgs) => {
      const repo = await getRepo();
      console.log(`[GraphQL] Query payoutRequests(status: ${args.status}, first: ${args.first}, after: ${args.after})`);
      const rows = repo.list({
        status: args.status,
        first: args.first,
        after: args.after
      });
      console.log(`[GraphQL] Found ${rows.length} requests`);
      const edges = rows.map((row) => ({
        cursor: row.id,
        node: mapRowToGraphQL(row)
      }));
      return {
        edges,
        pageInfo: {
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
          hasNextPage: edges.length === args.first
        }
      };
    }
  },
  Mutation: {
    noop: () => "noop",
    createPayoutRequest: async (_parent: unknown, args: MutationCreatePayoutRequestArgs) => {
      const repo = await getRepo();
      const now = Date.now();
      console.log(`[GraphQL] Mutation createPayoutRequest(to: ${args.to}, amount: ${args.amount}, asset: ${args.asset})`);
      const row = repo.create({
        to: args.to,
        amount: args.amount,
        asset: args.asset,
        now
      });
      console.log(`[GraphQL] Created request ${row.id} with requestId ${row.requestId}, status: ${row.status}`);
      return mapRowToGraphQL(row);
    },
    approvePayoutRequest: async (_parent: unknown, args: MutationApprovePayoutRequestArgs) => {
      const repo = await getRepo();
      const now = Date.now();
      console.log(`[GraphQL] Mutation approvePayoutRequest(id: ${args.id})`);
      const row = repo.approve(args.id, now);
      if (!row) {
        console.log(`[GraphQL] Failed to approve ${args.id}`);
        throw new Error(`Cannot approve request ${args.id}`);
      }
      console.log(`[GraphQL] Approved ${args.id}, new status: ${row.status}`);
      return mapRowToGraphQL(row);
    }
  }
};
