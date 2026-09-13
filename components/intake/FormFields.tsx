import type { ExposureFactor, IntakeFormValues } from "../../lib/intake/types";
import { formatFileSize, removeFileAt } from "../../lib/intake/validation";

const EXPOSURE_OPTIONS: Array<{ value: ExposureFactor; label: string }> = [
  { value: "HEAT", label: "Calor" },
  { value: "LOAD", label: "Carga / esforço" },
  { value: "OUTDOOR", label: "Uso externo / sol" },
  { value: "IMPACT_FLEX", label: "Impacto / flexão" },
  { value: "NONE", label: "Nenhum destes" },
  { value: "UNKNOWN", label: "Não sei" },
];

interface FormFieldsProps {
  values: IntakeFormValues;
  files: readonly File[];
  disabled: boolean;
  onField(name: keyof IntakeFormValues, value: string | boolean): void;
  onExposure(factor: ExposureFactor): void;
  onFiles(files: File[]): void;
  lockBranch?: boolean;
}

export function FormFields({
  values,
  files,
  disabled,
  onField,
  onExposure,
  onFiles,
  lockBranch = false,
}: FormFieldsProps) {
  const isPublicFdm = lockBranch && values.branch === "FDM";
  const isPublicResin = lockBranch && values.branch === "RESIN";

  return (
    <>
      {!lockBranch ? <>
      <fieldset disabled={disabled}>
        <legend>Tecnologia</legend>
        <div className="choice-row">
          <label className="choice-card">
            <input
              type="radio"
              name="branch"
              value="FDM"
              checked={values.branch === "FDM"}
              onChange={() => onField("branch", "FDM")}
            />
            <span><strong>FDM</strong><small>Peças funcionais e protótipos</small></span>
          </label>
          <label className="choice-card">
            <input
              type="radio"
              name="branch"
              value="RESIN"
              checked={values.branch === "RESIN"}
              onChange={() => onField("branch", "RESIN")}
            />
            <span><strong>RESINA</strong><small>Detalhes finos e miniaturas</small></span>
          </label>
        </div>
      </fieldset>
      </> : null}

      <section className="form-section" aria-labelledby="contact-heading">
        <h2 id="contact-heading">Seus dados</h2>
        <div className="field-grid">
          <label>
            Nome <span aria-hidden="true">*</span>
            <input
              required
              autoComplete="given-name"
              value={values.firstName}
              onChange={(event) => onField("firstName", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            E-mail <span aria-hidden="true">*</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => onField("email", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            Cidade <span aria-hidden="true">*</span>
            <input
              required
              autoComplete="address-level2"
              value={values.city}
              onChange={(event) => onField("city", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            UF <span aria-hidden="true">*</span>
            <input
              required
              maxLength={2}
              autoComplete="address-level1"
              value={values.stateUf}
              onChange={(event) => onField("stateUf", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            CEP <span className="optional">(opcional)</span>
            <input
              inputMode="numeric"
              autoComplete="postal-code"
              value={values.cep}
              onChange={(event) => onField("cep", event.target.value)}
              disabled={disabled}
            />
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="project-heading">
        <h2 id="project-heading">Sobre o projeto</h2>
        <label>
          Descrição do projeto <span aria-hidden="true">*</span>
          <textarea
            required
            rows={5}
            value={values.projectDescription}
            onChange={(event) => onField("projectDescription", event.target.value)}
            disabled={disabled}
          />
        </label>
        <div className="field-grid">
          <label>
            Quantidade <span aria-hidden="true">*</span>
            <input
              required
              type="number"
              min={1}
              step={1}
              value={values.quantity}
              onChange={(event) => onField("quantity", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            Tamanho final / escala <span aria-hidden="true">*</span>
            <input
              required
              placeholder="Ex.: 120 × 80 × 40 mm ou escala 1:35"
              value={values.finalSize}
              onChange={(event) => onField("finalSize", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            Preferência de material <span className="optional">(opcional)</span>
            <input
              value={values.materialPreference}
              onChange={(event) => onField("materialPreference", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            Acabamento <span className="optional">(opcional)</span>
            <input
              value={values.finishPreference}
              onChange={(event) => onField("finishPreference", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            Prazo desejado <span className="optional">(opcional)</span>
            <input
              value={values.deadlineNote}
              onChange={(event) => onField("deadlineNote", event.target.value)}
              disabled={disabled}
            />
          </label>
        </div>
        <label>
          Comentários <span className="optional">(opcional)</span>
          <textarea
            rows={3}
            value={values.comments}
            onChange={(event) => onField("comments", event.target.value)}
            disabled={disabled}
          />
        </label>
      </section>

      {values.branch === "FDM" ? (
        <section className="form-section" aria-labelledby="fdm-heading">
          <h2 id="fdm-heading">Como a peça será usada</h2>
          <label>
            Uso pretendido <span aria-hidden="true">*</span>
            <textarea
              required
              rows={3}
              placeholder="Conte onde e como a peça será usada."
              value={values.intendedUse}
              onChange={(event) => onField("intendedUse", event.target.value)}
              disabled={disabled}
            />
          </label>
          <fieldset disabled={disabled}>
            <legend>Fatores de exposição <span className="optional">(opcional)</span></legend>
            <p className="field-help">
              “Nenhum destes” e “Não sei” não podem ser combinados com outras opções.
            </p>
            <div className="check-grid">
              {EXPOSURE_OPTIONS.map((option) => (
                <label key={option.value} className="check-option">
                  <input
                    type="checkbox"
                    checked={values.exposureFactors.includes(option.value)}
                    onChange={() => onExposure(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      ) : (
        <section className="form-section" aria-labelledby="resin-heading">
          <h2 id="resin-heading">Detalhes para resina</h2>
          <div className="field-grid">
            {!isPublicResin ? (
              <label>
                Escala / altura <span className="optional">(opcional)</span>
                <input
                  placeholder="Ex.: 32 mm ou escala 1:10"
                  value={values.scaleOrHeight}
                  onChange={(event) => onField("scaleOrHeight", event.target.value)}
                  disabled={disabled}
                />
              </label>
            ) : null}
            <label>
              Observações de detalhe <span className="optional">(opcional)</span>
              <textarea
                rows={3}
                value={values.detailNotes}
                onChange={(event) => onField("detailNotes", event.target.value)}
                disabled={disabled}
              />
            </label>
          </div>
        </section>
      )}

      <section className="form-section" aria-labelledby="delivery-heading">
        <h2 id="delivery-heading">
          {isPublicFdm ? "Como enviar o arquivo ou referência" : "Como enviar o modelo"}
        </h2>
        <fieldset disabled={disabled}>
          <legend>Forma de entrega</legend>
          <div className="choice-row">
            <label className="choice-card">
              <input
                type="radio"
                name="delivery"
                value="UPLOAD"
                checked={values.fileDeliveryMode === "UPLOAD"}
                onChange={() => onField("fileDeliveryMode", "UPLOAD")}
              />
              <span>
                <strong>{isPublicFdm ? "Enviar arquivo 3D" : "Enviar arquivos"}</strong>
                <small>Upload direto e privado</small>
              </span>
            </label>
            <label className="choice-card">
              <input
                type="radio"
                name="delivery"
                value="LINK"
                checked={values.fileDeliveryMode === "LINK"}
                onChange={() => onField("fileDeliveryMode", "LINK")}
              />
              <span>
                <strong>{isPublicFdm ? "Compartilhar referência por link" : "Compartilhar link"}</strong>
                <small>
                  {isPublicFdm
                    ? "Drive, Dropbox, OneDrive ou outro link HTTPS"
                    : "Drive, Dropbox ou OneDrive"}
                </small>
              </span>
            </label>
          </div>
        </fieldset>

        {values.fileDeliveryMode === "UPLOAD" ? (
          <label>
            Adicionar arquivos <span aria-hidden="true">*</span>
            <input
              key="upload-files"
              required
              type="file"
              multiple
              accept=".stl,.3mf,.obj,.step,.stp"
              onChange={(event) => {
                onFiles([...files, ...Array.from(event.target.files ?? [])]);
                event.currentTarget.value = "";
              }}
              disabled={disabled}
            />
            <span className="field-help">Até 5 arquivos · 50 MB no total</span>
            {files.length > 0 ? (
              <div className="file-summary">
                <p>{files.length} {files.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}</p>
                <ul>
                  {files.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`}>
                      <span>{file.name} · {formatFileSize(file.size)}</span>
                      <button type="button" className="button-secondary" onClick={() => onFiles(removeFileAt(files, index))} disabled={disabled}>
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </label>
        ) : (
          <label>
            Link compartilhado <span aria-hidden="true">*</span>
            <input
              key="external-link"
              required
              type="url"
              inputMode="url"
              placeholder="https://drive.google.com/..."
              value={values.externalFileUrl}
              onChange={(event) => onField("externalFileUrl", event.target.value)}
              disabled={disabled}
            />
            <span className="field-help">
              {isPublicFdm
                ? "Pode ser uma pasta com fotos, medidas, arquivo 3D ou outra referência do projeto. O link deve abrir sem solicitar acesso."
                : "Use um link compartilhado que possamos abrir sem solicitar acesso. Exemplos: Google Drive / Dropbox / OneDrive."}
            </span>
          </label>
        )}
      </section>
    </>
  );
}
