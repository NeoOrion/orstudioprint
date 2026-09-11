"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { createIntake, finalizeIntake, IntakeClientError, resumeIntake } from "@/lib/intake/api";
import {
  clearPendingSession,
  createPendingSession,
  matchPendingFiles,
  type PendingIntakeSession,
  readPendingSession,
  savePendingSession,
} from "@/lib/intake/pending-session";
import { uploadAuthorizedFile } from "@/lib/intake/storage";
import type {
  ExposureFactor,
  IntakeFormValues,
  UploadAuthorization,
} from "@/lib/intake/types";
import {
  canStartCreate,
  extractAttribution,
  fileDescriptors,
  mapFormToProjectPayload,
  toggleExposureFactor,
  validateForm,
} from "@/lib/intake/validation";

import { FormFields } from "./FormFields";
import { PrivacyNotice } from "./PrivacyNotice";
import { TurnstileWidget, type TurnstileWidgetHandle } from "./TurnstileWidget";

type UiPhase =
  | "READY"
  | "VALIDATING"
  | "CREATING"
  | "UPLOADING"
  | "FINALIZING"
  | "SUCCESS"
  | "RECOVERABLE_ERROR"
  | "PENDING";

const INITIAL_VALUES: IntakeFormValues = {
  branch: "FDM",
  firstName: "",
  email: "",
  city: "",
  stateUf: "",
  cep: "",
  projectDescription: "",
  quantity: "1",
  finalSize: "",
  materialPreference: "",
  finishPreference: "",
  deadlineNote: "",
  comments: "",
  intendedUse: "",
  exposureFactors: [],
  scaleOrHeight: "",
  detailNotes: "",
  fileDeliveryMode: "UPLOAD",
  externalFileUrl: "",
  ipDeclaration: false,
  privacyAcknowledgement: false,
};

const PHASE_LABELS: Record<UiPhase, string> = {
  READY: "Pronto para enviar",
  VALIDATING: "Validando…",
  CREATING: "Criando solicitação…",
  UPLOADING: "Enviando arquivos…",
  FINALIZING: "Confirmando arquivos…",
  SUCCESS: "Enviado com sucesso",
  RECOVERABLE_ERROR: "Erro recuperável",
  PENDING: "Envio pendente",
};

function errorMessage(error: unknown): string {
  if (error instanceof IntakeClientError) {
    return `${error.message} (código: ${error.code})`;
  }
  if (error instanceof Error && error.message === "MAPPING_MISMATCH") {
    return "Os arquivos selecionados não correspondem ao envio pendente.";
  }
  if (error instanceof Error && error.message === "UPLOAD_AUTHORIZATION_INCOMPLETE") {
    return "Nem todas as autorizações de upload ficaram disponíveis. Continue o envio pendente.";
  }
  return "Não foi possível concluir o envio. Você pode tentar continuar a sessão pendente.";
}

