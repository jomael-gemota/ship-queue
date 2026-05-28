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
    <div className="min-h-screen bg-slate-100 dark:bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo + heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-50 dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-300/70 dark:border-gray-800 mb-4 p-2">
            <img src="/ship-queue-logo.svg" alt="Ship Queue logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            Ship Queue
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Internal shipping & label management tool
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-50 dark:bg-gray-900 rounded-2xl border border-slate-300/70 dark:border-gray-800 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Sign in
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Use your company Google account to continue.
          </p>

          {/* Error banner */}
          {errorMessage && (
            <div className="mb-5 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
              {errorMessage}
            </div>
          )}

          {/* Google sign-in button */}
          <button
            onClick={handleGoogleLogin}
            type="button"
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm hover:bg-slate-200/80 dark:hover:bg-gray-700 active:scale-[0.98] transition-all duration-150 cursor-pointer"
          >
            <GoogleIcon />
            Sign in with Google
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-6">
          Access is restricted to authorized team members only.
        </p>
      </div>
    </div>
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
