const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

/** Returns an error message, or null when the domain is valid. */
export function validateDomain(name: string): string | null {
  if (!name) return "Please enter a domain.";
  if (name.length > 253) return "Domain is too long.";
  const labels = name.split(".");
  if (labels.length < 2) return "Please enter a valid domain, e.g. example.com.";
  if (!labels.every((l) => LABEL.test(l))) return `"${name}" is not a valid domain.`;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return "Please use a valid top-level domain.";
  return null;
}

export const isVercelApp = (name: string) => name.endsWith(".vercel.app");

/** Apex = exactly two labels (ignores multi-part public suffixes for simplicity). */
export const isApex = (name: string) => name.split(".").length === 2;

export const VERCEL_A_RECORD = "76.76.21.21";
export const VERCEL_CNAME = "cname.vercel-dns.com.";
