'use client';

import { useState, useEffect } from 'react';
import { User, Mail, Phone, MapPin, Save, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getUserByEmail, updateUserProfile } from '@/utils/db/actions';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';

type FormState = {
  name: string;
  email: string;
  phone: string;
  address: string;
  notifications: boolean;
};

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<FormState>({
    name: '',
    email: '',
    phone: '',
    address: '',
    notifications: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const userEmail = typeof window !== 'undefined' ? localStorage.getItem('userEmail') : null;
      if (!userEmail) {
        toast.error('Please sign in to view settings.');
        router.push('/');
        return;
      }
      try {
        const user = await getUserByEmail(userEmail);
        if (cancelled) return;
        if (!user) {
          toast.error('Account not found.');
          router.push('/');
          return;
        }
        setSettings({
          name: user.name,
          email: user.email,
          phone: user.phone ?? '',
          address: user.address ?? '',
          notifications: user.notifications ?? true,
        });
      } catch {
        toast.error('Failed to load profile.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.email) return;
    setSaving(true);
    try {
      const updated = await updateUserProfile(settings.email, {
        name: settings.name,
        phone: settings.phone,
        address: settings.address,
        notifications: settings.notifications,
      });
      if (updated) {
        toast.success('Profile saved.');
        setSettings((prev) => ({
          ...prev,
          name: updated.name,
          phone: updated.phone ?? '',
          address: updated.address ?? '',
          notifications: updated.notifications,
        }));
      } else {
        toast.error('Could not save profile.');
      }
    } catch {
      toast.error('Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader className="animate-spin h-8 w-8 text-gray-600" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6 text-foreground">Account Settings</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
            Full Name
          </label>
          <div className="relative">
            <input
              type="text"
              id="name"
              name="name"
              value={settings.name}
              onChange={handleInputChange}
              required
              className="pl-10 w-full px-4 py-2 border border-border bg-background text-foreground rounded-md focus:ring-green-500 focus:border-green-500"
            />
            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={18} />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
            Email Address
          </label>
          <div className="relative">
            <input
              type="email"
              id="email"
              name="email"
              value={settings.email}
              readOnly
              disabled
              className="pl-10 w-full px-4 py-2 border border-border rounded-md bg-muted text-muted-foreground cursor-not-allowed"
            />
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={18} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Email is tied to sign-in and cannot be changed here.</p>
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-1">
            Phone Number
          </label>
          <div className="relative">
            <input
              type="tel"
              id="phone"
              name="phone"
              value={settings.phone}
              onChange={handleInputChange}
              className="pl-10 w-full px-4 py-2 border border-border bg-background text-foreground rounded-md focus:ring-green-500 focus:border-green-500"
            />
            <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={18} />
          </div>
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-foreground mb-1">
            Address
          </label>
          <div className="relative">
            <input
              type="text"
              id="address"
              name="address"
              value={settings.address}
              onChange={handleInputChange}
              className="pl-10 w-full px-4 py-2 border border-border bg-background text-foreground rounded-md focus:ring-green-500 focus:border-green-500"
            />
            <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={18} />
          </div>
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="notifications"
            name="notifications"
            checked={settings.notifications}
            onChange={handleInputChange}
            className="h-4 w-4 text-green-600 focus:ring-green-500 border-border bg-background rounded"
          />
          <label htmlFor="notifications" className="ml-2 block text-sm text-foreground">
            Receive email notifications
          </label>
        </div>

        <Button type="submit" className="w-full bg-green-500 hover:bg-green-600 text-white" disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </form>
    </div>
  );
}
