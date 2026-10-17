"use client";

export type ProductFormField =
  | "sku"
  | "name"
  | "description"
  | "category"
  | "price"
  | "stock";

export type ProductFormValues = Record<ProductFormField, string>;

type FieldInputOptions = {
  autoComplete?: string;
  inputMode?: "decimal" | "numeric" | "text";
  maxLength?: number;
  required?: boolean;
};

// Shared product inputs for the creation form and the edit dialog. `idPrefix`
// keeps error/hint IDs unique when both forms are on the page.
export function ProductFields({
  values,
  fieldErrors,
  hints = {},
  onChange,
  disabled,
  idPrefix = "",
  descriptionClassName,
}: {
  values: ProductFormValues;
  fieldErrors: Partial<Record<ProductFormField, string>>;
  hints?: Partial<Record<ProductFormField, string>>;
  onChange(field: ProductFormField, value: string): void;
  disabled?: boolean;
  idPrefix?: string;
  descriptionClassName: string;
}) {
  function fieldInput(field: ProductFormField, input: FieldInputOptions = {}) {
    const errorId = `${idPrefix}${field}-error`;
    const hintId = `${idPrefix}${field}-hint`;
    const describedBy = [
      hints[field] ? hintId : null,
      fieldErrors[field] ? errorId : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <>
        <input
          aria-describedby={describedBy || undefined}
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
        {hints[field] ? (
          <span className="dashboard-listing__hint mt-1 block text-xs" id={hintId}>
            {hints[field]}
          </span>
        ) : null}
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
        SKU
        {fieldInput("sku", { maxLength: 64, required: true })}
      </label>
      <label className="dashboard-listing__label block text-xs font-medium">
        Nombre
        {fieldInput("name", { maxLength: 160, required: true })}
      </label>
      <label className="dashboard-listing__label block text-xs font-medium">
        Categoría
        {fieldInput("category", { maxLength: 100, required: true })}
      </label>
      <label className="dashboard-listing__label block text-xs font-medium">
        Precio
        {fieldInput("price", {
          inputMode: "decimal",
          required: true,
        })}
      </label>
      <label className="dashboard-listing__label block text-xs font-medium">
        Stock
        {fieldInput("stock", { inputMode: "numeric" })}
      </label>
      <label
        className={`dashboard-listing__label block text-xs font-medium ${descriptionClassName}`}
      >
        Descripción (opcional)
        {fieldInput("description")}
      </label>
    </>
  );
}
