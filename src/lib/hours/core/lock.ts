/**
 * The hours module's advisory lock key (spec 124 EARS-10).
 *
 * Every hours mutation takes `pg_advisory_xact_lock(HOURS_LOCK_KEY)` as the FIRST
 * statement of its transaction. That is the direct analogue of today's
 * in-process mutex (081 §13): the shipped read-validate-write logic — «no second
 * open period», «one publication batch per period», the date-edit recompute —
 * keeps its guarantees only under full mutual exclusion, and a process-local
 * promise queue stops being one the moment two Node processes talk to one
 * database.
 *
 * The advisory-lock space is ONE namespace per database, shared by every module
 * that ever takes a lock. So the key is allocated here, in the open, rather than
 * hashed from a string at call time: a second module must pick a DIFFERENT
 * number, and a collision would be an invisible cross-module mutex. Allocation
 * register (extend it, never reuse a row):
 *
 * | key       | holder       | why                                    |
 * | --------- | ------------ | -------------------------------------- |
 * | `1240001` | hours module | spec 124 EARS-10, all hours mutations  |
 *
 * The number is a plain integer inside the bigint domain and is passed with an
 * explicit `::bigint` cast: `pg_advisory_xact_lock` has a two-`int4` overload as
 * well, and an uncast parameter is exactly the kind of thing a later edit
 * silently re-resolves to the other signature.
 */
export const HOURS_LOCK_KEY = 1_240_001