export function IntakeForm() {
  const [values, setValues] = useState<IntakeFormValues>(INITIAL_VALUES);
  const [files, setFiles] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UiPhase>("READY");
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [successReference, setSuccessReference] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingIntakeSession | null>(null);
  const sessionIdRef = useRef("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = readPendingSession(window.sessionStorage);
      if (restored) {
        setPending(restored);
        setPhase("PENDING");
        setNotice(
          "Existe um envio pendente. Selecione novamente os mesmos arquivos para continuar.",
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const requestActive = ["VALIDATING", "CREATING", "UPLOADING", "FINALIZING"].includes(phase);

  const onField = useCallback((name: keyof IntakeFormValues, value: string | boolean) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const onExposure = useCallback((factor: ExposureFactor) => {
    setValues((current) => ({
      ...current,
      exposureFactors: toggleExposureFactor(current.exposureFactors, factor),
    }));
  }, []);

  const onTokenChange = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  const onTurnstileError = useCallback((message: string | null) => {
    setTurnstileError(message);
  }, []);

  const finishSuccessfully = useCallback((reference: string) => {
    clearPendingSession(window.sessionStorage);
    setPending(null);
    setSuccessReference(reference);
    setNotice(null);
    setErrors([]);
    setPhase("SUCCESS");
  }, []);

  const uploadAndFinalize = useCallback(async (
    session: PendingIntakeSession,
    authorizations: readonly UploadAuthorization[],
    fileMapping: Map<string, File>,
  ) => {
    for (const [index, authorization] of authorizations.entries()) {
      const file = fileMapping.get(authorization.file_uuid);
      if (!file) throw new Error("MAPPING_MISMATCH");
      setPhase("UPLOADING");
      setProgress(`Enviando arquivo ${index + 1}/${authorizations.length}…`);
      await uploadAuthorizedFile(authorization, file);
    }
    setPhase("FINALIZING");
    setProgress("Confirmando arquivos…");
    const finalized = await finalizeIntake(session.project_id, session.submission_token);
    if (finalized.status !== "SUBMITTED" && !finalized.already_finalized) {
      throw new Error("FINALIZE_INCOMPLETE");
    }
    finishSuccessfully(finalized.project_reference);
  }, [finishSuccessfully]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canStartCreate(requestActive, pending !== null)) {
      setPhase("PENDING");
      setNotice("Continue ou descarte a sessão pendente antes de criar outra solicitação.");
      return;
    }
    setPhase("VALIDATING");
    setNotice(null);
    const validationErrors = validateForm(values, files);
    if (!turnstileToken) validationErrors.push("Conclua a verificação humana.");
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setPhase("READY");
      return;
    }
    if (!turnstileToken) return;
    setErrors([]);

    let createAttempted = false;
    try {
      setPhase("CREATING");
      setProgress("Criando solicitação…");
      createAttempted = true;
      if (!sessionIdRef.current) sessionIdRef.current = crypto.randomUUID();
      const response = await createIntake(
        turnstileToken,
        mapFormToProjectPayload(
          values,
          extractAttribution(window.location.search),
          sessionIdRef.current,
        ),
        fileDescriptors(files),
      );
      if (values.fileDeliveryMode === "LINK") {
        if (response.status !== "SUBMITTED") throw new Error("CREATE_INCOMPLETE");
        finishSuccessfully(response.project_reference);
        return;
      }

      let session: PendingIntakeSession;
      try {
        session = createPendingSession(response, files);
      } catch (error) {
        session = {
          version: 1,
          project_id: response.project_id,
          project_reference: response.project_reference,
          submission_token: response.submission_token,
          files: [],
        };
        savePendingSession(window.sessionStorage, session);
        setPending(session);
        throw error;
      }
      savePendingSession(window.sessionStorage, session);
      setPending(session);
      const fileMapping = matchPendingFiles(session.files, files);
      if (!fileMapping) throw new Error("MAPPING_MISMATCH");
      await uploadAndFinalize(session, response.uploads ?? [], fileMapping);
    } catch (error) {
      setPhase("RECOVERABLE_ERROR");
      setNotice(errorMessage(error));
    } finally {
      if (createAttempted) turnstileRef.current?.reset();
    }
  }

  async function handleResume() {
    if (!pending || requestActive) return;
    setErrors([]);
    setNotice(null);
    if (pending.files.length === 0) {
      setPhase("RECOVERABLE_ERROR");
      setNotice(
        "A criação não devolveu o mapeamento completo. Preserve esta aba e tente novamente mais tarde.",
      );
      return;
    }
    const fileMapping = matchPendingFiles(pending.files, files);
    if (!fileMapping) {
      setPhase("PENDING");
      setNotice("Selecione novamente todos os arquivos com os mesmos nomes e tamanhos.");
      return;
    }

    try {
      setPhase("FINALIZING");
      setProgress("Verificando o envio pendente…");
      const resumed = await resumeIntake(pending.project_id, pending.submission_token);
      if (resumed.already_finalized || resumed.status !== "UPLOAD_PENDING") {
        finishSuccessfully(resumed.project_reference);
        return;
      }
      if (resumed.upload_authorization_incomplete) {
        throw new Error("UPLOAD_AUTHORIZATION_INCOMPLETE");
      }
      await uploadAndFinalize(pending, resumed.uploads ?? [], fileMapping);
    } catch (error) {
      setPhase("RECOVERABLE_ERROR");
      setNotice(errorMessage(error));
    }
  }

  function discardLocalSession() {
    clearPendingSession(window.sessionStorage);
    setPending(null);
    setFiles([]);
    setNotice(null);
    setErrors([]);
    setPhase("READY");
  }

  if (phase === "SUCCESS" && successReference) {
    return (
      <section className="success-card" aria-live="polite">
        <p className="eyebrow">Enviado com sucesso</p>
        <h2>Solicitação recebida</h2>
        <p className="reference">Referência: {successReference}</p>
        <p>
          Esta é uma solicitação de simulação de preço. Nenhum pedido ou cobrança foi criado.
        </p>
      </section>
    );
  }

  return (
    <form className="intake-form" onSubmit={handleSubmit} noValidate>
      <header className="form-header">
        <p className="eyebrow">Harness técnico · P2.3.6B</p>
        <h1>Conte sobre seu projeto</h1>
        <p>
          Envie as informações técnicas para avaliarmos a viabilidade e prepararmos uma simulação
          de preço.
        </p>
      </header>

      <div className="status-bar" role="status" aria-live="polite">
        <span className={`status-dot status-${phase.toLowerCase()}`} aria-hidden="true" />
        <strong>{PHASE_LABELS[phase]}</strong>
        {progress ? <span>{progress}</span> : null}
      </div>

      {pending ? (
        <section className="pending-panel" aria-labelledby="pending-title">
          <p className="eyebrow">Envio pendente</p>
          <h2 id="pending-title">Referência: {pending.project_reference}</h2>
          <p>
            Selecione novamente todos os arquivos originais. Antes de continuar, conferiremos nome
            e tamanho para evitar o envio silencioso de um arquivo diferente.
          </p>
          <div className="button-row">
            <button type="button" onClick={handleResume} disabled={requestActive}>
              Continuar envio pendente
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={discardLocalSession}
              disabled={requestActive}
            >
              Descartar sessão local
            </button>
          </div>
          <p className="field-help">
            Descartar apaga somente os dados desta aba. Nenhum dado remoto será excluído.
          </p>
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section className="error-panel" aria-labelledby="validation-title">
          <h2 id="validation-title">Revise antes de enviar</h2>
          <ul>
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </section>
      ) : null}

      {notice ? <p className="notice-panel" role="alert">{notice}</p> : null}
      <FormFields
        values={values}
        files={files}
        disabled={requestActive}
        onField={onField}
        onExposure={onExposure}
        onFiles={setFiles}
      />

      <PrivacyNotice />

      <section className="form-section declarations" aria-labelledby="declarations-heading">
        <h2 id="declarations-heading">Declarações obrigatórias</h2>
        <label className="declaration">
          <input
            required
            type="checkbox"
            checked={values.privacyAcknowledgement}
            onChange={(event) => onField("privacyAcknowledgement", event.target.checked)}
            disabled={requestActive}
          />
          <span>Li e estou ciente do Aviso de Privacidade desta solicitação.</span>
        </label>
        <label className="declaration">
          <input
            required
            type="checkbox"
            checked={values.ipDeclaration}
            onChange={(event) => onField("ipDeclaration", event.target.checked)}
            disabled={requestActive}
          />
          <span>
            Declaro que sou titular dos direitos necessários sobre os arquivos enviados ou que
            possuo autorização suficiente para solicitar sua reprodução física. Entendo que
            projetos com situação de propriedade intelectual duvidosa podem ser recusados.
          </span>
        </label>
      </section>

      {!pending ? (
        <TurnstileWidget
          ref={turnstileRef}
          onTokenChange={onTokenChange}
          onRecoverableError={onTurnstileError}
        />
      ) : null}
      {turnstileError ? <p className="notice-panel" role="alert">{turnstileError}</p> : null}

      <button
        className="submit-button"
        type="submit"
        disabled={requestActive || pending !== null || !turnstileToken}
      >
        Enviar solicitação
      </button>
      <p className="submission-note">
        O envio não cria pedido, cobrança ou reserva de produção.
      </p>
    </form>
  );
}
