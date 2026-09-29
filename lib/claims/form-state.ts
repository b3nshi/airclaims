export type FormState = {
  status: "idle" | "saved" | "invalid" | "error" | "changed";
  fieldErrors?: Record<string, true>;
};

export const initialFormState: FormState = { status: "idle" };

export function invalid(issues: { path: PropertyKey[] }[]): FormState {
  return { status: "invalid", fieldErrors: Object.fromEntries(issues.map((i) => [String(i.path[0]), true])) };
}
