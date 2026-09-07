"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const PreviewContext = createContext<{ thumbnails: Record<string, string | null>; activeClipId: string | null; setActiveClipId: (id: string | null) => void }>({ thumbnails: {}, activeClipId: null, setActiveClipId: () => {} });
export const useClipPreviews = () => useContext(PreviewContext);
const thumbnails: Record<string, string | null> = {};

export function ClipPreviewProvider({ children }: { children: ReactNode }) {
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  // Metadata is loaded by the selected player. There is no bulk preview endpoint.
  const value = useMemo(() => ({ thumbnails, activeClipId, setActiveClipId }), [activeClipId]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}
