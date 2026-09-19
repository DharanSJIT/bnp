import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../store/useAuth';
import { Button, Spinner } from '../components/ui.jsx';
import api, { errMsg } from '../lib/api';

export default function Register() {
  const { register, loginError, loggingIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', otp: '' });
  const [show, setShow] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [otpStep, setOtpStep] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const requestOtp = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setLocalError('Please complete all fields.');
      return;
    }
    if (form.password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setLocalError('Passwords do not match.');
      return;
    }
    setSendingOtp(true);
    try {
      await api.post('/auth/send-otp', { email: form.email });
      setOtpStep(true);
    } catch (err) {
      setLocalError(errMsg(err, 'Could not send OTP'));
    } finally {
      setSendingOtp(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!form.otp) {
      setLocalError('Please enter the OTP.');
      return;
    }
    try {
      await register({ name: form.name, email: form.email, password: form.password, otp: form.otp });
      navigate('/dashboard', { replace: true });
    } catch {
      /* loginError surfaced below */
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ledger-panel px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-md rounded-panel border border-ledger-line bg-white p-8 shadow-panel"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ledger-accent text-lg font-bold text-white">R</span>
          <div>
            <h1 className="text-header-lg font-bold leading-tight">
              Create your account
            </h1>
            <p className="text-small text-ledger-meta">Register to start reconciling</p>
          </div>
        </div>

        {!otpStep ? (
          <form onSubmit={requestOtp} className="space-y-4">
            <div>
              <label className="label" htmlFor="name">Full name</label>
              <input id="name" className="input" placeholder="Jane Operator" value={form.name} onChange={set('name')} autoComplete="name" required />
            </div>
            <div>
              <label className="label" htmlFor="reg-email">Email</label>
              <input id="reg-email" type="email" className="input" placeholder="you@onerecon.io" value={form.email} onChange={set('email')} autoComplete="email" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password</label>
                <input type={show ? 'text' : 'password'} className="input" placeholder="••••••" value={form.password} onChange={set('password')} autoComplete="new-password" required minLength={6} />
              </div>
              <div>
                <label className="label">Confirm</label>
                <input type={show ? 'text' : 'password'} className="input" placeholder="••••••" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
              </div>
            </div>
            <div className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-2.5 text-small text-ledger-meta">
              Account type: <b className="text-ledger-ink">Report user</b> — you can create workflows, run reconciliations, and generate
              and download the reports. Role assignments are handled by your administrator.
            </div>

            <div className="flex items-center gap-2">
              <input id="show" type="checkbox" className="h-4 w-4 rounded border-ledger-line text-ledger-accent focus:ring-ledger-accent" checked={show} onChange={(e) => setShow(e.target.checked)} />
              <label htmlFor="show" className="text-small text-ledger-meta">Show passwords</label>
            </div>

            {(localError || loginError) && (
              <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">
                {localError || loginError}
              </p>
            )}

            <Button type="submit" className="w-full" size="lg" loading={sendingOtp}>
              {sendingOtp ? <><Spinner className="h-4 w-4" /> Sending OTP…</> : 'Continue'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-4">
            <p className="text-sm text-ledger-meta mb-2">We sent a 6-digit OTP to <b>{form.email}</b>. Please enter it below to verify your email.</p>
            <div>
              <label className="label" htmlFor="otp">One-Time Password</label>
              <input id="otp" type="text" className="input text-center font-mono text-lg tracking-[0.5em]" placeholder="------" maxLength={6} value={form.otp} onChange={set('otp')} required />
            </div>

            {(localError || loginError) && (
              <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">
                {localError || loginError}
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setOtpStep(false)} disabled={loggingIn}>Back</Button>
              <Button type="submit" className="flex-[2]" size="lg" loading={loggingIn}>
                {loggingIn ? <><Spinner className="h-4 w-4" /> Verifying…</> : 'Verify & Register'}
              </Button>
            </div>
          </form>
        )}

        <div className="mt-6 border-t border-ledger-line pt-4">
          <p className="text-small text-ledger-meta">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-ledger-accent hover:text-ledger-accentHover">Sign in</Link>
          </p>
          <p className="mt-2 text-small text-ledger-meta">
            Back to{' '}
            <Link to="/" className="font-medium text-ledger-accent hover:text-ledger-accentHover">home</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}