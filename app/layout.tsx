import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OrStudio Print · Impressão 3D sob medida",
  description: "Simulação de preço para projetos de impressão 3D sob medida.",
  icons: { icon: "/brand/orstudio-print-mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
