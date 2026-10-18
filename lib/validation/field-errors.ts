// Shared by browser forms and server actions: keep this module free of
// server-only imports so both sides report the same validation errors.

export const FORM_VALIDATION_MESSAGE = "Revisa los campos indicados.";

export type ValidationIssue = {
  readonly path: readonly PropertyKey[];
  readonly message: string;
};

// Keeps the first message for each recognized field under `prefix`. Any other
// issue (unknown keys, envelope fields) is reported through `hasOtherIssues`.
export function collectFieldErrors<Field extends string>(
  issues: readonly ValidationIssue[],
  isField: (value: string) => value is Field,
  prefix: readonly PropertyKey[] = [],
): { fieldErrors: Partial<Record<Field, string>>; hasOtherIssues: boolean } {
  const fieldErrors: Partial<Record<Field, string>> = {};
  let hasOtherIssues = false;
  for (const issue of issues) {
    const matchesPrefix = prefix.every(
      (segment, index) => issue.path[index] === segment,
    );
    const field = issue.path[prefix.length];
    if (matchesPrefix && typeof field === "string" && isField(field)) {
      fieldErrors[field] ??= issue.message;
    } else {
      hasOtherIssues = true;
    }
  }
  return { fieldErrors, hasOtherIssues };
}
