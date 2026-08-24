import {
  LayoutDashboard,
  Gavel,
  ShieldAlert,
  FileText,
  FileSpreadsheet,
  Package,
  Boxes,
  Truck,
  BarChart3,
  Building2,
  MapPin,
  MessageSquare,
  Wallet,
  Briefcase,
  Settings,
  Lock,
  UserCircle2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  group: "Operations" | "Commercial" | "Insights" | "Workspace";
  badge?: string;
  /** DynamoDB-backed total shown in the sidebar (replaces static `badge` when set). */
  liveCount?: "loads" | "trucks" | "tracking" | "carriers";
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, group: "Operations" },
  { title: "Loads", url: "/loads", icon: Package, group: "Operations", liveCount: "loads" },
  {
    title: "TruckBoard",
    url: "/truckboard",
    icon: Truck,
    group: "Operations",
    liveCount: "trucks",
  },
  { title: "Tracking", url: "/tracking", icon: MapPin, group: "Operations", liveCount: "tracking" },
  // Title must match the `MODULES` entry exactly — `navItemToModule` maps them
  // by name, and a mismatch silently makes the item ungated.
  { title: "Inventory", url: "/inventory", icon: Boxes, group: "Operations" },

  { title: "Bidding", url: "/bidding", icon: Gavel, group: "Commercial" },
  { title: "RFPs", url: "/rfps", icon: FileText, group: "Commercial" },
  { title: "Quotes", url: "/quotes", icon: FileSpreadsheet, group: "Commercial" },
  {
    title: "Carriers / Brokers",
    url: "/carriers",
    icon: Building2,
    group: "Commercial",
    liveCount: "carriers",
  },
  { title: "CRM & Sales", url: "/crm", icon: Briefcase, group: "Commercial" },

  { title: "Risk Models", url: "/risk", icon: ShieldAlert, group: "Insights" },
  { title: "Analytics", url: "/analytics", icon: BarChart3, group: "Insights" },
  { title: "Accounting", url: "/accounting", icon: Wallet, group: "Insights" },

  {
    title: "Communications",
    url: "/communications",
    icon: MessageSquare,
    group: "Workspace",
  },
  { title: "Settings", url: "/settings", icon: Settings, group: "Workspace" },
  { title: "Admin", url: "/admin", icon: Lock, group: "Workspace" },
  { title: "Profile", url: "/profile", icon: UserCircle2, group: "Workspace" },
];
