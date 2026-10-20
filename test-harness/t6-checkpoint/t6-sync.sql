-- =============================================================================
-- T6 SYNCHRONIZATION HELPERS  --  REFERENCE ONLY (read-only observation).
-- NOT executed directly and NOT a script. The runner
-- (t6-local-runner.mjs) performs these same observations through its dedicated
-- read-only observer connection, once per bounded poll. Polling cadence is an
-- observation interval; no sleep here is ever used as evidence of ordering.
--
-- Row locks are NOT represented as pg_locks entries for the holder. The holder
-- is observed by its granted `transactionid` lock (taken on first write); a
-- waiter is observed by its ungranted lock entry.
-- =============================================================================

-- HOLDER: session `pid` has an open write transaction.
--   SELECT count(*) FROM pg_locks WHERE pid = :pid AND granted AND locktype = 'transactionid';

-- WAITER: session `pid` is currently blocked on some lock.
--   SELECT count(*) FROM pg_locks WHERE pid = :pid AND NOT granted;

-- ADVISORY HOLDER: session `pid` holds a granted advisory lock.
--   SELECT count(*) FROM pg_locks WHERE pid = :pid AND granted AND locktype = 'advisory';

-- SESSION ALIVE: the session `pid` still has a backend.
--   SELECT count(*) FROM pg_stat_activity WHERE pid = :pid;

-- CONCURRENT TEST SESSIONS SURVIVING (a/b only).
--   SELECT count(*) FROM pg_stat_activity
--    WHERE application_name IN ('slmm-t6-a','slmm-t6-b') AND pid <> pg_backend_pid();

-- T6 ADVISORY LOCKS STILL HELD (excludes the caller's own connection).
--   SELECT count(*) FROM pg_locks l JOIN pg_stat_activity s ON s.pid = l.pid
--    WHERE l.granted AND l.locktype = 'advisory'
--      AND s.application_name LIKE 'slmm-t6-%' AND s.pid <> pg_backend_pid();

-- The per-key advisory lock used by public.request_storage_deletion is taken
-- inside the function as pg_advisory_xact_lock(hashtextextended(<key>,0)). Its
-- 64-bit value is NEVER computed client-side; the lock is observed, not inferred.
