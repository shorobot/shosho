// Category glyphs from the canvas (Home A rail), keyed by slug. Unknown slugs fall back to the kana.
const ICONS: Record<string, React.ReactNode> = {
  sets: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><rect x="4" y="9" width="28" height="20" rx="4" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><circle cx="12" cy="16" r="3.2" fill="#F26B21"/><circle cx="24" cy="16" r="3.2" fill="#2E86D6"/><circle cx="12" cy="24" r="3.2" fill="#2E86D6"/><circle cx="24" cy="24" r="3.2" fill="#F26B21"/><path d="M4 13h28" stroke="#16192B" strokeWidth="1.2" opacity=".35"/></svg>
  ),
  sushi: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><rect x="5" y="18" width="26" height="10" rx="5" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><path d="M5 19c3-6 9-9 13-9s10 3 13 9c-4 2-8 2-13 2s-9 0-13-2z" fill="#F26B21" stroke="#16192B" strokeWidth="1.6" strokeLinejoin="round"/><path d="M11 14c3 1 8 1 13-1" stroke="#fff" strokeWidth="1.4" opacity=".7"/></svg>
  ),
  rolls: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><circle cx="18" cy="18" r="13" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><circle cx="18" cy="18" r="9.5" fill="#16192B"/><circle cx="18" cy="18" r="7.5" fill="#FBF7F2"/><circle cx="18" cy="18" r="4" fill="#F26B21"/><circle cx="14" cy="14.5" r="1.6" fill="#8FC4EE"/><circle cx="22" cy="21" r="1.6" fill="#8FC4EE"/></svg>
  ),
  onigiri: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><path d="M18 5c2 0 3.4 1.4 4.4 3l7.4 13.6c1.6 3 .1 6.4-3.4 6.4H9.6c-3.5 0-5-3.4-3.4-6.4L13.6 8c1-1.6 2.4-3 4.4-3z" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><rect x="12" y="19" width="12" height="9" rx="2" fill="#16192B"/><circle cx="18" cy="14" r="1.4" fill="#F26B21"/></svg>
  ),
  udon: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><path d="M4 17h28c0 7-6 12-14 12S4 24 4 17z" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><path d="M9 17c2-3 4-1 6-4M15 17c2-3 4-1 6-4M21 17c2-3 4-1 6-4" stroke="#F26B21" strokeWidth="1.7" strokeLinecap="round"/><path d="M6 21h24" stroke="#16192B" strokeWidth="1.2" opacity=".3"/></svg>
  ),
  ramen: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><path d="M4 17h28c0 7-6 12-14 12S4 24 4 17z" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><circle cx="13" cy="20" r="3.6" fill="#fff" stroke="#16192B" strokeWidth="1.4"/><circle cx="13" cy="20" r="1.7" fill="#F26B21"/><path d="M21 17.5c1.6 0 3 1.2 3 2.8s-1.4 2.8-3 2.8-3-1.2-3-2.8" stroke="#16192B" strokeWidth="1.4" fill="none"/><path d="M11 12c1-2 3-2 4-4M19 12c1-2 3-2 4-4" stroke="#16192B" strokeWidth="1.4" strokeLinecap="round" opacity=".45"/></svg>
  ),
  donburi: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><path d="M5 18h26c0 6.5-5.5 11-13 11S5 24.5 5 18z" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><path d="M9 18c0-5 4-8 9-8s9 3 9 8" fill="#F26B21" stroke="#16192B" strokeWidth="1.6"/><circle cx="15" cy="14" r="1.5" fill="#fff"/><circle cx="21" cy="15" r="1.5" fill="#fff"/></svg>
  ),
  menus: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><rect x="4" y="8" width="28" height="21" rx="4" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><path d="M18 8v21" stroke="#16192B" strokeWidth="1.4"/><circle cx="11" cy="15" r="3.4" fill="#F26B21"/><rect x="7.5" y="21" width="7" height="4.5" rx="2" fill="#8FC4EE"/><rect x="21.5" y="12" width="7" height="5" rx="2" fill="#2E86D6"/><rect x="21.5" y="20" width="7" height="5.5" rx="2" fill="#F6CFD8"/></svg>
  ),
  drinks: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><path d="M11 12h14l-2 16a3 3 0 0 1-3 2.6h-4A3 3 0 0 1 13 28L11 12z" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><path d="M12 18h12" stroke="#2E86D6" strokeWidth="1.6"/><path d="M21 12 24 4" stroke="#F26B21" strokeWidth="2" strokeLinecap="round"/><rect x="9.5" y="9.5" width="17" height="3.4" rx="1.7" fill="#16192B"/></svg>
  ),
  desserts: (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden><circle cx="11" cy="22" r="6" fill="#fff" stroke="#16192B" strokeWidth="1.6"/><circle cx="24" cy="22" r="6" fill="#F6CFD8" stroke="#16192B" strokeWidth="1.6"/><circle cx="17.5" cy="12.5" r="6" fill="#8FC4EE" stroke="#16192B" strokeWidth="1.6"/><circle cx="17.5" cy="12.5" r="2" fill="#fff"/></svg>
  ),
};

const TINTS = ["bg-sand", "bg-sky-tint", "bg-blush"];

export function categoryTint(index: number): string {
  return TINTS[index % TINTS.length]!;
}

export function CategoryIcon({ slug, kana, index, size = 46 }: { slug: string; kana: string | null; index: number; size?: number }) {
  const icon = ICONS[slug];
  return (
    <div className={`flex flex-none items-center justify-center rounded-full ${categoryTint(index)}`} style={{ width: size, height: size }}>
      {icon ?? <span className="kana text-[13px] font-bold text-ink">{(kana ?? slug).slice(0, 2)}</span>}
    </div>
  );
}
