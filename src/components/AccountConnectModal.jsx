import { useState, useEffect, useRef } from 'react';
import { startAuth, pollAuth, submit2FA } from '../api';

export default function AccountConnectModal({ open, onClose, onConnected }) {
  const [tab, setTab] = useState('mobile'); // 'mobile' | 'email'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('form'); // 'form' | '2fa' | 'mobile_pending'
  const [attemptId, setAttemptId] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [mobileLink, setMobileLink] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const reset = () => {
    setEmail('');
    setPassword('');
    setError('');
    setStep('form');
    setAttemptId('');
    setTwoFACode('');
    setMobileLink('');
    setLoading(false);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleEmailAuth = async () => {
    if (!email || !password) return setError('Email and password required');
    setLoading(true);
    setError('');
    try {
      const res = await startAuth({
        auth_type: 'email_password',
        email,
        password,
      });
      setAttemptId(res.attempt_id || res.id);
      if (res.twoFactorPending) {
        setStep('2fa');
      } else if (res.status === 'connected' || res.status === 'active') {
        onConnected();
        handleClose();
      } else {
        // Poll for completion
        startPolling(res.attempt_id || res.id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMobileAuth = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await startAuth({ auth_type: 'mobile_app' });
      setAttemptId(res.attempt_id || res.id);
      setMobileLink(res.mobile_auth_session_deeplink || '');
      setStep('mobile_pending');
      startPolling(res.attempt_id || res.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async () => {
    if (!twoFACode) return;
    setLoading(true);
    setError('');
    try {
      const res = await submit2FA(attemptId, twoFACode);
      if (res.status === 'connected' || res.status === 'active') {
        onConnected();
        handleClose();
      } else {
        startPolling(attemptId);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await pollAuth(id);
        if (res.status === 'connected' || res.status === 'active') {
          clearInterval(pollRef.current);
          onConnected();
          handleClose();
        } else if (res.twoFactorPending) {
          clearInterval(pollRef.current);
          setStep('2fa');
        } else if (res.status === 'failed' || res.status === 'error') {
          clearInterval(pollRef.current);
          setError(res.message || 'Authentication failed');
        }
      } catch {
        // keep polling
      }
    }, 3000);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div className="card w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Connect Account</h2>
          <button onClick={handleClose} className="text-gray-500 hover:text-white text-xl">&times;</button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {step === 'form' && (
          <>
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => setTab('mobile')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === 'mobile' ? 'bg-accent text-white' : 'bg-dark-600 text-gray-400'
                }`}
              >
                Mobile App
              </button>
              <button
                onClick={() => setTab('email')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === 'email' ? 'bg-accent text-white' : 'bg-dark-600 text-gray-400'
                }`}
              >
                Email / Password
              </button>
            </div>

            {tab === 'mobile' ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Use the FansAPI Auth+ mobile app to securely connect. A QR code / link will be generated for the creator to scan.
                </p>
                <button onClick={handleMobileAuth} disabled={loading} className="btn-primary w-full">
                  {loading ? 'Starting...' : 'Generate Auth Link'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  className="input"
                  placeholder="OnlyFans email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  className="input"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button onClick={handleEmailAuth} disabled={loading} className="btn-primary w-full">
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            )}
          </>
        )}

        {step === '2fa' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">Enter the 2FA code sent to the creator's phone or email.</p>
            <input
              className="input"
              placeholder="2FA Code"
              value={twoFACode}
              onChange={(e) => setTwoFACode(e.target.value)}
              maxLength={6}
            />
            <button onClick={handle2FASubmit} disabled={loading} className="btn-primary w-full">
              {loading ? 'Verifying...' : 'Submit Code'}
            </button>
          </div>
        )}

        {step === 'mobile_pending' && (
          <div className="space-y-4 text-center">
            <div className="animate-pulse text-accent text-4xl">...</div>
            <p className="text-sm text-gray-400">
              Waiting for creator to authenticate via the mobile app.
            </p>
            {mobileLink && (
              <div className="bg-dark-600 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Share this link with the creator:</p>
                <p className="text-xs text-accent break-all select-all">{mobileLink}</p>
              </div>
            )}
            <button onClick={handleClose} className="btn-ghost w-full">Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
