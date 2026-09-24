/**
 * Prefix a site-relative path with the configured base path, so links work
 * both at a domain root and under a sub-folder such as /FirstNight/ on
 * GitHub Pages. Always use this for files in public/ and internal links.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
