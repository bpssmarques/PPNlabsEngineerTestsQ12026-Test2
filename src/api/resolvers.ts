import {GraphQLError} from "graphql";
import type {PayoutRequestRow, PayoutStatus} from "../db/repo";
import type {ApiContext} from "./server";

function rowToPayoutRequest(row: PayoutRequestRow) {
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
    updatedAt: String(row.updatedAt)
  };
}

export const resolvers = {
  Query: {
    health: () => "ok",

    payoutRequest: (_: unknown, args: {id: string}, context: ApiContext) => {
      const row = context.repo.getById(args.id);
      return row ? rowToPayoutRequest(row) : null;
    },

    payoutRequests: (
      _: unknown,
      args: {status?: PayoutStatus; first: number; after?: string | null},
      context: ApiContext
    ) => {
      const after = args.after ?? undefined;
      if (after !== undefined) {
        const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after);
        if (!uuidLike) {
          throw new GraphQLError("Invalid cursor format", {extensions: {code: "BAD_USER_INPUT"}});
        }
      }
      const rows = context.repo.list({
        status: args.status,
        first: args.first,
        after
      });
      const edges = rows.map((node) => ({cursor: node.id, node: rowToPayoutRequest(node)}));
      const last = rows[rows.length - 1];
      return {
        edges,
        pageInfo: {
          endCursor: last ? last.id : null,
          hasNextPage: rows.length === args.first
        }
      };
    }
  },
  Mutation: {
    noop: () => "noop",

    createPayoutRequest: (
      _: unknown,
      args: {to: string; amount: string; asset: string},
      context: ApiContext
    ) => {
      const now = Math.floor(Date.now() / 1000);
      const row = context.repo.create({
        to: args.to,
        amount: args.amount,
        asset: args.asset,
        now
      });
      return rowToPayoutRequest(row);
    },

    approvePayoutRequest: (_: unknown, args: {id: string}, context: ApiContext) => {
      const now = Math.floor(Date.now() / 1000);
      const row = context.repo.approve(args.id, now);
      if (!row) {
        throw new GraphQLError("Payout request not found or not in PENDING_RISK status", {
          extensions: {code: "BAD_REQUEST"}
        });
      }
      return rowToPayoutRequest(row);
    }
  }
};
