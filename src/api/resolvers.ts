import { PayoutRepo, PayoutRequestRow, PayoutStatus } from "../db/repo";

function toGraphRow(row: PayoutRequestRow) {
  return {
    id: row.id,
    requestId: row.requestId,
    to: row.to,
    asset: row.asset,
    amount: row.amount,
    status: row.status,
    riskReason: row.riskReason,
    txHash: row.txHash,
    submittedAt: row.submittedAt === null ? null : String(row.submittedAt),
    confirmedAt: row.confirmedAt === null ? null : String(row.confirmedAt),
    failedReason: row.failedReason,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function encodeCursor(id: string): string {
  return Buffer.from(`id:${id}`, "utf8").toString("base64");
}

function decodeCursor(cursor: string | null | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    if (!decoded.startsWith("id:")) {
      throw new Error("invalid-cursor");
    }
    return decoded.slice(3);
  } catch {
    throw new Error("invalid-cursor");
  }
}

function asPositiveFirst(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("first must be a positive integer");
  }
  if (value > 100) {
    throw new Error("first cannot be greater than 100");
  }
  return value;
}

export function buildResolvers(repoPromise: Promise<PayoutRepo>) {

  return {
    Query: {
      health: () => "ok",
      payoutRequest: async (_: unknown, args: { id: string }) => {
        const resolvedRepo = await repoPromise;
        const row = resolvedRepo.getById(args.id);
        return row ? toGraphRow(row) : null;
      },
      payoutRequests: async (_: unknown, args: { status?: PayoutStatus; first: number; after?: string }) => {
        const resolvedRepo = await repoPromise;
        const first = asPositiveFirst(args.first);
        const after = decodeCursor(args.after);

        const rows = resolvedRepo.list({ status: args.status, first: first + 1, after });
        const hasNextPage = rows.length > first;
        const pageRows = hasNextPage ? rows.slice(0, first) : rows;

        const edges = pageRows.map((row) => ({ cursor: encodeCursor(row.id), node: toGraphRow(row) }));
        return {
          edges,
          pageInfo: {
            endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
            hasNextPage
          }
        };
      }
    },
    Mutation: {
      createPayoutRequest: async (_: unknown, args: { to: string; amount: string; asset: string }) => {
        const resolvedRepo = await repoPromise;
        const now = Math.floor(Date.now() / 1000);
        const created = resolvedRepo.create({ to: args.to, amount: args.amount, asset: args.asset, now });
        return toGraphRow(created);
      },
      approvePayoutRequest: async (_: unknown, args: { id: string }) => {
        const resolvedRepo = await repoPromise;
        const existing = resolvedRepo.getById(args.id);
        if (!existing) {
          throw new Error("request not found");
        }
        if (existing.status !== PayoutStatus.PENDING_RISK) {
          throw new Error("request not in PENDING_RISK status");
        }
        const now = Math.floor(Date.now() / 1000);
        const approved = resolvedRepo.approve(args.id, now);
        if (!approved) {
          throw new Error("failed to approve request");
        }
        return toGraphRow(approved);
      }
    }
  };
}
