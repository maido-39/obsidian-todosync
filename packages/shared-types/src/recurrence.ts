/**
 * A repetition rule parsed from the 🔁 signifier (§3.2 / §3.6).
 *
 * In Increment 1 only `raw` and `whenDone` are populated; `rrule` conversion is
 * the job of the later `core/rrule` package, which is the sole writer of that field.
 */
export interface RecurrenceRule {
  /**
   * Verbatim text following the 🔁 signifier, e.g. `"every weekday"` or
   * `"every friday when done"`. A trailing `"when done"` is retained here.
   */
  raw: string;
  /**
   * Serialized RRULE, e.g. `"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"`.
   * Empty string = **not yet converted** (sentinel for the unconverted state).
   */
  rrule: string;
  /**
   * Whether the next instance is recomputed from the completion date
   * (`"… when done"`). RRULE alone cannot express this.
   */
  whenDone: boolean;
}
