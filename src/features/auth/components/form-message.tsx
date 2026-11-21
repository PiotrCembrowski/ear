import { Alert } from "@/components/ui/alert";
import type { FormState } from "../form-state";

/** Shows the form-level message from a Server Action result, if any. */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message || state.status === "idle") return null;
  return <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert>;
}
