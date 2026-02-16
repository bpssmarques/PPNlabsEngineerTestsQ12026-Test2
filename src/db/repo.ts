import {randomUUID} from "node:crypto";
import {Database} from "sql.js";

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

export class PayoutRepo {
  constructor(private readonly db: Database) {}

  create(input: {to: string; amount: string; asset: string; now: number}): PayoutRequestRow {
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

    this.db.run(
      `UPDATE payout_requests
       SET status = ?, risk_reason = ?, tx_hash = ?, submitted_at = ?, confirmed_at = ?, failed_reason = ?, updated_at = ?
       WHERE id = ?`,
      [
        status,
        patch?.riskReason ?? current.riskReason,
        patch?.txHash ?? current.txHash,
        patch?.submittedAt ?? current.submittedAt,
        patch?.confirmedAt ?? current.confirmedAt,
        patch?.failedReason ?? current.failedReason,
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

  list(input: {status?: PayoutStatus; first: number; after?: string | null}): PayoutRequestRow[] {
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
    const stmt = this.db.prepare(
      `SELECT id FROM payout_requests
       WHERE status = 'APPROVED'
       AND (lock_expires_at IS NULL OR lock_expires_at < ?)
       ORDER BY created_at ASC LIMIT 1`
    );
    stmt.bind([now]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const id = String(stmt.get()[0]);
    stmt.free();

    this.db.run(`UPDATE payout_requests SET lock_owner = ?, lock_expires_at = ?, updated_at = ? WHERE id = ?`, [
      owner,
      now + leaseMs,
      now,
      id
    ]);
    return this.getById(id);
  }

  claimSubmitted(now: number, owner: string, leaseMs: number): PayoutRequestRow | null {
    const stmt = this.db.prepare(
      `SELECT id FROM payout_requests
       WHERE status = 'SUBMITTED'
       AND (lock_expires_at IS NULL OR lock_expires_at < ?)
       ORDER BY submitted_at ASC LIMIT 1`
    );
    stmt.bind([now]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const id = String(stmt.get()[0]);
    stmt.free();

    this.db.run(`UPDATE payout_requests SET lock_owner = ?, lock_expires_at = ?, updated_at = ? WHERE id = ?`, [
      owner,
      now + leaseMs,
      now,
      id
    ]);
    return this.getById(id);
  }

  getDailyTotal(now: number): bigint {
    const daySeconds = 86400;
    const dayStart = now - (now % daySeconds);
    const dayEnd = dayStart + daySeconds;

    const stmt = this.db.prepare(
      `SELECT amount FROM payout_requests
       WHERE status IN ('SUBMITTED', 'CONFIRMED')
       AND submitted_at >= ? AND submitted_at < ?`
    );
    stmt.bind([dayStart, dayEnd]);
    let total = 0n;
    while (stmt.step()) {
      total += BigInt(stmt.get()[0] as string);
    }
    stmt.free();
    return total;
  }
}
