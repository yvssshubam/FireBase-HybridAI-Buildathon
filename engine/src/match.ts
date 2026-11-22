/** Lowercase, non-alphanumerics → single spaces. Non-Latin names normalize to "". */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Equal, or one contains the other as whole words ("biryani" ~ "chicken biryani"). */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  const wa = ` ${na} `;
  const wb = ` ${nb} `;
  return wa.includes(wb) || wb.includes(wa);
}
