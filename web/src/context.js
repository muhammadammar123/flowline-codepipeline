import { createContext, useContext } from 'react';
export const SessionCtx = createContext(null);
export const useApp = () => useContext(SessionCtx);
