import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OrStudio Print — validação técnica",
  description: "Formulário técnico para avaliar projetos de impressão 3D.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
