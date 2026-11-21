import { AudioLines, History, Library, LayoutDashboard, Settings, ShieldCheck, type LucideIcon } from "lucide-react";
import { ROUTES } from "@/lib/auth/routes";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

/**
 * Sidebar entries. Only pages that EXIST are listed here: each later phase
 * adds its own entry (e.g. History) when its page ships. Admin entries are
 * shown only to admins (the pages also check the role on the server).
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: ROUTES.dashboard, label: "Dashboard", icon: LayoutDashboard },
  { href: ROUTES.listen, label: "Listen", icon: AudioLines },
  { href: ROUTES.library, label: "Library", icon: Library },
  { href: ROUTES.history, label: "History", icon: History },
  { href: ROUTES.settings, label: "Settings", icon: Settings },
  { href: ROUTES.adminReferences, label: "Admin", icon: ShieldCheck, adminOnly: true },
];

export function navItemsFor(isAdmin: boolean): NavItem[] {
  return PRIMARY_NAV.filter((item) => !item.adminOnly || isAdmin);
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
