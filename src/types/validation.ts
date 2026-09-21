export type ValidationResult<Value, Field extends string> =
  | { ok: true; value: Value }
  | { ok: false; errors: Partial<Record<Field, string>> }
