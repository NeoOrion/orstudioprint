import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FormFields } from "../../components/intake/FormFields";
import type { IntakeFormValues } from "./types";

function values(overrides: Partial<IntakeFormValues> = {}): IntakeFormValues {
  return {
    branch: "FDM",
    firstName: "Ada",
    email: "ada@example.com",
    city: "Curitiba",
    stateUf: "PR",
    cep: "",
    projectDescription: "Peça de reposição",
    quantity: "1",
    finalSize: "100 mm",
    materialPreference: "",
    finishPreference: "",
    deadlineNote: "",
    comments: "",
    intendedUse: "Uso interno",
    exposureFactors: [],
    scaleOrHeight: "",
    detailNotes: "",
    fileDeliveryMode: "UPLOAD",
    externalFileUrl: "",
    ipDeclaration: true,
    privacyAcknowledgement: true,
    ...overrides,
  };
}

function renderFields(overrides: Partial<IntakeFormValues>, lockBranch: boolean): string {
  return renderToStaticMarkup(createElement(FormFields, {
    values: values(overrides),
    files: [],
    disabled: false,
    onField: () => undefined,
    onExposure: () => undefined,
    onFiles: () => undefined,
    lockBranch,
  }));
}

describe("public intake field variants", () => {
  it("shows FDM reference-link wording while preserving the upload allowlist and LINK value", () => {
    const upload = renderFields({ branch: "FDM", fileDeliveryMode: "UPLOAD" }, true);
    const link = renderFields({
      branch: "FDM",
      fileDeliveryMode: "LINK",
      externalFileUrl: "https://example.com/reference",
    }, true);

    expect(upload).toContain("Como enviar o arquivo ou referência");
    expect(upload).toContain("Enviar arquivo 3D");
    expect(upload).toContain('accept=".stl,.3mf,.obj,.step,.stp"');
    expect(upload).toContain('value="LINK"');
    expect(link).toContain("Compartilhar referência por link");
    expect(link).toContain("Drive, Dropbox, OneDrive ou outro link HTTPS");
    expect(link).toContain("Pode ser uma pasta com fotos, medidas, arquivo 3D ou outra referência do projeto. O link deve abrir sem solicitar acesso.");
    expect(link).toContain('type="url"');
  });

  it("hides only the duplicate scale field in the locked public RESIN form", () => {
    const resin = renderFields({ branch: "RESIN" }, true);

    expect(resin).toContain("Tamanho final / escala");
    expect(resin).not.toContain("Escala / altura");
    expect(resin).toContain("Observações de detalhe");
    expect(resin).toContain("Como enviar o modelo");
    expect(resin).toContain("Compartilhar link");
    expect(resin).not.toContain("Compartilhar referência por link");
  });

  it("keeps the optional scale field in the unlocked technical intake", () => {
    const resin = renderFields({ branch: "RESIN" }, false);

    expect(resin).toContain("Tamanho final / escala");
    expect(resin).toContain("Escala / altura");
    expect(resin).toContain("Observações de detalhe");
  });
});
