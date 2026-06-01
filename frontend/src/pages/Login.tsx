import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'

export default function Login() {
  const [params] = useSearchParams()
  const errorCode = params.get('error')
  const errorMessage =
    errorCode === 'unauthorized_domain'
      ? 'Access denied. Please sign in with an @outdoorequipped.com or @channelprecision.com account.'
      : errorCode === 'auth_failed'
        ? 'Authentication failed. Please try again.'
        : errorCode
          ? 'Unable to sign in. Please try again.'
          : null

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google'
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-[var(--bg-200)] px-4 py-8 text-[var(--text-100)] sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[var(--bg-200)]" />
        <div className="absolute inset-0 bg-[var(--primary-100)] opacity-40" />
        <div className="absolute left-[-9rem] top-16 h-[23rem] w-[23rem] rounded-full border border-[var(--primary-200)] bg-[var(--primary-100)] opacity-50" />
        <div className="absolute right-[-8rem] top-[-6rem] h-[22rem] w-[22rem] rounded-full border border-[var(--accent-100)] bg-[var(--primary-100)] opacity-45" />
        <div className="absolute bottom-[-10rem] left-1/3 h-[24rem] w-[24rem] rounded-full border border-[var(--primary-200)] bg-[var(--accent-100)] opacity-35" />

        <DotCluster className="-left-28 top-16 h-80 w-80 opacity-45" />
        <DotCluster className="left-40 -top-24 h-72 w-72 opacity-35" />
        <DotCluster className="-left-24 bottom-8 h-80 w-80 opacity-40" />
        <DotCluster className="right-[-7.5rem] top-20 h-80 w-80 opacity-42" />
        <DotCluster className="right-[-8rem] bottom-[-3rem] h-72 w-72 opacity-35" />

        <svg
          viewBox="0 0 1200 700"
          className="absolute inset-0 h-full w-full text-[var(--accent-100)] opacity-60"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 155H278c42 0 76-34 76-76V0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.55"
          />
          <path
            d="M1200 62H905c-56 0-102 46-102 102v56c0 56-46 102-102 102H548"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.45"
          />
          <path
            d="M0 622h280c54 0 98 44 98 98"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.4"
          />
          <path
            d="M1200 470H928c-58 0-104-46-104-104V258c0-58-46-104-104-104H620"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.35"
          />
        </svg>
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-[0_30px_60px_-38px_rgba(59,60,61,0.45)] backdrop-blur-sm lg:grid-cols-[1.18fr_0.82fr]">
          <section className="relative overflow-hidden bg-[var(--bg-100)] p-8 text-[var(--text-100)] lg:p-10">
            <div className="absolute inset-0 bg-[var(--bg-100)]" />
            <div className="absolute -right-24 top-[-4rem] h-72 w-72 rounded-full border border-[var(--primary-200)] bg-[var(--primary-100)] opacity-45" />
            <div className="absolute -left-20 bottom-[-7rem] h-72 w-72 rounded-full border border-[var(--accent-100)] bg-[var(--primary-100)] opacity-35" />
            <div className="relative">
              <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-[var(--primary-200)] bg-[var(--primary-100)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-200)]">
                Supplier Management Console
              </div>

              <div className="mb-6 flex items-center gap-4">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-2 shadow-lg shadow-[rgba(59,60,61,0.2)]">
                  <img src="/ship-queue-logo.svg" alt="Ship Queue logo" className="h-full w-full object-contain" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-200)]">Internal Platform</p>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-100)] sm:text-3xl">Ship Queue</h1>
                </div>
              </div>

              <h2 className="max-w-xl text-2xl font-semibold leading-tight text-[var(--text-100)] sm:text-3xl">
                Pull ShipStation orders and generate shipping labels in bulk without workflow chaos.
              </h2>

              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--text-200)] sm:text-base">
                Built for Supplier Management Order Takers to queue incoming orders, generate labels at scale, and keep outbound processing consistent.
              </p>

              <div className="mt-8 grid gap-3 text-sm text-[var(--text-200)] sm:grid-cols-2">
                <FeaturePill label="Google-secured access" />
                <FeaturePill label="ShipStation order sync" />
                <FeaturePill label="Bulk label generation" />
                <FeaturePill label="Admin-managed permissions" />
              </div>

              <div className="mt-8 rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-200)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-200)]">Workflow Snapshot</p>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2">
                    <span className="text-[var(--text-200)]">1. Pull new orders from ShipStation</span>
                    <span className="rounded-md bg-[var(--primary-100)] px-2 py-0.5 text-xs text-[var(--accent-200)]">Sync</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2">
                    <span className="text-[var(--text-200)]">2. Build bulk batches for labels</span>
                    <span className="rounded-md bg-[var(--primary-100)] px-2 py-0.5 text-xs text-[var(--accent-200)]">Batch</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2">
                    <span className="text-[var(--text-200)]">3. Export and finalize shipments</span>
                    <span className="rounded-md bg-[var(--primary-100)] px-2 py-0.5 text-xs text-[var(--accent-200)]">Ready</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="relative bg-[var(--bg-200)] p-6 sm:p-8 lg:p-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(113,196,239,0.16),transparent_40%)]" />

            <div className="relative rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-[0_24px_50px_-28px_rgba(59,60,61,0.35)] backdrop-blur sm:p-7">
              <div className="mb-5 h-1 w-14 rounded-full bg-[var(--accent-100)]" />
              <p className="inline-flex rounded-full border border-[var(--primary-200)] bg-[var(--primary-100)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-200)]">
                Sign In
              </p>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--text-100)]">Welcome back</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-200)]">
                Continue with your company Google account to open the Supplier Management order queue.
              </p>

              {errorMessage && (
                <div className="notice-card notice-card--error mt-6 flex items-start gap-2.5 text-sm">
                  <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                  </svg>
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                onClick={handleGoogleLogin}
                type="button"
                className="mt-6 flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-[var(--accent-200)] bg-[var(--accent-200)] dark:border-[var(--accent-100)] dark:bg-[var(--accent-100)] px-4 py-3 text-sm font-semibold text-white dark:text-[var(--text-100)] shadow-sm transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-md active:translate-y-0"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="mt-8 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)] p-4 text-xs leading-relaxed text-[var(--text-200)]">
                Access is limited to verified team members from <span className="font-semibold text-[var(--text-100)]">@outdoorequipped.com</span> and <span className="font-semibold text-[var(--text-100)]">@channelprecision.com</span>.
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function FeaturePill({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-2">
      <svg className="h-4 w-4 shrink-0 text-[var(--accent-100)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.34 7.34a1 1 0 01-1.42 0l-3.648-3.647a1 1 0 011.414-1.414l2.938 2.938 6.633-6.633a1 1 0 011.423-.003z" clipRule="evenodd" />
      </svg>
      <span className="text-sm text-[var(--text-100)]">{label}</span>
    </div>
  )
}

function DotCluster({ className }: { className: string }) {
  const id = useId().replace(/:/g, '')

  return (
    <svg viewBox="0 0 240 240" className={`absolute ${className}`} aria-hidden="true">
      <defs>
        <pattern id={`dot-pattern-${id}`} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="6.1" fill="none" stroke="rgba(148,163,184,0.42)" strokeWidth="1.2" />
        </pattern>
        <clipPath id={`dot-clip-${id}`}>
          <circle cx="120" cy="120" r="112" />
        </clipPath>
      </defs>
      <rect width="240" height="240" fill={`url(#dot-pattern-${id})`} clipPath={`url(#dot-clip-${id})`} />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
