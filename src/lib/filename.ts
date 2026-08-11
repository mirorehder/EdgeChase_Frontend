/** Leitet einen Drive-tauglichen Dateinamen aus dem Hook-Text ab. */
export function hookTextToFileName(hookText: string): string {
  const slug = hookText
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, "") // Sonderzeichen raus
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const truncated = slug.slice(0, 80).replace(/-+$/g, "");

  return `${truncated}.mp4`;
}
