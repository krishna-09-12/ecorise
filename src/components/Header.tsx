'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Menu, Coins, Leaf, Search, Bell, User, ChevronDown, LogIn, LogOut, Sun, Moon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  getUnreadNotifications,
  markNotificationAsRead,
  getUserByEmail,
  getUserBalance,
  sendOtp,
  verifyOtp,
} from '@/utils/db/actions';
import toast from 'react-hot-toast';

interface HeaderProps {
  onMenuClick: () => void;
}

type NotificationRow = {
  id: number;
  userId: number;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
};

export default function Header({ onMenuClick }: HeaderProps) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<{ email: string; name: string } | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [balance, setBalance] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const [showAuth, setShowAuth] = useState(false);
  const [authStep, setAuthStep] = useState<'email' | 'otp'>('email');
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const saved = typeof window !== 'undefined' ? localStorage.getItem('userEmail') : null;
        if (saved) {
          const user = await getUserByEmail(saved);
          if (!cancelled && user) {
            setLoggedIn(true);
            setUserInfo({ email: user.email, name: user.name });
          }
        }
      } catch (e) {
        console.error('Session restore failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  useEffect(() => {
    const fetchNotifications = async () => {
      if (userInfo?.email) {
        const user = await getUserByEmail(userInfo.email);
        if (user) {
          const unreadNotifications = await getUnreadNotifications(user.id);
          setNotifications(unreadNotifications as NotificationRow[]);
        }
      }
    };

    fetchNotifications();
    const notificationInterval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(notificationInterval);
  }, [userInfo]);

  useEffect(() => {
    const fetchUserBalance = async () => {
      if (userInfo?.email) {
        const user = await getUserByEmail(userInfo.email);
        if (user) {
          const userBalance = await getUserBalance(user.id);
          setBalance(userBalance);
        }
      }
    };

    fetchUserBalance();
    const handleBalanceUpdate = (event: CustomEvent<number>) => {
      setBalance(event.detail);
    };
    window.addEventListener('balanceUpdated', handleBalanceUpdate as EventListener);
    return () => {
      window.removeEventListener('balanceUpdated', handleBalanceUpdate as EventListener);
    };
  }, [userInfo]);

  const openAuth = () => {
    setShowAuth(true);
    setAuthStep('email');
    setAuthEmail('');
    setAuthCode('');
  };

  const handleSendCode = async () => {
    if (!authEmail.trim()) {
      toast.error('Enter your email');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await sendOtp(authEmail);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.devOtp) {
        toast.success(`Dev mode: code is ${res.devOtp}`);
      } else {
        toast.success('Check your email for the code');
      }
      setAuthStep('otp');
      setAuthCode('');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!authCode.trim()) {
      toast.error('Enter the code');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await verifyOtp(authEmail, authCode);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      localStorage.setItem('userEmail', res.email);
      setUserInfo({ email: res.email, name: res.name });
      setLoggedIn(true);
      setShowAuth(false);
      toast.success('Signed in');
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('userEmail');
    setLoggedIn(false);
    setUserInfo(null);
    setBalance(0);
    setNotifications([]);
  };

  const handleNotificationClick = async (notificationId: number) => {
    await markNotificationAsRead(notificationId);
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
  };

  const headerContent = loading ? (
    <header className="bg-background border-b border-border fixed top-0 w-full z-50">
      <div className="flex items-center justify-between px-4 py-2 h-14">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-3 w-28 rounded-full bg-muted animate-pulse" />
            <div className="h-2 w-20 rounded-full bg-muted animate-pulse" />
          </div>
        </div>
        <div className="hidden md:block flex-1 max-w-xl mx-4">
          <div className="h-10 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="hidden sm:block h-10 w-24 rounded-full bg-muted animate-pulse" />
        </div>
      </div>
    </header>
  ) : (
    <header className="bg-background border-b border-border fixed top-0 w-full z-50">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="mr-2 md:mr-4 lg:hidden" onClick={onMenuClick}>
            <Menu className="h-6 w-6" />
          </Button>
          <Link href="/" className="flex items-center">
            <Leaf className="h-6 w-6 md:h-8 md:w-8 text-green-500 mr-1 md:mr-2" />
            <div className="flex flex-col">
              <span className="font-bold text-base md:text-lg text-foreground">EcoRise</span>
              <span className="text-[8px] md:text-[10px] text-muted-foreground -mt-1">Rise for a Cleaner Planet</span>
            </div>
          </Link>
        </div>
        {!isMobile && (
          <div className="flex-1 max-w-xl mx-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search..."
                className="w-full px-4 py-2 bg-muted border border-border text-foreground rounded-full focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
        )}
        <div className="flex items-center">
          {isMobile && (
            <Button variant="ghost" size="icon" className="mr-2">
              <Search className="h-5 w-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="mr-2" onClick={toggleTheme}>
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="mr-2 relative">
                <Bell className="h-5 w-5" />
                {notifications.length > 0 && (
                  <Badge className="absolute -top-1 -right-1 px-1 min-w-[1.2rem] h-5">
                    {notifications.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {notifications.length > 0 ? (
                notifications.map((notification) => (
                  <DropdownMenuItem key={notification.id} onClick={() => handleNotificationClick(notification.id)}>
                    <div className="flex flex-col">
                      <span className="font-medium">{notification.type}</span>
                      <span className="text-sm text-muted-foreground">{notification.message}</span>
                    </div>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem>No new notifications</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="mr-2 md:mr-4 flex items-center bg-muted rounded-full px-2 md:px-3 py-1">
            <Coins className="h-4 w-4 md:h-5 md:w-5 mr-1 text-green-500" />
            <span className="font-semibold text-sm md:text-base text-foreground">{balance.toFixed(2)}</span>
          </div>
          {!loggedIn ? (
            <Button onClick={openAuth} className="bg-green-600 hover:bg-green-700 text-white text-sm md:text-base">
              Login
              <LogIn className="ml-1 md:ml-2 h-4 w-4 md:h-5 md:w-5" />
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="flex items-center">
                  <User className="h-5 w-5 mr-1" />
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>{userInfo?.name ?? 'User'}</DropdownMenuItem>
                <DropdownMenuItem>
                  <Link href="/settings">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>
                  <span className="flex items-center gap-1">
                    <LogOut className="h-4 w-4" /> Sign Out
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );

  return (
    <>
      {showAuth && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card text-card-foreground rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold">
              {authStep === 'email' ? 'Sign in or sign up' : 'Enter verification code'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {authStep === 'email'
                ? 'We will email you a one-time code. New accounts are created automatically.'
                : `Code sent to ${authEmail}`}
            </p>
            {authStep === 'email' ? (
              <>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  autoComplete="email"
                  disabled={authBusy}
                  className="bg-background text-foreground"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" type="button" onClick={() => setShowAuth(false)} disabled={authBusy}>
                    Cancel
                  </Button>
                  <Button type="button" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleSendCode} disabled={authBusy}>
                    {authBusy ? 'Sending…' : 'Send code'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  autoComplete="one-time-code"
                  disabled={authBusy}
                  className="bg-background text-foreground"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" type="button" onClick={() => setAuthStep('email')} disabled={authBusy}>
                    Back
                  </Button>
                  <Button type="button" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleVerifyCode} disabled={authBusy}>
                    {authBusy ? 'Verifying…' : 'Verify'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {headerContent}
    </>
  );
}
