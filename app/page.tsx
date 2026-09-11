import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-card">
        <p className="eyebrow">Experimento de validação</p>
        <h1>OrStudio Print — validação técnica</h1>
        <p>Este ambiente contém o harness técnico do formulário de projetos.</p>
        <Link className="primary-link" href="/intake">Abrir formulário técnico</Link>
      </section>
    </main>
  );
}
