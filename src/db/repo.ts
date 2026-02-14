import {randomUUID} from "node:crypto";
import {Database, SqlValue} from "sql.js";
import {IPayoutRepository} from "../interfaces/IPayoutRepository";
import {
  PayoutRequest,
  PayoutStatus,
  CreatePayoutInput,
  UpdateStatusPatch,
  ListPayoutInput
} from "../types/payout.types";
import { DbPayoutRow } from "../interfaces/DbPayoutRow";

interface RowMapper {
  map(row: DbPayoutRow): PayoutRequest;
}

class PayoutRowMapper implements RowMapper {
  map(row: DbPayoutRow): PayoutRequest {
    return {
      id: row.id,
      requestId: row.request_id,
      to: row.to_address,
      asset: row.asset,
      amount: row.amount,
      status: row.status,
      riskReason: row.risk_reason,
      txHash: row.tx_hash,
      submittedAt: row.submitted_at,
      confirmedAt: row.confirmed_at,
      failedReason: row.failed_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lockOwner: row.lock_owner,
      lockExpiresAt: row.lock_expires_at
    };
  }
}

const mapper = new PayoutRowMapper();

function mapRow(values: SqlValue[]): PayoutRequest {
  const row: DbPayoutRow = {
    id: values[0] as string,
    request_id: values[1] as string,
    to_address: values[2] as string,
    asset: values[3] as string,
    amount: values[4] as string,
    status: values[5] as PayoutStatus,
    risk_reason: values[6] as string | null,
    tx_hash: values[7] as string | null,
    submitted_at: values[8] as number | null,
    confirmed_at: values[9] as number | null,
    failed_reason: values[10] as string | null,
    created_at: values[11] as number,
    updated_at: values[12] as number,
    lock_owner: values[13] as string | null,
    lock_expires_at: values[14] as number | null
  };
  return mapper.map(row);
}

export class PayoutRepo implements IPayoutRepository {
  constructor(private readonly db: Database) {}

  create(input: CreatePayoutInput): PayoutRequest {
    const id = randomUUID();
    const requestId = randomUUID().replace(/-/g, "");
    const status: PayoutStatus = "PENDING_RISK";

    console.log(`[DB] Creating payout: id=${id}, requestId=${requestId}, to=${input.to}, amount=${input.amount}`);
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

  getById(id: string): PayoutRequest | null {
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
    const values: SqlValue[] = stmt.get();
    const row: PayoutRequest = mapRow(values);
    stmt.free();
    return row;
  }

  updateStatus(
    id: string,
    status: PayoutStatus,
    now: number,
    patch?: UpdateStatusPatch
  ): PayoutRequest | null {
    const current = this.getById(id);
    if (!current) return null;

    console.log(`[DB] Updating ${id}: ${current.status} -> ${status}`);
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

  approve(id: string, now: number): PayoutRequest | null {
    const row = this.getById(id);
    if (!row || row.status !== "PENDING_RISK") {
      console.log(`[DB] Cannot approve ${id}: ${!row ? 'not found' : `status is ${row.status}`}`);
      return null;
    }
    console.log(`[DB] Approving ${id}`);
    return this.updateStatus(id, "APPROVED", now);
  }

  list(input: ListPayoutInput): PayoutRequest[] {
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
    const rows: PayoutRequest[] = [];
    while (stmt.step()) {
      rows.push(mapRow(stmt.get()));
    }
    stmt.free();
    return rows;
  }

  claimApproved(now: number, owner: string, leaseMs: number): PayoutRequest | null {
    const stmt = this.db.prepare(
      `SELECT id FROM payout_requests
       WHERE status IN ('APPROVED', 'SUBMITTED')
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

    console.log(`[DB] Claiming ${id} for owner=${owner}, lease=${leaseMs}ms`);
    this.db.run(`UPDATE payout_requests SET lock_owner = ?, lock_expires_at = ?, updated_at = ? WHERE id = ?`, [
      owner,
      now + leaseMs,
      now,
      id
    ]);
    return this.getById(id);
  }

  getDailyTotal(now: number): bigint {
    const startOfDayUTC = Math.floor(now / 86400000) * 86400000;
    const stmt = this.db.prepare(
      `SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total
       FROM payout_requests
       WHERE status IN ('SUBMITTED', 'CONFIRMED')
       AND created_at >= ?`
    );
    stmt.bind([startOfDayUTC]);
    if (!stmt.step()) {
      stmt.free();
      return 0n;
    }
    const total = stmt.get()[0] as number;
    stmt.free();
    console.log(`[DB] Daily total: ${total}`);
    return BigInt(total);
  }
}
