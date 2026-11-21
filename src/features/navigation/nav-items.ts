import { AudioLines, LayoutDashboard, Settings, type LucideIcon } from "lucide-react";
import { ROUTES } from "@/lib/auth/routes";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Sidebar entries. Only pages that EXIST are listed here: each later phase
 * adds its own entry (Library, History, Admin) when its page ships.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: ROUTES.dashboard, label: "Dashboard", icon: LayoutDashboard },
  { href: ROUTES.listen, label: "Listen", icon: AudioLines },
  { href: ROUTES.settings, label: "Settings", icon: Settings },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
