import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OrStudio Print · Impressão 3D sob medida",
  description: "Simulação de preço para projetos de impressão 3D sob medida em Curitiba e região.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
