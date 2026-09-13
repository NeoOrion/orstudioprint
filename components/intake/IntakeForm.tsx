"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  buildInteractionEvent,
  buildSubmittedEvent,
  claimCurrentFormStarted,
  getCurrentExperimentSession,
  routeForBranch,
  type ExperimentSession,
} from "@/lib/experiment/session";
import {
  createIntake,
  finalizeIntake,
  IntakeClientError,
  resumeIntake,
  sendExperimentEventBestEffort,
} from "@/lib/intake/api";
import {
  clearPendingSession,
  createPendingSession,
  matchPendingFiles,
  migrateLegacyPendingSession,
  type PendingIntakeSession,
  readPendingSession,
  savePendingSession,
} from "@/lib/intake/pending-session";
import { uploadAuthorizedFile } from "@/lib/intake/storage";
import type {
  Branch,
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

function authorizationsCoverExpectedFiles(
  authorizations: readonly UploadAuthorization[],
  expectedFileUuids: readonly string[],
): boolean {
  if (authorizations.length !== expectedFileUuids.length) return false;
  const expected = new Set(expectedFileUuids);
  return authorizations.every((authorization) => expected.delete(authorization.file_uuid)) &&
    expected.size === 0;
}

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

interface IntakeFormProps {
  initialBranch?: "FDM" | "RESIN";
  lockBranch?: boolean;
}

interface PublicSubmissionContext {
  session: ExperimentSession;
  branch: Branch;
}

function recordFormSubmitted(projectId: string, context: PublicSubmissionContext | null) {
  if (!context) return;
  sendExperimentEventBestEffort(
    buildSubmittedEvent(context.session, context.branch, projectId),
  );
}

export function IntakeForm({ initialBranch, lockBranch = false }: IntakeFormProps) {
  const [values, setValues] = useState<IntakeFormValues>({
    ...INITIAL_VALUES,
    ...(initialBranch ? { branch: initialBranch } : {}),
  });
  const [files, setFiles] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UiPhase>("READY");
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [successReference, setSuccessReference] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingIntakeSession | null>(null);
  const [recoveryMissingFileUuids, setRecoveryMissingFileUuids] = useState<string[] | null>(null);
  const [recoveryAuthorizations, setRecoveryAuthorizations] = useState<UploadAuthorization[]>([]);
  const [recoveryFiles, setRecoveryFiles] = useState<File[]>([]);
  const sessionIdRef = useRef("");
  const pendingExperimentRef = useRef<{
    projectId: string;
    context: PublicSubmissionContext;
  } | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const errorSummaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let restored: PendingIntakeSession | null = null;
      try {
        restored = readPendingSession(window.localStorage) ??
          migrateLegacyPendingSession(window.localStorage, window.sessionStorage);
      } catch {
        restored = null;
      }
      if (restored) {
        setPending(restored);
        setPhase("PENDING");
        setNotice("Existe um envio pendente. Verifique o estado para continuar.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const requestActive = ["VALIDATING", "CREATING", "UPLOADING", "FINALIZING"].includes(phase);

  useEffect(() => {
    if (errors.length > 0) {
      errorSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      errorSummaryRef.current?.focus();
    }
  }, [errors]);

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
    clearPendingSession(window.localStorage);
    setPending(null);
    setSuccessReference(reference);
    setNotice(null);
    setErrors([]);
    setPhase("SUCCESS");
    pendingExperimentRef.current = null;
  }, []);

  const uploadAndFinalize = useCallback(async (
    session: PendingIntakeSession,
    authorizations: readonly UploadAuthorization[],
    fileMapping: Map<string, File>,
    experimentContext: PublicSubmissionContext | null,
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
    recordFormSubmitted(finalized.project_id, experimentContext);
    finishSuccessfully(finalized.project_reference);
  }, [finishSuccessfully]);

  function handlePublicFormChange() {
    if (!lockBranch) return;
    try {
      const session = getCurrentExperimentSession();
      const route = routeForBranch(values.branch);
      if (claimCurrentFormStarted(session.session_id, route)) {
        sendExperimentEventBestEffort(
          buildInteractionEvent("form_started", session, values.branch),
        );
      }
    } catch {
      // Form interaction must remain unaffected when analytics is unavailable.
    }
  }

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
      let experimentContext: PublicSubmissionContext | null = null;
      if (lockBranch) {
        try {
          experimentContext = {
            session: getCurrentExperimentSession(),
            branch: values.branch,
          };
        } catch {
          experimentContext = null;
        }
      }
      if (experimentContext) {
        sessionIdRef.current = experimentContext.session.session_id;
      } else if (!sessionIdRef.current) {
        sessionIdRef.current = crypto.randomUUID();
      }
      const response = await createIntake(
        turnstileToken,
        mapFormToProjectPayload(
          values,
          experimentContext?.session ?? extractAttribution(window.location.search),
          sessionIdRef.current,
        ),
        fileDescriptors(files),
      );
      if (values.fileDeliveryMode === "LINK") {
        if (response.status !== "SUBMITTED") throw new Error("CREATE_INCOMPLETE");
        recordFormSubmitted(response.project_id, experimentContext);
        finishSuccessfully(response.project_reference);
        return;
      }

      const session = createPendingSession(response, files);
      if (experimentContext) {
        pendingExperimentRef.current = {
          projectId: response.project_id,
          context: experimentContext,
        };
      }
      if (!savePendingSession(window.localStorage, session)) {
        setNotice("Nao foi possivel salvar a recuperacao. Se fechar o navegador, este envio pode nao ficar disponivel.");
      }
      setPending(session);
      const fileMapping = matchPendingFiles(session.files, files);
      if (!fileMapping) throw new Error("MAPPING_MISMATCH");

      const authorizations = response.uploads ?? [];
      if (!response.upload_authorization_incomplete &&
        authorizationsCoverExpectedFiles(authorizations, session.files.map((file) => file.file_uuid))) {
        await uploadAndFinalize(session, authorizations, fileMapping, experimentContext);
      } else {
        const resumed = await resumeIntake(session.project_id, session.submission_token);
        if (resumed.already_finalized || resumed.status !== "UPLOAD_PENDING") {
          if (resumed.already_finalized || resumed.status === "SUBMITTED") {
            recordFormSubmitted(resumed.project_id, experimentContext);
          }
          finishSuccessfully(resumed.project_reference);
          return;
        }
        const missingFileUuids = resumed.missing_file_uuids ?? session.files.map((file) => file.file_uuid);
        const resumedAuthorizations = resumed.uploads ?? [];
        if (resumed.upload_authorization_incomplete ||
          !authorizationsCoverExpectedFiles(resumedAuthorizations, missingFileUuids)) {
          throw new Error("UPLOAD_AUTHORIZATION_INCOMPLETE");
        }
        await uploadAndFinalize(session, resumedAuthorizations, fileMapping, experimentContext);
      }
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
    const experimentContext = pendingExperimentRef.current?.projectId === pending.project_id
      ? pendingExperimentRef.current.context
      : null;
    try {
      if (recoveryMissingFileUuids === null) {
        setPhase("FINALIZING");
        setProgress("Verificando o envio pendente…");
        const resumed = await resumeIntake(pending.project_id, pending.submission_token);
        if (resumed.already_finalized || resumed.status !== "UPLOAD_PENDING") {
          if (resumed.already_finalized || resumed.status === "SUBMITTED") {
            recordFormSubmitted(resumed.project_id, experimentContext);
          }
          finishSuccessfully(resumed.project_reference);
          return;
        }
        const missingFileUuids = resumed.missing_file_uuids ?? [];
        if (missingFileUuids.length === 0) {
          const finalized = await finalizeIntake(pending.project_id, pending.submission_token);
          if (finalized.status !== "SUBMITTED" && !finalized.already_finalized) {
            throw new Error("FINALIZE_INCOMPLETE");
          }
          recordFormSubmitted(finalized.project_id, experimentContext);
          finishSuccessfully(finalized.project_reference);
          return;
        }
        const authorizations = resumed.uploads ?? [];
        if (resumed.upload_authorization_incomplete ||
          !authorizationsCoverExpectedFiles(authorizations, missingFileUuids)) {
          throw new Error("UPLOAD_AUTHORIZATION_INCOMPLETE");
        }
        setRecoveryMissingFileUuids(missingFileUuids);
        setRecoveryAuthorizations(authorizations);
        setPhase("PENDING");
        return;
      }
      const expected = pending.files.filter((file) =>
        recoveryMissingFileUuids.includes(file.file_uuid)
      );
      const fileMapping = matchPendingFiles(expected, recoveryFiles);
      if (!fileMapping) {
        setPhase("PENDING");
        setNotice("Adicione todos os arquivos solicitados com os mesmos nomes e tamanhos.");
        return;
      }
      await uploadAndFinalize(pending, recoveryAuthorizations, fileMapping, experimentContext);
    } catch (error) {
      setPhase("RECOVERABLE_ERROR");
      setNotice(errorMessage(error));
    }
  }

  function discardLocalSession() {
    clearPendingSession(window.localStorage);
    setRecoveryMissingFileUuids(null);
    setRecoveryAuthorizations([]);
    setRecoveryFiles([]);
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

  if (pending) {
    const expectedFiles = recoveryMissingFileUuids === null ? [] : pending.files.filter((file) =>
      recoveryMissingFileUuids.includes(file.file_uuid)
    );
    const matchingFiles = matchPendingFiles(expectedFiles, recoveryFiles);
    return (
      <section className="pending-panel" aria-labelledby="pending-title">
        <p className="eyebrow">Envio pendente</p>
        <h1 id="pending-title">Referência: {pending.project_reference}</h1>
        <p>A solicitação já foi criada. Você não precisa preencher o formulário novamente.</p>
        <p className="field-help">A recuperação deste envio fica disponível neste navegador por até 24 horas.</p>
        {recoveryMissingFileUuids !== null ? (
          <>
            <p>Precisamos reenviar:</p>
            <ul>{expectedFiles.map((file) => <li key={file.file_uuid}>{file.original_name} · {(file.declared_size_bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</li>)}</ul>
            <label>Adicionar arquivos
              <input type="file" multiple accept=".stl,.3mf,.obj,.step,.stp" disabled={requestActive} onChange={(event) => {
                const selectedFiles = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                setRecoveryFiles((current) => [...current, ...selectedFiles]);
              }} />
            </label>
            <ul>{recoveryFiles.map((file, index) => <li key={`${file.name}-${file.size}-${index}`}>{file.name} · {(file.size / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB <button type="button" className="button-secondary" onClick={() => setRecoveryFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></li>)}</ul>
            <p className="field-help">{matchingFiles ? "Todos os arquivos solicitados foram encontrados." : "Adicione todos os arquivos solicitados com os mesmos nomes e tamanhos."}</p>
          </>
        ) : null}
        {notice ? <p className="notice-panel" role="alert">{notice}</p> : null}
        <div className="button-row">
          <button type="button" onClick={handleResume} disabled={requestActive || (recoveryMissingFileUuids !== null && !matchingFiles)}>
            {recoveryMissingFileUuids === null ? "Verificar e continuar" : "Enviar arquivos pendentes"}
          </button>
          <button type="button" className="button-secondary" onClick={discardLocalSession} disabled={requestActive}>Descartar sessão local</button>
        </div>
        <p className="field-help">Descartar apaga somente os dados desta aba. Nenhum dado remoto será excluído.</p>
      </section>
    );
  }

  return (
    <form className="intake-form" onChangeCapture={handlePublicFormChange} onSubmit={handleSubmit} noValidate>
      <header className="form-header">
        <p className="eyebrow">OrStudio Print · Impressão 3D sob medida</p>
        <h1>Conte sobre seu projeto</h1>
        <p>
          Envie as informações necessárias para avaliarmos o projeto e prepararmos uma simulação
          de preço.
        </p>
      </header>

      <div className="status-bar" role="status" aria-live="polite">
        <span className={`status-dot status-${phase.toLowerCase()}`} aria-hidden="true" />
        <strong>{PHASE_LABELS[phase]}</strong>
        {progress ? <span>{progress}</span> : null}
      </div>



      {notice ? <p className="notice-panel" role="alert">{notice}</p> : null}
      <FormFields
        values={values}
        files={files}
        disabled={requestActive}
        onField={onField}
        onExposure={onExposure}
        onFiles={setFiles}
        lockBranch={lockBranch}
      />

      <section className="form-section" aria-label="Resumo do envio">
        <h2>Resumo do envio</h2>
        <p>Tipo de projeto: {values.branch === "FDM" ? "Peça funcional" : "Resina / alto detalhe"}</p>
        <p>Entrega: {values.fileDeliveryMode === "UPLOAD" ? "Upload" : "Link"}</p>
        {values.fileDeliveryMode === "UPLOAD" ? <p>{files.length} {files.length === 1 ? "arquivo" : "arquivos"} · {(files.reduce((total, file) => total + file.size, 0) / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</p> : null}
      </section>

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

      {errors.length > 0 ? (
        <section ref={errorSummaryRef} tabIndex={-1} className="error-panel" aria-labelledby="validation-title" role="alert">
          <h2 id="validation-title">Revise antes de enviar</h2>
          <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </section>
      ) : null}

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
