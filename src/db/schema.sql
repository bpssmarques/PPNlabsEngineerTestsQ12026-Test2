CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  to_address TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_reason TEXT NULL,
  tx_hash TEXT NULL UNIQUE,
  submitted_at INTEGER NULL,
  confirmed_at INTEGER NULL,
  failed_reason TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lock_owner TEXT NULL,
  lock_expires_at INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_status_created_at
ON payout_requests(status, created_at);

CREATE INDEX IF NOT EXISTS idx_payout_requests_lock_expires_at
ON payout_requests(lock_expires_at);
