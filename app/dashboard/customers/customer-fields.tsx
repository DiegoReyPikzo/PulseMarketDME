"use client";

export type CustomerFormField = "name" | "email" | "phone";

export type CustomerFormValues = Record<CustomerFormField, string>;

// Shared customer inputs for the creation form and the edit dialog. `idPrefix`
// keeps error IDs unique when both forms are on the page.
export function CustomerFields({
  values,
  fieldErrors,
  onChange,
  disabled,
  idPrefix,
}: {
  values: CustomerFormValues;
  fieldErrors: Partial<Record<CustomerFormField, string>>;
  onChange(field: CustomerFormField, value: string): void;
  disabled?: boolean;
  idPrefix: string;
}) {
  function fieldInput(
    field: CustomerFormField,
    input: {
      autoComplete: string;
      inputMode?: "email" | "tel" | "text";
      maxLength: number;
      required?: boolean;
    },
  ) {
    const errorId = `${idPrefix}${field}-error`;
    return (
      <>
        <input
          aria-describedby={fieldErrors[field] ? errorId : undefined}
          aria-invalid={Boolean(fieldErrors[field])}
          autoComplete={input.autoComplete}
          className="dashboard-listing__control mt-1 min-h-10 w-full rounded-md border px-3 text-sm"
          disabled={disabled}
          inputMode={input.inputMode}
          maxLength={input.maxLength}
          name={field}
          onChange={(event) => onChange(field, event.currentTarget.value)}
          required={input.required}
          type="text"
          value={values[field]}
        />
        {fieldErrors[field] ? (
          <span className="dashboard-listing__field-error mt-1 block text-xs" id={errorId}>
            {fieldErrors[field]}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <label className="dashboard-listing__label block text-xs font-medium">
        Nombre
        {fieldInput("name", { autoComplete: "off", maxLength: 160, required: true })}
      </label>
      <label className="dashboard-listing__label block text-xs font-medium">
        Correo electrónico
        {fieldInput("email", {
          autoComplete: "off",
          inputMode: "email",
          maxLength: 254,
          required: true,
        })}
      </label>
      <label className="dashboard-listing__label block text-xs font-medium">
        Teléfono (opcional)
        {fieldInput("phone", { autoComplete: "off", inputMode: "tel", maxLength: 32 })}
      </label>
    </>
  );
}
