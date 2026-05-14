import {
  LayoutDashboard,
  Gavel,
  ShieldAlert,
  FileText,
  FileSpreadsheet,
  Package,
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
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, group: "Operations" },
  { title: "Loads", url: "/loads", icon: Package, group: "Operations", badge: "128" },
  { title: "TruckBoard", url: "/truckboard", icon: Truck, group: "Operations" },
  { title: "Tracking", url: "/tracking", icon: MapPin, group: "Operations", badge: "12" },

  { title: "Bidding", url: "/bidding", icon: Gavel, group: "Commercial" },
  { title: "RFPs", url: "/rfps", icon: FileText, group: "Commercial" },
  { title: "Quotes", url: "/quotes", icon: FileSpreadsheet, group: "Commercial" },
  { title: "Carriers / Brokers", url: "/carriers", icon: Building2, group: "Commercial" },
  { title: "CRM & Sales", url: "/crm", icon: Briefcase, group: "Commercial" },

  { title: "Risk Models", url: "/risk", icon: ShieldAlert, group: "Insights" },
  { title: "Analytics", url: "/analytics", icon: BarChart3, group: "Insights" },
  { title: "Accounting", url: "/accounting", icon: Wallet, group: "Insights" },

  { title: "Communications", url: "/communications", icon: MessageSquare, group: "Workspace", badge: "4" },
  { title: "Settings", url: "/settings", icon: Settings, group: "Workspace" },
  { title: "Admin", url: "/admin", icon: Lock, group: "Workspace" },
  { title: "Profile", url: "/profile", icon: UserCircle2, group: "Workspace" },
];