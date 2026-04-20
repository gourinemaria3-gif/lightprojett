// src/hooks/useAuth.js
// Décode le JWT stocké dans localStorage pour exposer les infos utilisateur

export function useAuth() {
  const token = localStorage.getItem("jwt");
  if (!token) return { user: null };

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return {
      user: {
        id:      payload.userId,
        name:    payload.name,
        email:   payload.email,
        isAdmin: payload.isAdmin === true,
      },
    };
  } catch {
    return { user: null };
  }
}