import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/auth/routes";

export default function AdminIndex() {
  redirect(ROUTES.adminReferences);
}
