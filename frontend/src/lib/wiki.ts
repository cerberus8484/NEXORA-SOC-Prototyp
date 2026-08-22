/** In-app Nexora route for the internal operator wiki. */
export function wikiUrl(slug?: string): string {
  const clean = String(slug ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  return clean ? `/wiki/${clean}` : '/wiki';
}

/** The internal wiki is always available as a Nexora page. */
export function hasWiki(): boolean {
  return true;
}
