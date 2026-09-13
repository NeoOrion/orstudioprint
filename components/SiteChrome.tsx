import Link from "next/link";

type ActiveSection = "pecas" | "resina";

function BrandLockup() {
  return <Link className="brand-lockup" href="/"><img src="/brand/orstudio-print-mark.svg" alt="" /><span className="brand-wordmark"><span>OrStudio</span><span className="brand-wordmark-accent"> Print</span></span></Link>;
}

export function SiteHeader({ active }: { active?: ActiveSection }) {
  return <header className="site-header"><nav aria-label="Principal"><BrandLockup /><Link className="site-nav-link" href="/pecas" aria-current={active === "pecas" ? "page" : undefined}>Peças</Link><Link className="site-nav-link" href="/resina" aria-current={active === "resina" ? "page" : undefined}>Resina</Link></nav></header>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="footer-brand"><img src="/brand/orstudio-print-mark.svg" alt="" /><strong>OrStudio Print</strong></div><p>Base em Curitiba, PR · Projetos de todo o Brasil podem ser avaliados.</p></footer>;
}
