import * as React from "react";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/* Field kit kontrol: label (+ tanda wajib), kontrol, helper / pesan error.
   Saat error=true: border kontrol merah, helper diganti pesan error. */
function Field({
  className,
  label,
  htmlFor,
  required,
  helper,
  error,
  errorMessage,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  helper?: React.ReactNode;
  error?: boolean;
  errorMessage?: React.ReactNode;
}) {
  return (
    <div
      data-slot="field"
      data-error={error || undefined}
      className={cn(
        "flex flex-col gap-2",
        error &&
          "[&_[data-slot=input]]:border-(--color-danger) [&_[data-slot=input]]:shadow-[0_0_0_3px_rgba(252,60,59,.18)] [&_[data-slot=select]]:border-(--color-danger) [&_[data-slot=select]]:shadow-[0_0_0_3px_rgba(252,60,59,.18)] [&_[data-slot=textarea]]:border-(--color-danger) [&_[data-slot=textarea]]:shadow-[0_0_0_3px_rgba(252,60,59,.18)]",
        className
      )}
      {...props}
    >
      {label !== undefined ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required ? (
            <span className="text-(--color-danger-text)"> *</span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error && errorMessage ? (
        <span className="inline-flex items-center gap-[5px] text-xs text-(--color-danger-text)">
          <CircleAlert className="size-3 flex-none" strokeWidth={2.5} />
          {errorMessage}
        </span>
      ) : helper ? (
        <span className="text-xs text-(--text-tertiary)">{helper}</span>
      ) : null}
    </div>
  );
}

/* Grid form 2 kolom — .full untuk bentang penuh via className="col-span-full" */
function FormGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-grid"
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-5 max-md:grid-cols-1",
        className
      )}
      {...props}
    />
  );
}

export { Field, FormGrid };
