-- Snapshot того, що cook_run зробив з коморою, щоб було чим undo-нути.
-- Формат JSONB: { batches: [{ id, op: 'deplete'|'subtract', prev_state, prev_value?, prev_opened_at?, prev_depleted_at?, amount? }, ...] }
-- Nullable — старі cook_run без changes не піддаються undo, що ок для історії.

ALTER TABLE cook_run
  ADD COLUMN changes jsonb;

ALTER TABLE cook_run
  ADD COLUMN undone_at timestamptz;
