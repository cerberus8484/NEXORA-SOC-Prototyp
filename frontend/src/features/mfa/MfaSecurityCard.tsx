import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Copy, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardHeader, CardBody, Badge, Button, Field, Input } from '../../components/ui';
import { mfaApi, type MfaStatus, type MfaStatusResponse } from './mfaApi';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  mfaStatusLabel, mfaStatusTone, isMfaActive,
  isValidTotpToken, isValidDisableCode,
  formatRecoveryCodes, recoveryCodesText, recoveryRemainingTone,
  nextEnrollStep, type EnrollStep,
} from './mfaView';

// MfaSecurityCard — Selbstverwaltung der eigenen TOTP-MFA.
// Geheimnisse (secret/otpauthUri/recoveryCodes) bleiben ausschließlich im
// Komponenten-State und werden weder geloggt noch persistiert.

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function MfaSecurityCard() {
  const { t: tr } = useTranslation();
  const [status, setStatus]   = useState<MfaStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Enroll-Zustandsmaschine + flüchtige Secrets dieses Durchlaufs.
  const [step, setStep]       = useState<EnrollStep>('idle');
  const [secret, setSecret]   = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [token, setToken]     = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // Disable-Flow.
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const [busy, setBusy]       = useState(false);
  const [actionError, setActionError] = useState('');

  // Fokus-Ziel der Recovery-Ansicht (step === 'done') — Fokus wandert beim
  // Schrittwechsel auf die Überschrift, damit Screenreader/Tastatur folgen.
  const recoveryHeadingRef = useRef<HTMLHeadingElement>(null);

  // Verhindert State-Updates nach Unmount (in-flight Status-Reload nach Enroll).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    mfaApi.getStatus({ signal: controller.signal })
      .then((res) => setStatus(res))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setLoadError(i18n.t('app.mfaStatusCouldNotLoaded'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  // Fokus auf die Recovery-Überschrift setzen, sobald der Schritt erreicht ist.
  useEffect(() => {
    if (step === 'done') recoveryHeadingRef.current?.focus();
  }, [step]);

  const currentStatus: MfaStatus = status?.status ?? 'none';
  const active = isMfaActive(currentStatus);

  function resetEnroll() {
    setStep('idle');
    setSecret('');
    setOtpauthUri('');
    setToken('');
    setRecoveryCodes([]);
    setActionError('');
  }

  async function startEnroll() {
    setBusy(true);
    setActionError('');
    try {
      const res = await mfaApi.enroll();
      setSecret(res.secret);
      setOtpauthUri(res.otpauthUri);
      setStep(nextEnrollStep('idle', 'enroll'));
    } catch (err) {
      setActionError(errorMessage(err, tr('app.setupCouldNotStarted')));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnroll() {
    if (!isValidTotpToken(token)) {
      setActionError(tr('app.pleaseEnter6DigitCode'));
      return;
    }
    setBusy(true);
    setActionError('');
    setStep(nextEnrollStep('showSecret', 'verify'));
    try {
      const res = await mfaApi.verify(token.replace(/\s+/g, ''));
      setRecoveryCodes(formatRecoveryCodes(res.recoveryCodes));
      setStep(nextEnrollStep('verifying', 'verified'));
    } catch (err) {
      setActionError(errorMessage(err, tr('app.invalidCodePleaseTryAgain')));
      setStep(nextEnrollStep('verifying', 'fail'));
    } finally {
      setBusy(false);
    }
  }

  async function finishEnroll() {
    // Recovery-Codes wurden angezeigt — Secrets aus dem State entfernen + Status neu laden.
    resetEnroll();
    setLoading(true);
    try {
      const res = await mfaApi.getStatus();
      if (mountedRef.current) setStatus(res);
    } catch {
      if (mountedRef.current) setLoadError(tr('app.mfaStatusCouldNotUpdated'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function submitDisable() {
    if (!isValidDisableCode(disableCode)) {
      setActionError(tr('app.pleaseEnterValidTotpRecovery'));
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await mfaApi.disable(disableCode.trim());
      setShowDisable(false);
      setDisableCode('');
      const res = await mfaApi.getStatus();
      setStatus(res);
    } catch (err) {
      setActionError(errorMessage(err, tr('mfa.disableFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={14} />{tr('mfa.totpTitle')}</span>
        }
        actions={
          loading
            ? <Badge>{tr('app.loading2')}</Badge>
            : <Badge tone={mfaStatusTone(currentStatus)} dot={active}>{mfaStatusLabel(currentStatus)}</Badge>
        }
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loadError && <ErrorText>{loadError}</ErrorText>}

          {!loading && step === 'idle' && !showDisable && (
            <StatusView
              status={status}
              active={active}
              busy={busy}
              onEnroll={() => void startEnroll()}
              onDisable={() => { setShowDisable(true); setActionError(''); }}
            />
          )}

          {step === 'showSecret' && (
            <SecretView
              secret={secret}
              otpauthUri={otpauthUri}
              token={token}
              busy={busy}
              onTokenChange={setToken}
              onVerify={() => void verifyEnroll()}
              onCancel={resetEnroll}
            />
          )}

          {step === 'verifying' && <HintText>{tr('app.checkingCode')}</HintText>}

          {step === 'done' && (
            <RecoveryView codes={recoveryCodes} onDone={() => void finishEnroll()} headingRef={recoveryHeadingRef} />
          )}

          {showDisable && (
            <DisableView
              code={disableCode}
              busy={busy}
              onCodeChange={setDisableCode}
              onConfirm={() => void submitDisable()}
              onCancel={() => { setShowDisable(false); setDisableCode(''); setActionError(''); }}
            />
          )}

          {actionError && <ErrorText>{actionError}</ErrorText>}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Teil-Ansichten ────────────────────────────────────────────────────────────

function StatusView({ status, active, busy, onEnroll, onDisable }: {
  status: MfaStatusResponse | null;
  active: boolean;
  busy: boolean;
  onEnroll: () => void;
  onDisable: () => void;
}) {
  const { t: tr } = useTranslation();
  if (active) {
    const remaining = status?.recoveryCodesRemaining;
    const total = status?.recoveryCodesTotal;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <HintText>{tr('mfa.enabledIntro')}</HintText>
        {remaining !== undefined && total !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--text-dim)' }}>{tr('app.recoveryCodesLeft')}</span>
            <Badge tone={recoveryRemainingTone(remaining, total)}>{remaining} / {total}</Badge>
          </div>
        )}
        <Button variant="danger" size="sm" disabled={busy} onClick={onDisable}>
          MFA deaktivieren
        </Button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <HintText>{tr('mfa.setupIntro')}</HintText>
      <Button variant="primary" size="sm" disabled={busy} onClick={onEnroll}>
        {busy ? tr('text.starting') : 'MFA einrichten'}
      </Button>
    </div>
  );
}

function SecretView({ secret, otpauthUri, token, busy, onTokenChange, onVerify, onCancel }: {
  secret: string;
  otpauthUri: string;
  token: string;
  busy: boolean;
  onTokenChange: (v: string) => void;
  onVerify: () => void;
  onCancel: () => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <HintText>{tr('mfa.scanQr')}</HintText>

      {otpauthUri && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {/* Weißer Hintergrund + Quiet-Zone → zuverlässig scanbar trotz Dark-Theme. */}
          <div style={{ background: '#ffffff', padding: 12, borderRadius: 'var(--radius-sm)', lineHeight: 0 }}>
            <QRCodeSVG value={otpauthUri} size={180} level="M" marginSize={2} />
          </div>
        </div>
      )}

      <Field label={tr('app.secretKeyBase32')}>
        <CopyableValue value={secret} mono />
      </Field>

      <Field label="otpauth-URI (alternativ)">
        <CopyableValue value={otpauthUri} mono small />
      </Field>

      <Field label={tr('app.codeFromApp6Digits')}>
        <Input
          mono
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123456"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" disabled={busy || !isValidTotpToken(token)} onClick={onVerify}>
          {busy ? tr('app.checking') : tr('app.confirmActivate')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function RecoveryView({ codes, onDone, headingRef }: {
  codes: string[];
  onDone: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const { t: tr } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3
        ref={headingRef}
        tabIndex={-1}
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--warning) 12%, transparent), color-mix(in srgb, var(--warning) 5%, transparent))',
          border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 12px',
          margin: 0,
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.5,
          color: 'var(--text)',
          outline: 'none',
        }}
      >
        <strong style={{ color: 'var(--warning)' }}>{tr('app.saveThemSomewhereSafeNow')}</strong>{' '}
        Diese Recovery-Codes werden <strong>{tr('text.oneTimeOnly')}</strong>{tr('mfa.recoveryOnce')}</h3>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        background: 'var(--bg-input)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
      }}>
        {codes.map((code) => (
          <span key={code} style={{ color: 'var(--text)' }}>{code}</span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <CopyButton text={recoveryCodesText(codes)} label={tr('mfa.copyCodes')} />
        <Button variant="primary" size="sm" onClick={onDone}>{tr('mfa.savedThem')}</Button>
      </div>
    </div>
  );
}

function DisableView({ code, busy, onCodeChange, onConfirm, onCancel }: {
  code: string;
  busy: boolean;
  onCodeChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <HintText>{tr('mfa.disableIntro')}</HintText>
      <Field label={tr('app.totpRecoveryCode')}>
        <Input
          mono
          inputMode="text"
          autoComplete="one-time-code"
          placeholder={tr('app.123456AbcdEfgh')}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" size="sm" disabled={busy || !isValidDisableCode(code)} onClick={onConfirm}>
          {busy ? tr('text.disabling') : tr('mfa.disable')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

// ── Bausteine ─────────────────────────────────────────────────────────────────

function CopyableValue({ value, mono = false, small = false }: { value: string; mono?: boolean; small?: boolean }) {
  const { t: tr } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
      <code style={{
        flex: 1,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontSize: small ? 11 : 13,
        wordBreak: 'break-all',
        background: 'var(--bg-input)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--radius-sm)',
        padding: '6px 8px',
        color: 'var(--text)',
      }}>
        {value}
      </code>
      <CopyButton text={value} label={tr('common.copy')} iconOnly />
    </div>
  );
}

const COPY_FEEDBACK_MS = 2000;

function CopyButton({ text, label, iconOnly = false }: { text: string; label: string; iconOnly?: boolean }) {
  const { t: tr } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timer beim Unmount aufräumen — kein setState nach Unmount.
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  function copy() {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    });
  }
  const icon = copied ? <Check size={13} /> : <Copy size={13} />;
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={icon}
      title={label}
      onClick={copy}
    >
      {iconOnly ? undefined : (copied ? tr('common.copied') : label)}
    </Button>
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.55 }}>{children}</div>;
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <div role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{children}</div>;
}
