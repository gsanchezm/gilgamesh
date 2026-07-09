// Shape of a per-view i18n dictionary module. Each module default-exports one of these; `index.ts`
// merges them all. A module owns its own key namespace (prefix), so two Phase-2 groups editing
// different modules can never collide — and `index.ts` pre-registers every module up front, so
// filling a module later needs NO edit to any shared file.
export interface ViewDict {
  es: Record<string, string>;
  en: Record<string, string>;
}
