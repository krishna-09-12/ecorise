import Link from "next/link"
import { usePathname } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { MapPin, Trash, Coins, Medal, Settings, Home, Car } from "lucide-react"

const sidebarItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/report", icon: MapPin, label: "Report Waste" },
  { href: "/collect", icon: Trash, label: "Collect Waste" },
  { href: "/rewards", icon: Coins, label: "Rewards" },
  { href: "/leaderboard", icon: Medal, label: "Leaderboard" },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={`bg-card border-r pt-20 border-border text-card-foreground w-64 fixed inset-y-0 left-0 top-0 h-screen z-30 transform transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
      <nav className="h-full flex flex-col justify-between">
        <div className="px-4 py-0 space-y-8">
          {sidebarItems.map((item) => (
            <Link key={item.href} href={item.href} passHref onClick={onClose}>
              <Button 
                variant={pathname === item.href ? "secondary" : "ghost"}
                className={`w-full justify-start py-3 ${
                  pathname === item.href 
                    ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400" 
                    : "text-muted-foreground hover:bg-muted"
                }`} 
              >
                <item.icon className="mr-3 h-5 w-5" />
                <span className="text-base">{item.label}</span>
              </Button>
            </Link>
          ))}
        </div>
        <div className="p-4 border-t border-border">
          <Link href="/settings" passHref onClick={onClose}>
            <Button 
              variant={pathname === "/settings" ? "secondary" : "outline"}
              className={`w-full py-3 ${
                pathname === "/settings"
                  ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400"
                  : "text-muted-foreground border-border hover:bg-muted"
              }`} 
            >
              <Settings className="mr-3 h-5 w-5" />
              <span className="text-base">Settings</span>
            </Button>
          </Link>
        </div>
      </nav>
    </aside>
  )
}