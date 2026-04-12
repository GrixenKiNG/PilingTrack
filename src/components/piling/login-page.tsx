'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { HardHat, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const login = usePilingStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Заполните email и пароль');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Неверный email или пароль');
      }

      const data = await res.json();
      login(data.user);
      toast.success(`Добро пожаловать, ${data.user.name}!`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500 text-white mb-4 shadow-lg shadow-orange-500/25">
            <HardHat className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">PilingTrack</h1>
          <p className="text-sm text-slate-500 mt-1">Управление свайными работами</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="operator@piling.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-12"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-medium"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Войти'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          © 2025 PilingTrack - Система управления свайными работами
        </p>
      </motion.div>
    </div>
  );
}
