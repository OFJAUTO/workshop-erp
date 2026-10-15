"use client";

/** Prints the one sticker it sits in: the others are hidden for the print, then shown again. */
export function PrintOne() {
  return (
    <button
      type="button"
      className="print-one"
      onClick={(e) => {
        const host = e.currentTarget.parentElement;
        if (!host) return;
        document.body.classList.add("printing-one");
        host.classList.add("print-this");
        const done = () => { document.body.classList.remove("printing-one"); host.classList.remove("print-this"); window.removeEventListener("afterprint", done); };
        window.addEventListener("afterprint", done);
        window.print();
      }}
    >
      Print this one
    </button>
  );
}
