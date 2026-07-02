import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'

/** Shared sign-out: clears auth (which also tears down the realtime socket), redirects to /login. */
export function useSignOut() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  return function signOut() {
    logout()
    navigate('/login', { replace: true })
  }
}
