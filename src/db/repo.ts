import { randomUUID } from "node:crypto";
import { Database } from "sql.js";

export type PayoutStatus = "PENDING_RISK" | "APPROVED" | "REJECTED" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export interface PayoutRequestRow {
  id: string;
  requestId: string;
  to: string;
  asset: string;
  amount: string;
  status: PayoutStatus;
  riskReason: string | null;
  txHash: string | null;
  submittedAt: number | null;
  confirmedAt: number | null;
  failedReason: string | null;
  createdAt: number;
  updatedAt: number;
  lockOwner: string | null;
  lockExpiresAt: number | null;
}

const ALLOWED_TRANSITIONS: Record<PayoutStatus, ReadonlyArray<PayoutStatus>> = {
  PENDING_RISK: ["APPROVED", "REJECTED"],
  APPROVED: ["SUBMITTED", "REJECTED"],
  REJECTED: [],
  SUBMITTED: ["CONFIRMED", "FAILED"],
  CONFIRMED: [],
  FAILED: []
};

function mapRow(values: any[]): PayoutRequestRow {
  return {
    id: values[0],
    requestId: values[1],
    to: values[2],
    asset: values[3],
    amount: values[4],
    status: values[5],
    riskReason: values[6],
    txHash: values[7],
    submittedAt: values[8],
    confirmedAt: values[9],
    failedReason: values[10],
    createdAt: values[11],
    updatedAt: values[12],
    lockOwner: values[13],
    lockExpiresAt: values[14]
  };
}

type PatchablePayoutFields =
  | "riskReason"
  | "txHash"
  | "submittedAt"
  | "confirmedAt"
  | "failedReason";

function resolvePatchedValue<
  Key extends PatchablePayoutFields
>(
  patch: Partial<Pick<PayoutRequestRow, PatchablePayoutFields>> | undefined,
  key: Key,
  currentValue: PayoutRequestRow[Key]
): PayoutRequestRow[Key] {
  if (!patch) {
    return currentValue;
  }

  const value = patch[key];
  if (value === undefined) {
    return currentValue;
  }

  return value;
}

function isSqliteBusyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SQLITE_BUSY");
}

export class PayoutRepo {
  constructor(private readonly db: Database) { }

