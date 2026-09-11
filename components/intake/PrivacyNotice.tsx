export function PrivacyNotice() {
  return (
    <section className="privacy-panel" aria-labelledby="privacy-title">
      <h2 id="privacy-title">Como usamos seus dados</h2>
      <p>
        Usaremos os dados e arquivos enviados para analisar seu projeto, preparar e enviar uma
        simulação de preço, responder ao seu contato, proteger este formulário contra abuso e
        avaliar de forma agregada a viabilidade deste serviço. Seus arquivos não serão publicados,
        revendidos nem adicionados a catálogo.
      </p>
      <p>
        Arquivos enviados diretamente e referências a links compartilhados serão mantidos por até
        30 dias. Nome, e-mail e conteúdo identificável da solicitação serão mantidos por até 90
        dias, salvo necessidade legal específica. Depois disso, poderemos conservar apenas dados
        anonimizados ou agregados.
      </p>
      <p>
        O envio desta solicitação não cria pedido, reserva de produção, cobrança nem obrigação de
        fabricação.
      </p>
      <p>
        Seus arquivos serão usados apenas para avaliar o projeto e estimar a impressão. A OrStudio
        Print não publica, revende nem adiciona os arquivos enviados a catálogo. O simples envio não
        transfere a propriedade intelectual do arquivo para a OrStudio Print.
      </p>
      <details>
        <summary>Ver Aviso de Privacidade completo</summary>
        <div className="details-content">
          <p>
            <strong>Controlador:</strong> OrStudio Print, operação experimental da OR Studio
            Tecnologia LTDA.
          </p>
          <p>
            <strong>Contato de privacidade:</strong> imarinp85@gmail.com
          </p>
          <p>
            <strong>Dados tratados:</strong> nome, e-mail, cidade/UF, dados técnicos e textuais do
            projeto, arquivos ou link compartilhado, registros das declarações do formulário,
            atribuição de origem/campanha/sessão e registros técnicos mínimos necessários para
            segurança.
          </p>
          <p>
            <strong>Finalidades:</strong> analisar a solicitação; preparar e enviar a simulação de
            preço; responder ao contato; operar e proteger o intake; produzir análise agregada de
            viabilidade.
          </p>
          <p>
            <strong>Fornecedores necessários:</strong> Supabase para banco/armazenamento,
            Cloudflare para hospedagem, segurança, analytics e Turnstile, e Google para e-mail e
            ferramentas operacionais.
          </p>
          <p>Não vender dados nem compartilhá-los para publicidade comportamental.</p>
          <p>
            <strong>Retenção:</strong> arquivos armazenados pela OrStudio Print e referências a
            links externos serão removidos do ambiente operacional em até 30 dias após o envio.
            Nome, e-mail e conteúdo identificável da solicitação serão mantidos por até 90 dias,
            salvo necessidade legal específica. Após esse prazo, dados do experimento poderão ser
            preservados apenas de forma anonimizada ou agregada.
          </p>
          <p>
            Arquivos hospedados pelo próprio usuário em Drive, Dropbox ou OneDrive continuam sob
            controle do usuário; a OrStudio Print remove apenas a referência ou acesso mantido por
            ela.
          </p>
          <p>
            <strong>Direitos:</strong> o titular pode solicitar informações sobre o tratamento,
            acesso, correção e, quando aplicável, anonimização, bloqueio ou eliminação dos dados,
            além dos demais direitos previstos na LGPD, pelo canal de privacidade acima.
          </p>
          <p>
            <strong>Marketing:</strong> os dados deste intake não serão usados para campanhas de
            marketing durante a validação.
          </p>
        </div>
      </details>
    </section>
  );
}
