import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AuthCallback() {
  const [params] = useSearchParams()
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const token = params.get('token')
    const error = params.get('error')

    if (error || !token) {
      navigate(`/login?error=${error ?? 'auth_failed'}`, { replace: true })
      return
    }

    login(token)
    navigate('/', { replace: true })
  }, [params, login, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-200)] dark:bg-[var(--bg-100)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-[var(--accent-200)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500 dark:text-[var(--text-200)]">Signing you in…</p>
      </div>
    </div>
  )
}
