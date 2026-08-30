import { FOOTER_TEXT, APP_VERSION } from '../app/appMeta';

export function Footer() {
  return (
    <footer className="app-footer app-footer-wrap">
      <span />
      <span className="af-center">{FOOTER_TEXT}</span>
      <span className="mono">{APP_VERSION}</span>
    </footer>
  );
}
