import type { ReactNode } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

const controlClass =
  "dashboard-listing__control mt-1 min-h-10 w-full rounded-md border px-3 text-sm";

export function ListingForm({
  action,
  children,
}: {
  action: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      className="dashboard-listing__filters grid min-w-0 grid-cols-1 items-end gap-4 rounded-xl p-4 sm:grid-cols-2 xl:grid-cols-4"
      method="get"
    >
      {children}
      <button
        className="dashboard-listing__apply min-h-10 rounded-md px-4 text-sm font-semibold"
        type="submit"
      >
        Aplicar
      </button>
    </form>
  );
}

export function SearchControl({
  defaultValue,
}: {
  defaultValue: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-400">
      Buscar
      <input
        className={controlClass}
        defaultValue={defaultValue}
        maxLength={120}
        name="search"
        placeholder="Escribe para buscar"
        type="search"
      />
    </label>
  );
}

export function TextFilter({
  name,
  label,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-400">
      {label}
      <input
        className={controlClass}
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        type="text"
      />
    </label>
  );
}

export function DateFilter({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-400">
      {label}
      <input
        className={controlClass}
        defaultValue={defaultValue}
        name={name}
        type="date"
      />
    </label>
  );
}

export function SelectFilter({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: readonly SelectOption[];
}) {
  return (
    <label className="block text-xs font-medium text-slate-400">
      {label}
      <select
        className={controlClass}
        defaultValue={defaultValue}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
