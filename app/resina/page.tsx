import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { IntakeForm } from "@/components/intake/IntakeForm";

export const metadata: Metadata = { title: "Resina · OrStudio Print" };

export default function ResinaPage() {
  return <><SiteHeader /><main className="public-shell">
    <section className="public-hero"><p className="eyebrow">Impressão 3D em resina · Curitiba e região</p><h1>Quer imprimir uma miniatura ou peça detalhada?</h1><p>Envie o arquivo 3D, a escala ou altura e a quantidade. Avaliamos o projeto para preparar uma simulação de preço em resina.</p><a className="primary-link" href="#simulacao">Simular em resina</a><small>Você recebe uma simulação por e-mail. Nesta fase não há cobrança, pedido ou reserva de produção.</small><p className="scan-line">Miniaturas · Figuras · Bustos · Peças detalhadas</p><figure className="hero-image"><img src="/images/resina-hero.webp" alt="Grupo ilustrativo de miniaturas detalhadas para impressão em resina." /><figcaption>Imagem ilustrativa</figcaption></figure></section>
    <section className="use-cases"><h2>Para projetos em que os detalhes fazem diferença</h2><ul><li>miniaturas e peças para hobby, RPG ou wargames;</li><li>bustos, figuras e peças de coleção;</li><li>componentes pequenos com superfícies e detalhes finos;</li><li>uma ou várias peças do mesmo projeto para avaliar em conjunto.</li></ul></section>
    <section className="steps"><h2>Do arquivo à simulação</h2><ol><li><strong>Envie o arquivo</strong><p>Arquivo próprio/autorizado ou link, escala/altura e quantidade.</p></li><li><strong>Nós avaliamos o projeto</strong><p>Volume, suportes, quantidade e trabalho de pós-processamento necessário.</p></li><li><strong>Receba a simulação por e-mail</strong><p>Um valor específico para o seu projeto. Nesta fase não há cobrança nem produção.</p></li></ol></section>
    <section className="trust-panel"><h2>Seu arquivo fica privado — e os direitos continuam sendo seus.</h2><p>Usamos o arquivo apenas para avaliar e estimar o projeto. Não publicamos, revendemos nem adicionamos a catálogo. Nesta validação, só consideramos arquivos que você tenha direito ou autorização para reproduzir fisicamente.</p></section>
    <section id="simulacao" className="intake-section"><h2>Vamos avaliar seu projeto em resina</h2><p>Escala, quantidade e qualidade do arquivo ajudam a tornar a simulação mais fiel ao projeto.</p><p className="disclosure">Fase de validação: nesta etapa você recebe uma simulação de preço. Não há cobrança, pedido, reserva ou início de produção.</p><IntakeForm initialBranch="RESIN" lockBranch /></section>
  </main><SiteFooter /></>;
}