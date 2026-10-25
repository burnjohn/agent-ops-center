/** Why a database constraint refused a write (SPEC-server-api §C3 "Constraint mapping"). */
export type ConstraintRaceKind =
  /** An agent already holds a ticket / running session -> 409 `agent_busy`. */
  | 'agent_busy'
  /** Two transactions took the same id number -> one retry, then 500 `internal`. */
  | 'counter_collision'
  /** Empty title reached the database -> 400 `validation_failed`. */
  | 'empty_title'
  /** Serialization failure or lock timeout -> 409 `stale_state`. */
  | 'stale_state'
  /** Enum / token-shape / FK / append-only violation -> 500 `internal`. */
  | 'internal';

/** Typed failure an adapter raises when a constraint decides a race the rules would have refused. */
export class ConstraintRace extends Error {
  override readonly name = 'ConstraintRace';
  readonly kind: ConstraintRaceKind;

  constructor(kind: ConstraintRaceKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Constraint race: ${kind}`, options);
    this.kind = kind;
  }
}
