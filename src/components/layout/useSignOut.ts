import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { destroySocket } from '../../lib/socket'

/** Shared sign-out: tears down the realtime socket, clears auth, redirects to /login. */
export function useSignOut() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  return function signOut() {
    destroySocket()
    logout()
    navigate('/login', { replace: true })
  }
}
