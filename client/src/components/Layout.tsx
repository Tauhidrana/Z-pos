import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  CarTaxiFrontIcon,
  PanelRight,
  LogOut,
  User2Icon,
  QrCode,
  Menu,
  X,
  MoreHorizontal,
} from "lucide-react";

import { Button } from "./ui/button";
import { useClerk, useUser } from "@clerk/react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/pos", label: "Point of Sale", icon: ShoppingCart },
  { path: "/products", label: "Products", icon: Package },
  { path: "/purchases", label: "Purchases", icon: CarTaxiFrontIcon },
  { path: "/customers", label: "Customers", icon: Users },
  // { path: "/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/sales", label: "Sales", icon: ShoppingCart },
  { path: "/barcodes", label: "Barcode Generator", icon: QrCode },
  // { path: "/settings", label: "Settings", icon: Settings },
];

const ownerOnlyNavItems = [
  { path: "/admin", label: "Admin", icon: User2Icon },
];

/**
 * The destinations that get a permanent tab on phones. Everything else stays
 * one tap away behind "More", which opens the same drawer as the hamburger.
 */
const bottomTabPaths = ["/", "/pos", "/products", "/sales"] as const;

function NavItem({
  path,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
}: {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [isActive] = useRoute(path === "/" ? "/" : `${path}*`);

  return (
    <Link href={path} onClick={onNavigate}>
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-lg cursor-pointer transition-all duration-150 group relative",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4.5 h-4.5")} />
        {!collapsed && <span className="text-sm font-medium truncate">{label}</span>}
        {collapsed && (
          <div className="absolute left-full ml-3 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 border border-border">
            {label}
          </div>
        )}
      </div>
    </Link>
  );
}

function SidebarBody({
  items,
  collapsed,
  onNavigate,
}: {
  items: typeof navItems;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto overscroll-contain">
      {items.map((item) => (
        <NavItem key={item.path} {...item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

/**
 * Brand lockup for the sidebar and drawer.
 *
 * Two artworks rather than one: the wordmark in the master logo is near-black,
 * which all but disappears on the dark sidebar, so `logo-on-dark.png` carries a
 * light wordmark. Collapsed, only the Z mark fits — it is orange either way, so
 * it needs no variant.
 *
 * The lockup already reads "Zpos", so it replaces the old icon-plus-"zPOS"
 * text pair instead of sitting beside a second copy of the name.
 */
function BrandMark({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <img
        src="/logo-mark.png"
        alt="zPOS"
        width={28}
        height={33}
        className="h-8 w-auto shrink-0"
      />
    );
  }

  return (
    <div className="min-w-0">
      <img
        src="/logo-on-dark.png"
        alt="zPOS"
        width={132}
        height={61}
        className="h-8 w-auto"
      />
      <p className="text-sidebar-foreground/50 text-xs mt-1">Retail Manager</p>
    </div>
  );
}

export default function Layout({
  children,
  isOwner,
}: {
  children: React.ReactNode;
  isOwner?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();

  // The drawer stores the route it was opened on rather than a bare boolean, so
  // "open" is derived state that a navigation invalidates on its own. A drawer
  // left open across a route change would cover the page the user just asked
  // for, and closing it from an effect trips react-hooks/set-state-in-effect.
  // This also covers back/forward, which an onClick handler alone would miss.
  const [drawerRoute, setDrawerRoute] = useState<string | null>(null);
  const drawerOpen = drawerRoute === location;
  const setDrawerOpen = useCallback(
    (open: boolean) => setDrawerRoute(open ? location : null),
    [location],
  );

  const visibleNavItems = isOwner ? [...navItems, ...ownerOnlyNavItems] : navItems;
  const tabs = visibleNavItems.filter((i) =>
    (bottomTabPaths as readonly string[]).includes(i.path),
  );

  // While the drawer is open the page behind it must not scroll, or a swipe on
  // the overlay drags the content underneath.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    // 100dvh, not 100vh: mobile browsers report vh against the *expanded*
    // viewport, so the last ~60px of the app would sit under the URL bar.
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 shrink-0",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-4 border-b border-sidebar-border",
            collapsed && "justify-center",
          )}
        >
          <BrandMark collapsed={collapsed} />
        </div>
        <SidebarBody items={visibleNavItems} collapsed={collapsed} />
      </aside>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      <div
        data-offcanvas=""
        className={cn(
          "md:hidden fixed inset-0 z-50 transition-opacity duration-200",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 h-full w-full bg-black/50"
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex w-[min(17rem,82vw)] flex-col bg-sidebar shadow-xl transition-transform duration-200",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
            <div className="min-w-0 flex-1">
              <BrandMark collapsed={false} />
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="p-2 -mr-2 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <SidebarBody
            items={visibleNavItems}
            collapsed={false}
            onNavigate={() => setDrawerOpen(false)}
          />
        </aside>
      </div>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 bg-card border-b border-border shrink-0">
          <Button
            onClick={() => setDrawerOpen(true)}
            size="icon"
            variant="outline"
            className="md:hidden"
            aria-label="Open menu"
          >
            <Menu />
          </Button>

          <Button
            onClick={() => setCollapsed(!collapsed)}
            size="icon"
            variant="outline"
            className="hidden md:inline-flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelRight />
          </Button>

          {/* On phones the header doubles as the page's identity bar. Light
              surface here, so this uses the master artwork's dark wordmark. */}
          <img
            src="/logo.png"
            alt="zPOS"
            width={99}
            height={46}
            className="md:hidden h-6 w-auto"
          />

          <UserMenu />
        </header>

        {/* The bottom tab bar floats over the content, so the scroll area needs
            matching padding or the last row sits underneath it. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom tabs ──────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        {tabs.map((tab) => (
          <BottomTab key={tab.path} {...tab} />
        ))}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </nav>
    </div>
  );
}

function BottomTab({
  path,
  label,
  icon: Icon,
}: {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const [isActive] = useRoute(path === "/" ? "/" : `${path}*`);

  // "Point of Sale" and "Barcode Generator" do not fit a 60px-wide tab.
  const shortLabel = label === "Point of Sale" ? "POS" : label.split(" ")[0];

  return (
    <Link href={path} className="flex-1">
      <span
        className={cn(
          "flex h-full flex-col items-center justify-center gap-0.5 py-2 transition-colors",
          isActive ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-medium leading-none">{shortLabel}</span>
      </span>
    </Link>
  );
}

export function UserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const initial = user?.firstName?.[0]?.toUpperCase() ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-9 rounded-full p-0 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm shrink-0"
        >
          {isLoaded ? initial : "?"}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-60" align="end" sideOffset={8}>
        <div className="flex items-center gap-3 px-3 py-3">
          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium text-sm shrink-0">
            {initial}
          </div>
          <div className="flex flex-col min-w-0">
            <p className="text-sm font-medium truncate">{user?.fullName ?? "—"}</p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.emailAddresses[0]?.emailAddress ?? "—"}
            </p>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => signOut()}
          className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
