/*
 * A text field's problem shown under its control, and the control's matching aria attributes
 * (the New repertoire and Edit repertoire forms).
 */

/** The control's aria attributes for its field's error; `errorId` names the error's text, if any. */
export function fieldErrorAria(error: string | null | undefined, errorId?: string) {
  return {
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": error ? errorId : undefined
  };
}

export function FieldError({ id, error }: { id?: string; error: string | null | undefined }) {
  return error ? (
    <p id={id} className="text-2xs text-danger">
      {error}
    </p>
  ) : null;
}
