'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardHat, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const BACKGROUNDS = ['/login-bg/bg-1.png', '/login-bg/bg-2.png', '/login-bg/bg-3.png'];

export function LoginPage() {
  const login = usePilingStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setBgIndex((i) => (i + 1) % BACKGROUNDS.length), 12000);
    return () => clearInterval(id);
  }, []);

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
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-slate-900">
      <AnimatePresence>
        <motion.div
          key={bgIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0 bg-no-repeat bg-center"
          style={{ backgroundImage: `url(${BACKGROUNDS[bgIndex]})`, backgroundSize: '85% auto' }}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-slate-900/40" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-sm md:max-w-md md:-translate-x-[8cm]"
      >
        <div className="bg-slate-900/50 backdrop-blur-xl rounded-3xl border border-white/15 shadow-2xl p-6 md:p-10 md:pt-12 md:pb-16">
          <div className="flex items-center justify-center md:justify-start gap-4 mb-6 md:mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/30 shrink-0">
              <HardHat className="w-7 h-7 md:w-8 md:h-8" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
                <span className="text-white">Piling</span>
                <span className="text-sky-400">Track</span>
              </h1>
              <p className="text-xs md:text-sm text-slate-300 mt-0.5">Управление свайными работами</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-200 text-sm">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                <Input
                  id="email"
                  type="email"
                  placeholder="operator@piling.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12 md:h-13 bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-sky-400/30"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-200 text-sm">Пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-12 md:h-13 bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-sky-400/30"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 z-10"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 md:h-13 bg-blue-600 hover:bg-blue-700 text-white font-medium text-base shadow-lg shadow-blue-600/30"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Войти'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-white/70 mt-6 drop-shadow">
          © 2026 PilingTrack — Система управления свайными работами
        </p>
      </motion.div>
    </div>
  );
}
