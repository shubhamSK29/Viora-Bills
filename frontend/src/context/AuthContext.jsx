/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react'
import {
  authApi,
  getStoredToken,
  getStoredUser,
  storeSession,
  clearSession,
} from '../services/api'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    const token = getStoredToken()
    const user = getStoredUser()
    return token && user ? user : null
  })

  const [authChecked, setAuthChecked] = useState(() => {
    const token = getStoredToken()
    const user = getStoredUser()
    return !(token && user)
  })

  useEffect(() => {
    const token = getStoredToken()
    const user = getStoredUser()
    if (!token || !user) {
      return
    }

    let ignore = false
    authApi
      .me()
      .then((data) => {
        if (!ignore && data?.user) {
          setCurrentUser(data.user)
          storeSession(token, data.user)
        } else if (!ignore) {
          clearSession()
          setCurrentUser(null)
        }
      })
      .catch(() => {
        if (!ignore) {
          clearSession()
          setCurrentUser(null)
        }
      })
      .finally(() => {
        if (!ignore) {
          setAuthChecked(true)
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  const login = async (email, password) => {
    const data = await authApi.login(email.trim(), password)
    storeSession(data.access_token, data.user)
    setCurrentUser(data.user)
    setAuthChecked(true)
    return data.user
  }

  const register = async (payload) => {
    const data = await authApi.register(payload)
    if (data?.access_token && data?.user) {
      storeSession(data.access_token, data.user)
      setCurrentUser(data.user)
      setAuthChecked(true)
    }
    return data
  }

  const logout = async () => {
    try {
      await authApi.logout()
    } catch {
      // Ignore network errors during logout
    }
    clearSession()
    setCurrentUser(null)
  }

  const userRole = currentUser?.role || 'staff'

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userRole,
        authChecked,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