  create(input: { to: string; amount: string; asset: string; now: number }): PayoutRequestRow {
    const id = randomUUID();
    const requestId = randomUUID().replace(/-/g, "");
    const status: PayoutStatus = "PENDING_RISK";

    this.db.run(
      `INSERT INTO payout_requests (
        id, request_id, to_address, asset, amount, status,
        risk_reason, tx_hash, submitted_at, confirmed_at, failed_reason,
        created_at, updated_at, lock_owner, lock_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
      [id, requestId, input.to, input.asset, input.amount, status, input.now, input.now]
    );
    return this.getById(id)!;
  }

  getById(id: string): PayoutRequestRow | null {
    const stmt = this.db.prepare(
      `SELECT id, request_id, to_address, asset, amount, status, risk_reason, tx_hash,
      submitted_at, confirmed_at, failed_reason, created_at, updated_at, lock_owner, lock_expires_at
      FROM payout_requests WHERE id = ?`
    );
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = mapRow(stmt.get());
    stmt.free();
    return row;
  }

  updateStatus(
    id: string,
    status: PayoutStatus,
    now: number,
    patch?: Partial<Pick<PayoutRequestRow, "riskReason" | "txHash" | "submittedAt" | "confirmedAt" | "failedReason">>
  ): PayoutRequestRow | null {
    const current = this.getById(id);
    if (!current) return null;

    if (current.status !== status && !ALLOWED_TRANSITIONS[current.status].includes(status)) {
      return null;
    }

    const nextRiskReason = resolvePatchedValue(patch, "riskReason", current.riskReason);
    const nextTxHash = resolvePatchedValue(patch, "txHash", current.txHash);
    const nextSubmittedAt = resolvePatchedValue(patch, "submittedAt", current.submittedAt);
    const nextConfirmedAt = resolvePatchedValue(patch, "confirmedAt", current.confirmedAt);
    const nextFailedReason = resolvePatchedValue(patch, "failedReason", current.failedReason);

    this.db.run(
      `UPDATE payout_requests
       SET status = ?, risk_reason = ?, tx_hash = ?, submitted_at = ?, confirmed_at = ?, failed_reason = ?, updated_at = ?
       WHERE id = ?`,
      [
        status,
        nextRiskReason,
        nextTxHash,
        nextSubmittedAt,
        nextConfirmedAt,
        nextFailedReason,
        now,
        id
      ]
    );
    return this.getById(id);
  }

  approve(id: string, now: number): PayoutRequestRow | null {
    const row = this.getById(id);
    if (!row || row.status !== "PENDING_RISK") return null;
    return this.updateStatus(id, "APPROVED", now);
  }

  list(input: { status?: PayoutStatus; first: number; after?: string | null }): PayoutRequestRow[] {
    const first = Math.max(1, Math.min(100, input.first));
    const conditions: string[] = [];
    const params: any[] = [];

    if (input.status) {
      conditions.push("status = ?");
      params.push(input.status);
    }

    if (input.after) {
      conditions.push("id > ?");
      params.push(input.after);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const stmt = this.db.prepare(
      `SELECT id, request_id, to_address, asset, amount, status, risk_reason, tx_hash,
       submitted_at, confirmed_at, failed_reason, created_at, updated_at, lock_owner, lock_expires_at
       FROM payout_requests ${where} ORDER BY id ASC LIMIT ?`
    );

    stmt.bind([...params, first]);
    const rows: PayoutRequestRow[] = [];
    while (stmt.step()) {
      rows.push(mapRow(stmt.get()));
    }
    stmt.free();
    return rows;
  }

  claimApproved(now: number, owner: string, leaseMs: number): PayoutRequestRow | null {
    return this.claimByStatus("APPROVED", now, owner, leaseMs);
  }

  claimSubmitted(now: number, owner: string, leaseMs: number): PayoutRequestRow | null {
    return this.claimByStatus("SUBMITTED", now, owner, leaseMs);
  }

  releaseLock(id: string, owner: string, now: number): void {
    this.db.run(
      `UPDATE payout_requests
       SET lock_owner = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ? AND lock_owner = ?`,
      [now, id, owner]
    );
  }

  getDailyTotal(dayStartUtc: number, dayEndUtcExclusive: number): bigint {
    const stmt = this.db.prepare(
      `SELECT amount FROM payout_requests
       WHERE created_at >= ? AND created_at < ?
       AND status IN ('APPROVED', 'SUBMITTED', 'CONFIRMED')`
    );
    stmt.bind([dayStartUtc, dayEndUtcExclusive]);

    let total = 0n;
    while (stmt.step()) {
      const amount = String(stmt.get()[0]);
      total += BigInt(amount);
    }
    stmt.free();
    return total;
  }

  private claimByStatus(status: PayoutStatus, now: number, owner: string, leaseMs: number): PayoutRequestRow | null {
    const leaseExpiresAt = now + leaseMs;

    try {
      this.db.run("BEGIN IMMEDIATE TRANSACTION");

      const candidateStmt = this.db.prepare(
        `SELECT id FROM payout_requests
         WHERE status = ?
         AND (lock_expires_at IS NULL OR lock_expires_at < ?)
         ORDER BY created_at ASC
         LIMIT 1`
      );
      candidateStmt.bind([status, now]);
      const candidateId = candidateStmt.step() ? String(candidateStmt.get()[0]) : null;
      candidateStmt.free();

      if (!candidateId) {
        this.db.run("COMMIT");
        return null;
      }

      this.db.run(
        `UPDATE payout_requests
         SET lock_owner = ?, lock_expires_at = ?, updated_at = ?
         WHERE id = ?
         AND status = ?
         AND (lock_expires_at IS NULL OR lock_expires_at < ?)`,
        [owner, leaseExpiresAt, now, candidateId, status, now]
      );

      const changesStmt = this.db.prepare("SELECT changes()");
      changesStmt.step();
      const changes = Number(changesStmt.get()[0]);
      changesStmt.free();

      if (changes === 0) {
        this.db.run("COMMIT");
        return null;
      }

      const rowStmt = this.db.prepare(
        `SELECT id, request_id, to_address, asset, amount, status, risk_reason, tx_hash,
         submitted_at, confirmed_at, failed_reason, created_at, updated_at, lock_owner, lock_expires_at
         FROM payout_requests
         WHERE id = ?
         LIMIT 1`
      );
      rowStmt.bind([candidateId]);
      const row = rowStmt.step() ? mapRow(rowStmt.get()) : null;
      rowStmt.free();

      this.db.run("COMMIT");
      return row;
    } catch (error: unknown) {
      if (isSqliteBusyError(error)) {
        return null;
      }

      try {
        this.db.run("ROLLBACK");
      } catch {
        // no-op: transaction may not have been started
      }

      throw error;
    }
  }
}
