import { createContext, useContext, useState, type ReactNode } from 'react';

interface QuantCtx {
  quant: boolean;
  setQuant: (v: boolean) => void;
  toggleQuant: () => void;
}

const Ctx = createContext<QuantCtx>({ quant: false, setQuant: () => {}, toggleQuant: () => {} });

export function QuantModeProvider({ children }: { children: ReactNode }) {
  const [quant, setQuant] = useState(false);
  return <Ctx.Provider value={{ quant, setQuant, toggleQuant: () => setQuant(v => !v) }}>{children}</Ctx.Provider>;
}

export const useQuantMode = () => useContext(Ctx);
