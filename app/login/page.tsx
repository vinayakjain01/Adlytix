'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoginScreen } from '@/components/auth/login-screen';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { status } = useAuth();
  const router = useRouter();

  // Someone arriving here with a live session goes straight through.
  useEffect(() => {
    if (status === 'authenticated') router.replace('/overview');
  }, [status, router]);

  return <LoginScreen />;
}
