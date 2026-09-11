import Link from "next/link";

export function SiteHeader() {
  return <header className="site-header"><nav aria-label="Principal">
    <Link href="/">OrStudio Print</Link><Link href="/pecas">Peças</Link><Link href="/resina">Resina</Link>
  </nav></header>;
}
export function SiteFooter() { return <footer className="site-footer">OrStudio Print · Impressão 3D sob medida</footer>; }
