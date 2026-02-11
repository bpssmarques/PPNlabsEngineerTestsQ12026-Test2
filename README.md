# PPN Labs Developer Test 2 Template

This repository is the baseline for Test 2 (hard/long).

## Candidate workflow

1. Create branch `submission` from `main`.
2. Implement fixes and features for:
- `contracts/SettlementVault.sol`
- `src/api/**`
- `src/worker/**`
- `src/db/**` (as needed)
3. Add `DESIGN.md` (1-2 pages) with required prompts.
4. Open one PR from `submission` into `main`.

## Setup

```bash
pnpm install
pnpm test
```

## Commands

- `pnpm test`
- `pnpm test:contracts`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm demo`

## Important

Forbidden edits are enforced in CI:
- `.github/workflows/**`
- `candidate-pack/**`
- baseline test files under `tests/**` and `contracts/test/**`

Allowed additions for extra tests:
- `tests/additional/**`
- `contracts/test/additional/**`
